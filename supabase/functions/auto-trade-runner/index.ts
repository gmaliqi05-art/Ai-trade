import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// auto-trade-runner — cron (çdo minutë). Ekzekuton sinjalet e lejuara në MT5 me:
//  - kufizim rreziku te SL (humbja maks. ≤ kufiri)
//  - Claude si "portë" (ekzekuton vetëm nëse Claude pajtohet)
//  - trailing/break-even (kalon SL në hyrje kur trade-i është +1R në fitim)

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
  analysis: string | null;
}

interface Position {
  id: string; type?: string; openPrice?: number; currentPrice?: number;
  stopLoss?: number; takeProfit?: number; profit?: number;
}

function host(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}

// Vlera monetare për 1.0 lëvizje çmimi për 1.0 lot (përafërt, sipas simbolit).
function valuePerPrice(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU")) return 100;
  if (s.includes("XAG")) return 5000;
  if (/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test(s)) return 1;
  if (s.length === 6) return 100000;
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

async function maTrade(cfg: Cfg, body: Record<string, unknown>) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}/trade`, {
    method: "POST", headers: { "auth-token": cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  let b: unknown = txt; try { b = JSON.parse(txt); } catch { /* */ }
  return { ok: resp.ok, status: resp.status, body: b };
}

// Claude si "portë": konfirmon nëse trade-i është i arsyeshëm. Fail-open: nëse Claude
// s'është i disponueshëm ose gabon, lejon trade-in (motori është tashmë i përforcuar).
type DB = ReturnType<typeof createClient>;
async function claudeConfirm(db: DB, sig: Signal): Promise<{ agree: boolean; reason: string }> {
  try {
    const { data: prov } = await db.from("ai_providers")
      .select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
    const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
    if (!key) return { agree: true, reason: "pa Claude (lejuar)" };
    const model = (prov as { model?: string }).model || "claude-opus-4-8";
    const dir = sig.type === "buy" ? "BUY" : "SELL";
    const sys = 'You are a strict risk-aware trade validator for an automated trading bot. The engine already passed a multi-timeframe (15m+1h+4h) + trend (EMA200) + ADX filter. Reply ONLY JSON: {"agree": true|false, "reason": "short"}. Agree=true only if the trade is reasonable and not obviously against momentum.';
    const usr = `Proposed ${dir} ${sig.symbol} @ ${sig.entry_price}, SL ${sig.stop_loss}, TP ${sig.target_price}, engine confidence ${sig.confidence}%. Engine reasons: ${sig.analysis || "n/a"}. Agree to take this trade now?`;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 200, system: sys, messages: [{ role: "user", content: usr }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return { agree: true, reason: "Claude error (lejuar)" };
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { agree: true, reason: "Claude pa JSON (lejuar)" };
    const parsed = JSON.parse(m[0]);
    return { agree: !!parsed.agree, reason: String(parsed.reason || "") };
  } catch {
    return { agree: true, reason: "Claude exception (lejuar)" };
  }
}

const BREAKEVEN_R = 1.0; // kalo SL në hyrje kur fitimi arrin 1× rrezikun fillestar

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: Array<Record<string, unknown>> = [];
  const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: configs } = await db
      .from("metaapi_config").select("*").eq("auto_trade", true).eq("kill_switch", false);

    for (const raw of (configs ?? [])) {
      const cfg = raw as Cfg;
      if (!cfg.account_id || !cfg.token) continue;

      // Gjendja e llogarisë + pozicionet (një herë).
      let positions: Position[] = [];
      let floatingLoss = 0;
      try {
        positions = (await maGet(cfg, "/positions") as Position[]) ?? [];
        if (!Array.isArray(positions)) positions = [];
        const info = await maGet(cfg, "/account-information") as { balance?: number; equity?: number };
        if (info?.balance != null && info?.equity != null) floatingLoss = Math.max(0, Number(info.balance) - Number(info.equity));
      } catch (e) {
        summary.push({ user: cfg.user_id, error: `metaapi: ${(e as Error).message}` });
        continue;
      }
      let openTrades = positions.length;

      // --- TRAILING / BREAK-EVEN: mbron fitimin e pozicioneve të hapura ---
      for (const p of positions) {
        const isBuy = String(p.type || "").includes("BUY");
        const entry = Number(p.openPrice), cur = Number(p.currentPrice);
        const sl = p.stopLoss != null ? Number(p.stopLoss) : null;
        if (!Number.isFinite(entry) || !Number.isFinite(cur) || sl == null) continue;
        const riskDist = Math.abs(entry - sl);
        if (!(riskDist > 0)) continue;
        const moved = isBuy ? cur - entry : entry - cur;
        if (moved < riskDist * BREAKEVEN_R) continue; // ende s'ka arritur +1R
        const alreadyBE = isBuy ? sl >= entry : sl <= entry;
        if (alreadyBE) continue; // SL tashmë në fitim/break-even
        const beSL = Math.round((isBuy ? entry + 0.1 * riskDist : entry - 0.1 * riskDist) * 100) / 100;
        try {
          const r = await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: beSL, takeProfit: p.takeProfit ?? undefined });
          summary.push({ user: cfg.user_id, trailing: p.id, breakeven: r.ok });
        } catch { /* injoro */ }
      }

      // --- SINJALE TË REJA ---
      const allowed = new Set((cfg.auto_symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
      if (allowed.size === 0) continue;

      const { data: signals } = await db
        .from("signals")
        .select("id, symbol, type, confidence, entry_price, target_price, stop_loss, analysis")
        .eq("user_id", cfg.user_id).eq("status", "active").gte("created_at", sinceIso)
        .order("created_at", { ascending: false }).limit(5);

      const candidates = (signals ?? []).filter((s: Signal) =>
        (s.type === "buy" || s.type === "sell") &&
        Number(s.confidence) >= cfg.min_confidence &&
        allowed.has((s.symbol || "").toUpperCase()),
      ) as Signal[];

      for (const sig of candidates) {
        const { data: existing } = await db
          .from("trade_executions").select("id").eq("user_id", cfg.user_id).eq("signal_id", sig.id).limit(1);
        if (existing && existing.length > 0) continue;

        const action = sig.type === "buy" ? "BUY" : "SELL";
        let volume = Math.min(cfg.default_lot, cfg.max_lot);
        if (volume < 0.01) volume = 0.01;
        volume = Math.round(volume * 100) / 100;

        // Kufizo rrezikun e trade-it te SL: humbja maks. ≤ max_daily_loss.
        let stopLoss = sig.stop_loss != null ? Number(sig.stop_loss) : undefined;
        const entry = sig.entry_price != null ? Number(sig.entry_price) : undefined;
        const maxRisk = Number(cfg.max_daily_loss) || 0;
        if (stopLoss != null && entry != null && maxRisk > 0) {
          const vpp = valuePerPrice(sig.symbol);
          if (Math.abs(entry - stopLoss) * vpp * volume > maxRisk) {
            const maxDist = maxRisk / (vpp * volume);
            stopLoss = action === "BUY" ? entry - maxDist : entry + maxDist;
            stopLoss = Math.round(stopLoss * 100) / 100;
          }
        }

        const log = (status: string, reason: string, orderId: string | null, rawResp: unknown) =>
          db.from("trade_executions").insert({
            user_id: cfg.user_id, signal_id: sig.id, symbol: sig.symbol, action, volume,
            entry_price: sig.entry_price, stop_loss: stopLoss ?? sig.stop_loss, take_profit: sig.target_price,
            mode: cfg.mode, status, reason, metaapi_order_id: orderId, raw_response: rawResp ?? null,
          });

        if (openTrades >= cfg.max_open_trades) { await log("rejected", `Max pozicione (${cfg.max_open_trades})`, null, null); continue; }
        if (floatingLoss >= cfg.max_daily_loss) { await log("rejected", `Limit humbjeje (${cfg.max_daily_loss})`, null, null); continue; }

        // CLAUDE SI PORTË — ekzekuto vetëm nëse Claude pajtohet.
        const gate = await claudeConfirm(db, sig);
        if (!gate.agree) { await log("rejected", `Claude s'pajtohet: ${gate.reason}`.slice(0, 200), null, null); summary.push({ user: cfg.user_id, signal: sig.id, status: "claude_rejected" }); continue; }

        const tradeBody: Record<string, unknown> = {
          actionType: action === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
          symbol: sig.symbol, volume,
        };
        if (stopLoss != null) tradeBody.stopLoss = stopLoss;
        if (sig.target_price != null) tradeBody.takeProfit = Number(sig.target_price);

        try {
          const r = await maTrade(cfg, tradeBody);
          if (!r.ok) { await log("error", `trade ${r.status}`, null, r.body); summary.push({ user: cfg.user_id, signal: sig.id, status: "error" }); continue; }
          const orderId = (r.body as { orderId?: string; positionId?: string })?.orderId
            ?? (r.body as { positionId?: string })?.positionId ?? null;
          await log("executed", `auto (${cfg.mode})`, orderId, r.body);
          openTrades += 1;
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
