import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// auto-trade-runner — ekzekutohet nga cron (çdo minutë). Për çdo përdorues me auto_trade
// aktiv, gjen sinjalet e fundit të lejuara dhe i ekzekuton në MT5 via MetaApi, me mbrojtje
// rreziku. "Demo i pari": respekton mode-in; dedup me trade_executions.signal_id.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Cfg {
  user_id: string; account_id: string; token: string; region: string; mode: string;
  default_lot: number; max_lot: number; max_daily_loss: number; max_open_trades: number;
  kill_switch: boolean; min_confidence: number; auto_symbols: string;
}

interface Signal {
  id: string; symbol: string; type: string; confidence: number;
  entry_price: number | null; target_price: number | null; stop_loss: number | null;
}

function host(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

// Vlera monetare për 1.0 lëvizje çmimi për 1.0 lot (përafërt, sipas simbolit).
// Përdoret për të kufizuar rrezikun (humbjen) e çdo trade-i te SL.
function valuePerPrice(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU")) return 100;     // ari: 100 ons/lot → $1 lëvizje = $100/lot
  if (s.includes("XAG")) return 5000;    // argjend: 5000 ons/lot
  if (/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test(s)) return 1; // crypto
  if (s.length === 6) return 100000;     // forex standard (lot = 100,000 njësi)
  return 100;
}

async function maGet(cfg: Cfg, path: string) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
    headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(15000),
  });
  const txt = await resp.text();
  let body: unknown = txt; try { body = JSON.parse(txt); } catch { /* */ }
  if (!resp.ok) throw new Error(`MetaApi ${resp.status}`);
  return body;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: Array<Record<string, unknown>> = [];
  const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: configs } = await db
      .from("metaapi_config")
      .select("*")
      .eq("auto_trade", true)
      .eq("kill_switch", false);

    for (const raw of (configs ?? [])) {
      const cfg = raw as Cfg;
      if (!cfg.account_id || !cfg.token) continue;

      const allowed = new Set(
        (cfg.auto_symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      );
      if (allowed.size === 0) continue;

      // Sinjalet e fundit aktive të këtij përdoruesi.
      const { data: signals } = await db
        .from("signals")
        .select("id, symbol, type, confidence, entry_price, target_price, stop_loss")
        .eq("user_id", cfg.user_id)
        .eq("status", "active")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(5);

      const candidates = (signals ?? []).filter((s: Signal) =>
        (s.type === "buy" || s.type === "sell") &&
        Number(s.confidence) >= cfg.min_confidence &&
        allowed.has((s.symbol || "").toUpperCase()),
      ) as Signal[];

      if (candidates.length === 0) continue;

      // Gjendja e llogarisë (një herë për përdorues).
      let openTrades = 0, floatingLoss = 0;
      try {
        const positions = await maGet(cfg, "/positions") as unknown[];
        openTrades = Array.isArray(positions) ? positions.length : 0;
        const info = await maGet(cfg, "/account-information") as { balance?: number; equity?: number };
        if (info?.balance != null && info?.equity != null) floatingLoss = Math.max(0, Number(info.balance) - Number(info.equity));
      } catch (e) {
        summary.push({ user: cfg.user_id, error: `metaapi: ${(e as Error).message}` });
        continue;
      }

      for (const sig of candidates) {
        // Dedup: a është ekzekutuar/refuzuar tashmë ky sinjal?
        const { data: existing } = await db
          .from("trade_executions")
          .select("id")
          .eq("user_id", cfg.user_id)
          .eq("signal_id", sig.id)
          .limit(1);
        if (existing && existing.length > 0) continue;

        const action = sig.type === "buy" ? "BUY" : "SELL";
        const log = (status: string, reason: string, orderId: string | null, rawResp: unknown) =>
          db.from("trade_executions").insert({
            user_id: cfg.user_id, signal_id: sig.id, symbol: sig.symbol, action,
            volume: Math.min(cfg.default_lot, cfg.max_lot),
            entry_price: sig.entry_price, stop_loss: sig.stop_loss, take_profit: sig.target_price,
            mode: cfg.mode, status, reason, metaapi_order_id: orderId, raw_response: rawResp ?? null,
          });

        if (openTrades >= cfg.max_open_trades) {
          await log("rejected", `Max pozicione (${cfg.max_open_trades})`, null, null);
          continue;
        }
        if (floatingLoss >= cfg.max_daily_loss) {
          await log("rejected", `Limit humbjeje (${cfg.max_daily_loss})`, null, null);
          continue;
        }

        let volume = Math.min(cfg.default_lot, cfg.max_lot);
        if (volume < 0.01) volume = 0.01;
        volume = Math.round(volume * 100) / 100;

        const tradeBody: Record<string, unknown> = {
          actionType: action === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
          symbol: sig.symbol, volume,
        };

        // Kufizo rrezikun e trade-it te SL: humbja maksimale ≤ max_daily_loss (kufiri i përdoruesit).
        // Nëse SL-ja e sinjalit rrezikon më shumë, e afrojmë SL-në që humbja të mos kalojë kufirin.
        let stopLoss = sig.stop_loss != null ? Number(sig.stop_loss) : undefined;
        const entry = sig.entry_price != null ? Number(sig.entry_price) : undefined;
        const maxRisk = Number(cfg.max_daily_loss) || 0;
        if (stopLoss != null && entry != null && maxRisk > 0) {
          const vpp = valuePerPrice(sig.symbol);
          const riskMoney = Math.abs(entry - stopLoss) * vpp * volume;
          if (riskMoney > maxRisk) {
            const maxDist = maxRisk / (vpp * volume);
            stopLoss = action === "BUY" ? entry - maxDist : entry + maxDist;
            stopLoss = Math.round(stopLoss * 100) / 100;
          }
        }
        if (stopLoss != null) tradeBody.stopLoss = stopLoss;
        if (sig.target_price != null) tradeBody.takeProfit = Number(sig.target_price);

        try {
          const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}/trade`, {
            method: "POST",
            headers: { "auth-token": cfg.token, "Content-Type": "application/json" },
            body: JSON.stringify(tradeBody), signal: AbortSignal.timeout(20000),
          });
          const txt = await resp.text();
          let rb: unknown = txt; try { rb = JSON.parse(txt); } catch { /* */ }
          if (!resp.ok) {
            await log("error", `trade ${resp.status}`, null, rb);
            summary.push({ user: cfg.user_id, signal: sig.id, status: "error" });
            continue;
          }
          const orderId = (rb as { orderId?: string; positionId?: string })?.orderId
            ?? (rb as { positionId?: string })?.positionId ?? null;
          await log("executed", `auto (${cfg.mode})`, orderId, rb);
          openTrades += 1; // numëro pozicionin e ri për kontrollet vijuese
          summary.push({ user: cfg.user_id, signal: sig.id, status: "executed", order: orderId });
        } catch (e) {
          await log("error", (e as Error).message, null, null);
          summary.push({ user: cfg.user_id, signal: sig.id, status: "error" });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
