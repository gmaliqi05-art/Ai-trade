import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// signal-eval — vlerëson sinjalet AKTIVE kundrejt çmimit real: a arriti TP apo SL?
// Kur arrin TP → 'hit_tp' (sukses), kur arrin SL → 'hit_sl' (humbje), kur skadon → 'expired'.
// Sinjalet e mbyllura dalin nga lista e aktiveve dhe shfaqen te "Të përfunduara" me rezultat %.
// Ekzekutohet nga cron çdo 2 min.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Candle { time: number; high: number; low: number; close: number; }

const PAIRS: Record<string, string> = {
  BTCUSD: "BTCUSDT", ETHUSD: "ETHUSDT", SOLUSD: "SOLUSDT", BNBUSD: "BNBUSDT", XRPUSD: "XRPUSDT",
  ADAUSD: "ADAUSDT", DOGEUSD: "DOGEUSDT", AVAXUSD: "AVAXUSDT", LINKUSD: "LINKUSDT", DOTUSD: "DOTUSDT",
  XAUUSD: "PAXGUSDT",
};

async function fetchCandles(symbol: string): Promise<Candle[] | null> {
  const pair = PAIRS[symbol.toUpperCase()];
  if (!pair) return null;
  // 5m × 288 ≈ 24 orë — mbulon jetëgjatësinë e sinjalit (6–12h).
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=5m&limit=288`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Binance ${resp.status}`);
  const raw = (await resp.json()) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string),
  }));
}

interface SigRow {
  id: string; symbol: string; type: string;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
  created_at: string; expires_at: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Portë sigurie për cron (vetëm akses — S'PREK logjikën e vlerësimit). Fail-safe: lejo nëse s'ka sekret/gabim.
  try {
    const { data: _cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const _secret = (_cs as { value?: string } | null)?.value;
    if (_secret && req.headers.get("x-cron-secret") !== _secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch { /* fail-safe */ }
  const out: Array<Record<string, unknown>> = [];

  try {
    const { data: signals } = await db
      .from("signals")
      .select("id, symbol, type, entry_price, target_price, stop_loss, created_at, expires_at")
      .eq("status", "active")
      .not("entry_price", "is", null)
      .not("target_price", "is", null)
      .not("stop_loss", "is", null)
      .limit(200);

    const rows = (signals ?? []) as SigRow[];
    if (rows.length === 0) return json({ success: true, evaluated: 0 });

    // Grupo sipas simbolit → një kërkesë candlesh për simbol.
    const bySymbol = new Map<string, SigRow[]>();
    for (const s of rows) {
      const sym = (s.symbol || "").toUpperCase();
      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym)!.push(s);
    }

    const nowMs = Date.now();

    for (const [symbol, list] of bySymbol) {
      let candles: Candle[] | null = null;
      try { candles = await fetchCandles(symbol); } catch { candles = null; }

      for (const s of list) {
        const entry = Number(s.entry_price), tp = Number(s.target_price), sl = Number(s.stop_loss);
        const isBuy = s.type === "buy";
        const createdMs = new Date(s.created_at).getTime();
        const expMs = s.expires_at ? new Date(s.expires_at).getTime() : null;

        let outcome: "tp" | "sl" | null = null;
        let closedMs: number | null = null;

        if (candles) {
          for (const c of candles) {
            if (c.time < createdMs) continue; // vetëm pas krijimit
            const hitTP = isBuy ? c.high >= tp : c.low <= tp;
            const hitSL = isBuy ? c.low <= sl : c.high >= sl;
            if (hitSL && hitTP) { outcome = "sl"; closedMs = c.time; break; } // konservativ: SL i pari
            if (hitSL) { outcome = "sl"; closedMs = c.time; break; }
            if (hitTP) { outcome = "tp"; closedMs = c.time; break; }
          }
        }

        if (outcome) {
          const pct = outcome === "tp"
            ? Math.abs(tp - entry) / entry * 100
            : -Math.abs(sl - entry) / entry * 100;
          await db.from("signals").update({
            status: outcome === "tp" ? "hit_tp" : "hit_sl",
            outcome, result_pct: Math.round(pct * 100) / 100,
            closed_at: new Date(closedMs ?? nowMs).toISOString(),
          }).eq("id", s.id);
          out.push({ id: s.id, symbol, outcome, pct: Math.round(pct * 100) / 100 });
        } else if (expMs != null && expMs < nowMs) {
          // Skadoi pa arritur TP/SL — rezultati i papërfunduar (sipas çmimit aktual).
          const last = candles && candles.length ? candles[candles.length - 1].close : entry;
          const pct = isBuy ? (last - entry) / entry * 100 : (entry - last) / entry * 100;
          await db.from("signals").update({
            status: "expired", outcome: "expired",
            result_pct: Math.round(pct * 100) / 100,
            closed_at: new Date(nowMs).toISOString(),
          }).eq("id", s.id);
          out.push({ id: s.id, symbol, outcome: "expired", pct: Math.round(pct * 100) / 100 });
        }
      }
    }

    return json({ success: true, evaluated: rows.length, closed: out });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
