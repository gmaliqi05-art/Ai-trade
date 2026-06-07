import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PriceUpdate {
  symbol: string;
  price: number;
  change24h?: number;
  changePct?: number;
}

async function fetchForexPrices(): Promise<PriceUpdate[]> {
  const symbols = ["EURUSD", "GBPUSD", "USDJPY"];
  const results: PriceUpdate[] = [];

  try {
    const resp = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error("Frankfurter API failed");
    const data = await resp.json();
    const rates = data.rates || {};

    if (rates.EUR) results.push({ symbol: "EURUSD", price: parseFloat((1 / rates.EUR).toFixed(5)), change24h: 0, changePct: 0 });
    if (rates.GBP) results.push({ symbol: "GBPUSD", price: parseFloat((1 / rates.GBP).toFixed(5)), change24h: 0, changePct: 0 });
    if (rates.JPY) results.push({ symbol: "USDJPY", price: parseFloat(rates.JPY.toFixed(3)), change24h: 0, changePct: 0 });
  } catch (e) {
    console.error("Frankfurter fetch error:", e);
  }
  return results;
}

async function fetchCryptoPrices(): Promise<PriceUpdate[]> {
  const results: PriceUpdate[] = [];
  // CoinGecko id → simboli i platformës.
  const MAP: Record<string, string> = {
    bitcoin: "BTCUSD",
    ethereum: "ETHUSD",
    solana: "SOLUSD",
    binancecoin: "BNBUSD",
    ripple: "XRPUSD",
  };
  try {
    const ids = Object.keys(MAP).join(",");
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) throw new Error("CoinGecko API failed");
    const data = await resp.json();

    for (const [id, symbol] of Object.entries(MAP)) {
      const row = data[id];
      if (row && typeof row.usd === "number") {
        results.push({
          symbol,
          price: row.usd,
          change24h: 0,
          changePct: row.usd_24h_change ? parseFloat(row.usd_24h_change.toFixed(2)) : 0,
        });
      }
    }
  } catch (e) {
    console.error("CoinGecko fetch error:", e);
  }
  return results;
}

async function fetchMetalPrices(): Promise<PriceUpdate[]> {
  const results: PriceUpdate[] = [];

  // ARI: Binance PAXGUSDT (PAX Gold — token i mbështetur me ar fizik që ndjek spot-in).
  // Burim falas dhe i besueshëm; zëvendëson metals.live që ishte shpesh i padisponueshëm.
  try {
    const resp = await fetch(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT",
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const d = await resp.json();
      const price = parseFloat(d.lastPrice);
      const pct = parseFloat(d.priceChangePercent);
      if (price > 0) {
        results.push({
          symbol: "XAUUSD",
          price: parseFloat(price.toFixed(2)),
          change24h: 0,
          changePct: Number.isNaN(pct) ? 0 : parseFloat(pct.toFixed(2)),
        });
      }
    } else {
      throw new Error(`Binance PAXG ${resp.status}`);
    }
  } catch (e) {
    console.error("Binance PAXG (gold) error:", e);
    // Fallback: çmimi i arit nga Coinbase XAU.
    try {
      const resp2 = await fetch(
        "https://api.coinbase.com/v2/exchange-rates?currency=XAU",
        { signal: AbortSignal.timeout(8000) }
      );
      if (resp2.ok) {
        const d2 = await resp2.json();
        const usdRate = d2?.data?.rates?.USD;
        if (usdRate) {
          results.push({ symbol: "XAUUSD", price: parseFloat(parseFloat(usdRate).toFixed(2)), change24h: 0, changePct: 0 });
        }
      }
    } catch (e2) {
      console.error("Coinbase gold fallback failed:", e2);
    }
  }

  // ARGJENDI: metals.live (best-effort; nëse dështon, mbetet te vlera e fundit).
  try {
    const resp = await fetch(
      "https://api.metals.live/v1/spot/silver",
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.silver !== undefined) {
            results.push({ symbol: "XAGUSD", price: parseFloat(item.silver.toFixed(4)), change24h: 0, changePct: 0 });
          }
        }
      }
    }
  } catch (e) {
    console.error("metals.live (silver) error:", e);
  }

  return results;
}

// NAFTË (USOIL/UKOIL): NUK merret nga Twelve Data — plani falas s'e mbulon naftën
// (WTI = vetëm plan me pagesë; BRENT = simbol i pavlefshëm). Burimi i naftës është
// MetaApi (brokeri i përdoruesit), që përdoret nga motori (engine-scan) për sinjale.
// Çmimi i naftës te lista shfaqet nga MT5 live kur llogaria është e lidhur.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Portë sigurie për cron (vetëm akses). Fail-safe: lejo nëse s'ka sekret/gabim.
    try {
      const { data: _cs } = await supabase.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
      const _secret = (_cs as { value?: string } | null)?.value;
      if (_secret && req.headers.get("x-cron-secret") !== _secret) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch { /* fail-safe */ }

    const [forexPrices, cryptoPrices, metalPrices] = await Promise.all([
      fetchForexPrices(),
      fetchCryptoPrices(),
      fetchMetalPrices(),
    ]);

    const allUpdates = [...forexPrices, ...cryptoPrices, ...metalPrices];
    const updated: string[] = [];
    const errors: string[] = [];

    for (const update of allUpdates) {
      const { data: asset } = await supabase
        .from("assets")
        .select("id, current_price")
        .eq("symbol", update.symbol)
        .maybeSingle();

      if (!asset) continue;

      const prevPrice = parseFloat(asset.current_price) || update.price;
      const change24h = update.change24h !== 0 ? update.change24h : parseFloat((update.price - prevPrice).toFixed(4));
      const changePct = update.changePct !== 0 ? update.changePct : prevPrice > 0 ? parseFloat(((change24h / prevPrice) * 100).toFixed(4)) : 0;

      // Shënim: `price_change_pct` është kolonë e gjeneruar nga `price_change_pct_24h`,
      // prandaj shkruajmë kolonën bazë (përndryshe Postgres hedh gabim).
      const { error } = await supabase
        .from("assets")
        .update({
          current_price: update.price,
          price_change_24h: change24h,
          price_change_pct_24h: changePct,
          updated_at: new Date().toISOString(),
        })
        .eq("symbol", update.symbol);

      if (error) {
        errors.push(`${update.symbol}: ${error.message}`);
      } else {
        updated.push(`${update.symbol}=${update.price}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        errors,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err as Error;
    console.error("update-prices error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
