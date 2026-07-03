import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// MMT-FAST-LOOP — roboti i sekondave NË INFRASTRUKTURËN TONË (pa VPS).
// Cron-i e thërret çdo minutë; brenda, funksioni qëndron në LAK ~48 sekonda duke
// lexuar qirinjtë 1-SEKONDËSH (binance.vision) çdo ~4s → reagim real 5-10 sekonda.
// E njëjta logjikë si worker-i VPS: burst i konfirmuar → hyrje me bracket (SL+TP),
// mbrojtje e çastit (+0.4R → BE), trail 60% pas +0.8R, dalje në burst të kundërt
// ose ngecje. Punon vetëm kur mmt_config.fast_on=true DHE fast_runner='edge'
// (kur pronari ngre VPS-in, kalon fast_runner='vps' dhe ky lak heshtë — pa dyfishim).
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

interface C1s { t: number; o: number; h: number; l: number; c: number; v: number; }
const VPP = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function k1s(limit = 60): Promise<C1s[] | null> {
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1s&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const raw = (await r.json()) as unknown[][];
    return raw.map((k) => ({ t: Number(k[0]) / 1000, o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string) }));
  } catch { return null; }
}
function ema(v: number[], p: number): number {
  const k = 2 / (p + 1);
  let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < v.length; i++) e = v[i] * k + e * (1 - k);
  return e;
}

interface Broker { account_id: string; token: string; region: string; symbol: string; }
const maHost = (r: string) => `https://mt-client-api-v1.${(r || "london").trim()}.agiliumtrade.ai`;
async function maTrade(b: Broker, body: Record<string, unknown>) {
  const resp = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/trade`, {
    method: "POST", headers: { "auth-token": b.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const txt = await resp.text();
  let j: unknown = txt; try { j = JSON.parse(txt); } catch { /* tekst */ }
  return { ok: resp.ok, status: resp.status, body: j };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Vetëm cron-i (x-cron-secret) — laku s'thirret nga përdoruesit.
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "unauthorized" }, 401); }

  const { data: cfgRow } = await db.from("mmt_config").select("*").eq("id", 1).maybeSingle();
  const cfg = cfgRow as Record<string, never> & {
    active: boolean; fast_on: boolean; fast_runner: string; paper_equity: number; risk_pct: number;
    fast_move_usd: number; fast_window_s: number; fast_sl_usd: number; fast_tp_rr: number;
    fast_stall_s: number; fast_max_day: number; fast_cooldown_s: number;
    kill_after_sl: number; daily_stop_pct: number; sessions: [number, number][];
    blackout_until: string | null; live_enabled: boolean; live_lots: number; live_user_id: string | null;
  } | null;
  if (!cfg) return json({ error: "mmt_config mungon" }, 500);

  const beat = async (decision: string, reject: string | null, price: number | null) => {
    try { await db.from("mmt_scan_log").insert({ price, regime: "FAST", decision, reject_reason: reject }); } catch { /* diagnostikë */ }
  };

  // Portat e qeta (heartbeat çdo minutë që faqja të tregojë WORKER GJALLË edhe kur pret).
  if (cfg.fast_runner !== "edge") { await beat("fast_alive", "runner_vps", null); return json({ ok: true, skip: "runner_vps" }); }
  if (!cfg.active || !cfg.fast_on) { await beat("fast_alive", "fast_off", null); return json({ ok: true, skip: "fast_off" }); }
  if (cfg.blackout_until && new Date(cfg.blackout_until).getTime() > Date.now()) { await beat("fast_alive", "event_blackout", null); return json({ ok: true, skip: "blackout" }); }
  const hU = new Date().getUTCHours();
  if (!(cfg.sessions || [[7, 10], [13, 21]]).some(([a, b]) => hU >= a && hU < b)) { await beat("fast_alive", `jashte_sesionit(${hU}h)`, null); return json({ ok: true, skip: "session" }); }

  // Kufijtë ditorë (një herë për thirrje — laku zgjat vetëm ~48s).
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { data: dayR } = await db.from("mmt_trades").select("status, pnl_usd, strategy, opened_at, closed_at").gte("opened_at", today.toISOString());
  const dRows = (dayR ?? []) as { status: string; pnl_usd: number | null; strategy: string; opened_at: string; closed_at: string | null }[];
  const slT = dRows.filter((r) => r.status === "sl").length;
  const pnlT = dRows.reduce((a, r) => a + Number(r.pnl_usd ?? 0), 0);
  const fastToday = dRows.filter((r) => r.strategy === "fast");
  if (slT >= cfg.kill_after_sl) { await beat("fast_alive", `kill_switch(${slT}SL)`, null); return json({ ok: true, skip: "kill" }); }
  if (pnlT <= -Number(cfg.paper_equity) * (Number(cfg.daily_stop_pct) / 100)) { await beat("fast_alive", "stop_ditor", null); return json({ ok: true, skip: "daily" }); }
  if (fastToday.length >= (Number(cfg.fast_max_day) || 10)) { await beat("fast_alive", `fast_max_day(${fastToday.length})`, null); return json({ ok: true, skip: "max_day" }); }
  const lastClosed = fastToday.filter((r) => r.closed_at).map((r) => new Date(r.closed_at!).getTime()).sort((a, b) => b - a)[0] || 0;

  // Kredencialet live + trendi 1m (një herë për thirrje).
  let broker: Broker | null = null;
  if (cfg.live_enabled && cfg.live_user_id) {
    const { data: mc } = await db.from("metaapi_config").select("account_id, token, region, kill_switch, symbol_map").eq("user_id", cfg.live_user_id).maybeSingle();
    const m = mc as { account_id?: string; token?: string; region?: string; kill_switch?: boolean; symbol_map?: Record<string, string> | null } | null;
    if (m?.account_id && m?.token && m.kill_switch !== true) broker = { account_id: m.account_id, token: m.token, region: m.region || "london", symbol: (m.symbol_map && m.symbol_map["XAUUSD"]) || "XAUUSD" };
  }
  let m1Trend = 0;
  try {
    const r = await fetch("https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=30", { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const raw = (await r.json()) as unknown[][]; const cl = raw.map((k) => +(k[4] as string)); m1Trend = ema(cl, 9) > ema(cl, 21) ? 1 : -1; }
  } catch { /* mbetet 0 → pa hyrje */ }

  // Pozicioni fast i hapur (nëse ka) — e menaxhojmë brenda lakut.
  interface FastPos { id: string; side: string; entry_price: number; sl: number; tp: number; lots: number; risk_usd: number; live: boolean; live_order_id: string | null; opened_at: string; best_fav?: number | null; }
  const { data: openF } = await db.from("mmt_trades").select("*").eq("strategy", "fast").eq("status", "open").limit(1);
  let pos = ((openF ?? [])[0] as FastPos | undefined) || null;
  let posSL = pos ? Number(pos.sl) : 0;
  // KUJTESA E MBROJTJES (fix): kulmi i favorit rikthehet nga DB (best_fav) DHE rillogaritet nga
  // qirinjtë 1s që nga hapja — që BE/trailing të MOS rifillojnë nga zero çdo minutë (defekti që
  // la një pozicion +$5 të kthehej në −1R pa u mbrojtur).
  let bestFav = pos ? Math.max(0, Number(pos.best_fav ?? 0)) : 0;
  if (pos) {
    try {
      const hist = await k1s(300); // ~5 min histori 1s
      if (hist) {
        const since = new Date(pos.opened_at).getTime() / 1000;
        const isBuy = pos.side === "BUY";
        for (const c of hist) {
          if (c.t < since) continue;
          const fav = isBuy ? c.h - Number(pos.entry_price) : Number(pos.entry_price) - c.l;
          if (fav > bestFav) bestFav = fav;
        }
      }
    } catch { /* mbetet vlera e DB */ }
  }
  let lastPersistedSL = posSL, lastPersistedFav = bestFav;
  const persistProtection = async () => {
    if (!pos) return;
    if (posSL === lastPersistedSL && Math.abs(bestFav - lastPersistedFav) < 0.05) return;
    try {
      await db.from("mmt_trades").update({ sl: Math.round(posSL * 100) / 100, best_fav: Math.round(bestFav * 100) / 100 }).eq("id", pos.id);
      lastPersistedSL = posSL; lastPersistedFav = bestFav;
    } catch { /* iterimi tjetër */ }
  };

  let pending: { side: "BUY" | "SELL"; t0: number; move: number; p0: number } | null = null;
  let lastBeatPx: number | null = null;
  const t0 = Date.now();
  const W = Math.max(2, Number(cfg.fast_window_s) || 5);

  const closePos = async (status: string, exit: number) => {
    if (!pos) return;
    const isBuy = pos.side === "BUY";
    const pnl = (isBuy ? exit - Number(pos.entry_price) : Number(pos.entry_price) - exit) * VPP * Number(pos.lots);
    const rM = Number(pos.risk_usd) > 0 ? pnl / Number(pos.risk_usd) : 0;
    if (pos.live && pos.live_order_id && broker) { try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: pos.live_order_id }); } catch { /* bracket-i mund ta ketë mbyllur */ } }
    await db.from("mmt_trades").update({ status, exit_price: Math.round(exit * 100) / 100, pnl_usd: Math.round(pnl * 100) / 100, r_multiple: Math.round(rM * 100) / 100, closed_at: new Date().toISOString() }).eq("id", pos.id);
    await beat(pnl >= 0 ? "fast_dalje_fitim" : "fast_dalje_humbje", `${status} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}$`, exit);
    pos = null;
  };

  // ======= LAKU ~48s: lexim 1s çdo ~4s =======
  while (Date.now() - t0 < 48_000) {
    const cs = await k1s(90);
    if (!cs || cs.length < 15) { await sleep(4000); continue; }
    const px = cs[cs.length - 1].c;
    lastBeatPx = px;
    const nowS = cs[cs.length - 1].t;

    // --- MENAXHIMI i pozicionit të hapur (çdo iterim) ---
    if (pos) {
      const isBuy = pos.side === "BUY";
      const entry = Number(pos.entry_price), slD = Math.abs(entry - Number(pos.sl)) || Number(cfg.fast_sl_usd) || 2;
      const fav = isBuy ? px - entry : entry - px;
      if (fav > bestFav) bestFav = fav;
      // BE i çastit +0.4R; trail 60% pas +0.8R (edhe live me MODIFY).
      let newSL = posSL;
      if (bestFav / slD >= 0.8) { const lock = entry + (isBuy ? 1 : -1) * bestFav * 0.6; if (isBuy ? lock > newSL : lock < newSL) newSL = lock; }
      else if (bestFav / slD >= 0.4) { const be = entry + (isBuy ? 1 : -1) * slD * 0.05; if (isBuy ? be > newSL : be < newSL) newSL = be; }
      if (newSL !== posSL) {
        posSL = newSL;
        if (pos.live && pos.live_order_id && broker) { try { await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: pos.live_order_id, stopLoss: Math.round(newSL * 100) / 100, takeProfit: Number(pos.tp) }); } catch { /* iterimi tjetër */ } }
      }
      await persistProtection(); // FIX: SL i ngritur + kulmi ruhen në DB — mbijetojnë mes lakëve
      // TP/SL me çmimin e sekondës.
      if (isBuy ? px >= Number(pos.tp) : px <= Number(pos.tp)) { await closePos("tp", Number(pos.tp)); }
      else if (isBuy ? px <= posSL : px >= posSL) { await closePos(bestFav / slD >= 0.8 ? "trail" : (bestFav / slD >= 0.4 ? "be" : "sl"), posSL); }
      else {
        // Burst i kundërt → dil; ngecje (moshë > fast_stall_s dhe fitim i vockël) → dil.
        const win = cs.filter((c) => c.t >= nowS - W);
        const mv = win.length >= 3 ? win[win.length - 1].c - win[0].c : 0;
        const against = isBuy ? -mv : mv;
        const ageS = (Date.now() - new Date(pos.opened_at).getTime()) / 1000;
        if (against >= (Number(cfg.fast_move_usd) || 1.2) * 0.8) await closePos(fav > 0 ? "trail" : "sl", px);
        else if (ageS >= (Number(cfg.fast_stall_s) || 45) && fav < 0.2 * slD) await closePos(fav > 0 ? "trail" : "expired", px);
      }
      await sleep(4000); continue;
    }

    // --- HYRJA: burst i konfirmuar (vetëm kur s'ka pozicion) ---
    if (Date.now() - lastClosed < (Number(cfg.fast_cooldown_s) || 60) * 1000) { await sleep(4000); continue; }
    const win = cs.filter((c) => c.t >= nowS - W);
    if (win.length >= 3) {
      const move = win[win.length - 1].c - win[0].c;
      const side: "BUY" | "SELL" = move > 0 ? "BUY" : "SELL";
      let buyV = 0, sellV = 0;
      for (const c of win) { const bd = Math.abs(c.c - c.o) * (c.v || 1); if (c.c >= c.o) buyV += bd; else sellV += bd; }
      const tot = buyV + sellV;
      const pressure = tot > 0 ? (side === "BUY" ? buyV / tot : sellV / tot) : 0;
      const trendOk = (side === "BUY" && m1Trend === 1) || (side === "SELL" && m1Trend === -1);

      if (!pending && Math.abs(move) >= (Number(cfg.fast_move_usd) || 1.2) && pressure >= 0.65 && trendOk) {
        pending = { side, t0: Date.now(), move, p0: px };
      } else if (pending && Date.now() - pending.t0 >= 3000) {
        // KONFIRMIMI (~4s më vonë): lëvizja mbahet ≥60%?
        const held = pending.side === "BUY"
          ? (px - (pending.p0 - pending.move)) / pending.move
          : (((pending.p0 + Math.abs(pending.move)) - px) / Math.abs(pending.move));
        const b = pending; pending = null;
        // ROJA ANTI-DYFISHIM: nëse një robot tjetër MMT (scalp/long) sapo hapi në të NJËJTIN
        // drejtim (≤2 min), mos hyr edhe fast — dy hyrje identike në të njëjtin çast = rrezik 2×.
        let dup = false;
        try {
          const { data: recent } = await db.from("mmt_trades").select("id").eq("status", "open").eq("side", b.side)
            .gte("opened_at", new Date(Date.now() - 120_000).toISOString()).limit(1);
          dup = !!(recent && recent.length);
        } catch { /* në dyshim, lejo */ }
        if (!dup && held >= 0.6 && fastToday.length < (Number(cfg.fast_max_day) || 10)) {
          const slD = Math.max(1, Number(cfg.fast_sl_usd) || 2);
          const sl = b.side === "BUY" ? px - slD : px + slD;
          const tp = b.side === "BUY" ? px + slD * (Number(cfg.fast_tp_rr) || 1.2) : px - slD * (Number(cfg.fast_tp_rr) || 1.2);
          const riskU = Number(cfg.paper_equity) * (Number(cfg.risk_pct) / 100);
          const lots = Math.max(0.01, Math.floor((riskU / (slD * VPP)) * 100) / 100);
          let lOk = false, lId: string | null = null;
          if (broker) {
            try {
              const r = await maTrade(broker, { actionType: b.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: broker.symbol, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), stopLoss: Math.round(sl * 100) / 100, takeProfit: Math.round(tp * 100) / 100, comment: "MMT-F" });
              const rb = r.body as { orderId?: string } | null;
              lOk = r.ok && !!rb?.orderId; lId = rb?.orderId ?? null;
              try { await db.from("trade_executions").insert({ user_id: cfg.live_user_id, symbol: "XAUUSD", action: b.side, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), entry_price: Math.round(px * 100) / 100, stop_loss: Math.round(sl * 100) / 100, take_profit: Math.round(tp * 100) / 100, mode: "live", status: lOk ? "executed" : "error", reason: (lOk ? "MMT-F fast (burst 1s i konfirmuar)" : `MMT-F live dështoi (${r.status})`).slice(0, 200), metaapi_order_id: lId, raw_response: r.body ?? null }); } catch { /* logu s'ndal lakun */ }
            } catch { /* letra vazhdon */ }
          }
          const { data: ins } = await db.from("mmt_trades").insert({ symbol: "XAUUSD", side: b.side, strategy: "fast", regime: "FAST", entry_price: Math.round(px * 100) / 100, sl: Math.round(sl * 100) / 100, tp: Math.round(tp * 100) / 100, lots, risk_usd: Math.round(slD * VPP * lots * 100) / 100, reason: `fast 1s: burst ${b.move > 0 ? "+" : ""}${b.move.toFixed(2)}$/${W}s i konfirmuar`, live: lOk, live_order_id: lId }).select().single();
          pos = ins as unknown as FastPos; posSL = Number(pos.sl); bestFav = 0;
          fastToday.push({ status: "open", pnl_usd: null, strategy: "fast", opened_at: new Date().toISOString(), closed_at: null });
          await beat(b.side === "BUY" ? "open_buy" : "open_sell", null, px);
        }
      }
    }
    await sleep(4000);
  }

  // Heartbeat i fund-lakut (faqja: WORKER GJALLË).
  await beat(pos ? `fast_pozicion_${pos.side}` : "fast_alive", null, lastBeatPx);
  return json({ ok: true, pos: !!pos });
});
