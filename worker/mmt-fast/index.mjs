// ============================================================
// MMT-FAST — roboti TIK-PAS-TIKU i arit (Rruga A: gjithmonë-ndezur në VPS).
//
// ÇFARË BËN: lidhet me stream-in live të Binance (PAXG aggTrade — çdo tik, push,
// pa vonesë) dhe gjuan NISJEN e shpërthimeve: lëvizje ≥ fast_move_usd brenda
// fast_window_s sekondash me ≥70% presion agresor në atë drejtim, e KONFIRMUAR
// 1.2s më vonë (kundër burst-eve false që HFT-të i fade-ojnë). Hyn brenda
// sekondash me bracket të plotë (SL+TP të ngjitur = humbja më e keqe e
// paracaktuar), mbron te hyrja në +0.4R, trail 60% pas +0.8R, del në burst të
// kundërt ose në NGECJE ("nëse s'ecën në sekonda, s'ecën fare").
//
// "0 HUMBJE" NUK EKZISTON — ky robot synon: humbje të VOGLA të prera në sekonda
// (SL i ngushtë fiks) + fitues të mbrojtur MENJËHERË (BE +0.4R). Matematika e
// fitimit vjen nga disiplina, jo nga magjia.
//
// SIGURIA: fast_on (OFF default) lexohet çdo 15s nga mmt_config — fike nga faqja
// MMT dhe roboti ndalon brenda sekondash. Kufij: 1 pozicion njëherësh,
// fast_max_day/ditë, cooldown pas çdo daljeje, kill-switch pas N SL (i përbashkët
// me MMT), stop ditor %, sesionet dhe blackout-i i MMT respektohen.
//
// ENV të nevojshme: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Nisja: npm install && npm start   (shih README.md për VPS/Railway/Fly)
// ============================================================

import WebSocket from "ws";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Mungojnë SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const VPP = 100; // ari: $1 lëvizje × 1 lot = $100
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Supabase REST (pa varësi — fetch i Node 20) ----------
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbSelect(table, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`${table}: ${r.status}`);
  return r.json();
}
async function sbInsert(table, row) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: { ...sbHeaders, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`${table} insert: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j) ? j[0] : j;
}
async function sbUpdate(table, match, patch) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${match}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`${table} update: ${r.status}`);
}

// ---------- MetaApi (identike me motorët e provuar) ----------
const maHost = (r) => `https://mt-client-api-v1.${(r || "london").trim()}.agiliumtrade.ai`;
async function maTrade(b, body) {
  const resp = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/trade`, {
    method: "POST", headers: { "auth-token": b.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const txt = await resp.text();
  let j = txt; try { j = JSON.parse(txt); } catch { /* tekst */ }
  return { ok: resp.ok, status: resp.status, body: j };
}

// ---------- Gjendja ----------
let cfg = null;                 // mmt_config (rifreskohet çdo 15s)
let broker = null;              // kredencialet live + simboli real (p.sh. XAUUSD+)
let ticks = [];                 // buffer rrotullues i tikëve {t, p, q, sellAggr}
let pos = null;                 // pozicioni i hapur fast {id, side, entry, sl, tp, lots, live, liveId, bestFav, lastExtremeAt, riskUsd}
let lastExitAt = 0;             // për cooldown
let pending = null;             // burst në pritje konfirmimi {side, p0, t0}
let m1Trend = 0;                // 1 = EMA9>EMA21 (1m), -1 = nën, 0 = e panjohur (rifreskohet çdo 30s)
let wsConnected = false;        // statusi i lidhjes me stream-in (për heartbeat diagnostik)

const nowS = () => Date.now() / 1000;
const px = () => (ticks.length ? ticks[ticks.length - 1].p : null);

// ---------- Konfigurimi + kredencialet (rifreskim i vazhdueshëm) ----------
async function refreshCfg() {
  try {
    const rows = await sbSelect("mmt_config", "id=eq.1&select=*");
    cfg = rows[0] || null;
    if (cfg?.live_enabled && cfg?.live_user_id) {
      const mc = await sbSelect("metaapi_config", `user_id=eq.${cfg.live_user_id}&select=account_id,token,region,kill_switch,symbol_map`);
      const m = mc[0];
      broker = (m?.account_id && m?.token && m.kill_switch !== true)
        ? { account_id: m.account_id, token: m.token, region: m.region || "london", symbol: (m.symbol_map && m.symbol_map["XAUUSD"]) || "XAUUSD" }
        : null;
    } else broker = null;
  } catch (e) { log("cfg refresh dështoi:", e.message); }
}

// Mikro-trendi 1m (filtri i drejtimit — hulumtimi: pa filtër burst-et false të vrasin).
async function refreshTrend() {
  try {
    // data-api.binance.vision: e njëjta e dhënë publike, PA bllokim gjeografik (binance.com
    // bllokon IP-të e SHBA-së — serverat e Railway janë aty; kjo e zgjidh).
    const r = await fetch("https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=30", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;
    const raw = await r.json();
    const closes = raw.map((k) => +k[4]);
    const ema = (v, p) => { const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; for (let i = p; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; };
    m1Trend = ema(closes, 9) > ema(closes, 21) ? 1 : -1;
  } catch { /* provohet sërish */ }
}

// ---------- Kufijtë ditorë (para çdo hyrjeje — pyet DB live) ----------
async function dayLimitsOk() {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const rows = await sbSelect("mmt_trades", `opened_at=gte.${today.toISOString()}&select=status,pnl_usd,strategy`);
  const slN = rows.filter((r) => r.status === "sl").length;
  const pnl = rows.reduce((a, r) => a + Number(r.pnl_usd ?? 0), 0);
  const fastN = rows.filter((r) => r.strategy === "fast").length;
  if (slN >= (cfg.kill_after_sl ?? 2)) return `kill_switch(${slN}SL)`;
  if (pnl <= -Number(cfg.paper_equity) * (Number(cfg.daily_stop_pct) / 100)) return `stop_ditor(${pnl.toFixed(0)}$)`;
  if (fastN >= (cfg.fast_max_day ?? 10)) return `fast_max_day(${fastN})`;
  return null;
}
function inSession() {
  const h = new Date().getUTCHours();
  return (cfg.sessions || [[7, 10], [13, 21]]).some(([a, b]) => h >= a && h < b);
}

// ---------- HYRJA: zbulimi i burst-it + konfirmimi ----------
function detectBurst() {
  const w = Math.max(2, Number(cfg.fast_window_s) || 5);
  const cut = nowS() - w;
  const win = ticks.filter((t) => t.t >= cut);
  if (win.length < 8) return null; // duhen mjaftueshëm tikë (aktivitet real, jo treg i vdekur)
  const move = win[win.length - 1].p - win[0].p;
  if (Math.abs(move) < (Number(cfg.fast_move_usd) || 1.2)) return null;
  // Presioni i agresorëve (aggTrade.m: true = shitësi agresor) — peshuar me vëllim.
  let buyV = 0, sellV = 0;
  for (const t of win) { if (t.sellAggr) sellV += t.q; else buyV += t.q; }
  const tot = buyV + sellV; if (tot <= 0) return null;
  const side = move > 0 ? "BUY" : "SELL";
  const pressure = side === "BUY" ? buyV / tot : sellV / tot;
  if (pressure < 0.7) return null;                                   // rrjedha e parasë duhet ta mbështesë
  if ((side === "BUY" && m1Trend !== 1) || (side === "SELL" && m1Trend !== -1)) return null; // me mikro-trendin
  return { side, p0: px(), t0: nowS(), move };
}

async function tryEnter() {
  if (!cfg?.fast_on || !cfg?.active) { pending = null; return; }
  if (pos || nowS() - lastExitAt < (Number(cfg.fast_cooldown_s) || 60)) return;
  if (cfg.blackout_until && new Date(cfg.blackout_until).getTime() > Date.now()) return;
  if (!inSession()) { pending = null; return; }

  if (!pending) { const b = detectBurst(); if (b) { pending = b; log(`burst ${b.side} +${b.move.toFixed(2)}$ — pres konfirmimin…`); } return; }

  // KONFIRMIMI (1.2s pas zbulimit): lëvizja duhet të MBAHET ≥60% — kundër burst-eve false.
  if (nowS() - pending.t0 < 1.2) return;
  const p = px(); const keep = pending.side === "BUY" ? p - pending.p0 + pending.move : pending.p0 - p + Math.abs(pending.move);
  const held = pending.side === "BUY" ? (p - (pending.p0 - pending.move)) / pending.move : ((pending.p0 + Math.abs(pending.move)) - p) / Math.abs(pending.move);
  const b = pending; pending = null;
  if (!(held >= 0.6)) { log("burst u fade-ua — anulohet"); return; }

  const limit = await dayLimitsOk();
  if (limit) { log("hyrja u bllokua:", limit); return; }

  // BRACKET i plotë: SL fiks i ngushtë + TP — humbja më e keqe e paracaktuar QË NË HYRJE.
  const slD = Math.max(1, Number(cfg.fast_sl_usd) || 2);
  const entry = px();
  const sl = b.side === "BUY" ? entry - slD : entry + slD;
  const tp = b.side === "BUY" ? entry + slD * (Number(cfg.fast_tp_rr) || 1.2) : entry - slD * (Number(cfg.fast_tp_rr) || 1.2);
  const riskUsd = Number(cfg.paper_equity) * (Number(cfg.risk_pct) / 100);
  const lots = Math.max(0.01, Math.floor((riskUsd / (slD * VPP)) * 100) / 100);

  let live = false, liveId = null;
  if (broker) {
    try {
      const r = await maTrade(broker, { actionType: b.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: broker.symbol, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), stopLoss: Math.round(sl * 100) / 100, takeProfit: Math.round(tp * 100) / 100, comment: "MMT-F" });
      live = r.ok && !!r.body?.orderId; liveId = r.body?.orderId ?? null;
      try { await sbInsert("trade_executions", { user_id: cfg.live_user_id, symbol: "XAUUSD", action: b.side, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), entry_price: Math.round(entry * 100) / 100, stop_loss: Math.round(sl * 100) / 100, take_profit: Math.round(tp * 100) / 100, mode: "live", status: live ? "executed" : "error", reason: (live ? "MMT-F fast tik (burst i konfirmuar)" : `MMT-F live dështoi (${r.status})`).slice(0, 200), metaapi_order_id: liveId, raw_response: r.body ?? null }); } catch { /* logu s'ndal robotin */ }
    } catch (e) { log("live dështoi:", e.message); }
  }
  const row = await sbInsert("mmt_trades", { symbol: "XAUUSD", side: b.side, strategy: "fast", regime: "FAST", entry_price: Math.round(entry * 100) / 100, sl: Math.round(sl * 100) / 100, tp: Math.round(tp * 100) / 100, lots, risk_usd: Math.round(slD * VPP * lots * 100) / 100, reason: `fast tik: burst ${b.move > 0 ? "+" : ""}${b.move.toFixed(2)}$/${cfg.fast_window_s}s i konfirmuar, presion ≥70%`, live, live_order_id: liveId });
  pos = { id: row.id, side: b.side, entry, sl, tp, lots, live, liveId, bestFav: 0, lastExtremeAt: nowS(), riskUsd: slD * VPP * lots, slD };
  log(`HYRJE ${b.side} @${entry.toFixed(2)} SL ${sl.toFixed(2)} TP ${tp.toFixed(2)}${live ? " [REAL " + liveId + "]" : " [letër]"}`);
}

// ---------- DALJA: çdo tik — BE i çastit, trail, burst i kundërt, ngecje, TP/SL ----------
async function closePos(status, exit) {
  const p = pos; pos = null; lastExitAt = nowS();
  const pnl = (p.side === "BUY" ? exit - p.entry : p.entry - exit) * VPP * p.lots;
  const rM = p.riskUsd > 0 ? pnl / p.riskUsd : 0;
  if (p.live && p.liveId && broker) { try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: p.liveId }); } catch { /* mund të jetë mbyllur nga bracket-i */ } }
  try { await sbUpdate("mmt_trades", `id=eq.${p.id}`, { status, exit_price: Math.round(exit * 100) / 100, pnl_usd: Math.round(pnl * 100) / 100, r_multiple: Math.round(rM * 100) / 100, closed_at: new Date().toISOString() }); } catch (e) { log("update dështoi:", e.message); }
  log(`DALJE ${status} @${exit.toFixed(2)} → ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}$ (${rM.toFixed(2)}R)`);
}
async function managePos() {
  if (!pos) return;
  const p = px(); if (p == null) return;
  const isBuy = pos.side === "BUY";
  const fav = isBuy ? p - pos.entry : pos.entry - p;
  if (fav > pos.bestFav) { pos.bestFav = fav; pos.lastExtremeAt = nowS(); }
  const r = fav / pos.slD;
  // MBROJTJA E ÇASTIT (+0.4R) → SL te hyrja + ofset; trail 60% pas +0.8R (edhe live via MODIFY).
  let newSL = pos.sl;
  if (pos.bestFav / pos.slD >= 0.8) { const lock = pos.entry + (isBuy ? 1 : -1) * pos.bestFav * 0.6; if (isBuy ? lock > newSL : lock < newSL) newSL = lock; }
  else if (pos.bestFav / pos.slD >= 0.4) { const be = pos.entry + (isBuy ? 1 : -1) * pos.slD * 0.05; if (isBuy ? be > newSL : be < newSL) newSL = be; }
  if (newSL !== pos.sl) {
    pos.sl = newSL;
    if (pos.live && pos.liveId && broker) { try { await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: pos.liveId, stopLoss: Math.round(newSL * 100) / 100, takeProfit: Math.round(pos.tp * 100) / 100 }); } catch { /* provohet në tikun tjetër */ } }
  }
  // TP / SL me tik real.
  if (isBuy ? p >= pos.tp : p <= pos.tp) return closePos("tp", pos.tp);
  if (isBuy ? p <= pos.sl : p >= pos.sl) return closePos(pos.sl === pos.entry + (isBuy ? 1 : -1) * pos.slD * 0.05 ? "be" : (pos.bestFav / pos.slD >= 0.8 ? "trail" : "sl"), pos.sl);
  // BURST I KUNDËRT (kthimi) → dil menjëherë ("dalje kur është kthimi").
  const w = Math.max(2, Number(cfg?.fast_window_s) || 5);
  const cut = nowS() - w;
  const win = ticks.filter((t) => t.t >= cut);
  if (win.length >= 8) {
    const mv = win[win.length - 1].p - win[0].p;
    const against = isBuy ? -mv : mv;
    if (against >= (Number(cfg?.fast_move_usd) || 1.2) * 0.8) return closePos(fav > 0 ? "trail" : "sl", p);
  }
  // NGECJA: pa ekstrem të ri për fast_stall_s → dil (fitues i vogël ose zero, jo pritje).
  if (nowS() - pos.lastExtremeAt >= (Number(cfg?.fast_stall_s) || 45)) return closePos(fav > 0 ? "trail" : "expired", p);
}

// ---------- Heartbeat (faqja MMT sheh që worker-i është GJALLË) ----------
// I PAVARUR nga tikët (setInterval) — raporton edhe kur stream-i s'lidhet dot,
// që problemi të DUKET te logu i skanimeve në vend që worker-i të rrijë memec.
async function heartbeat() {
  try {
    const ticksLastMin = ticks.filter((t) => t.t >= nowS() - 60).length;
    await sbInsert("mmt_scan_log", {
      price: px(), regime: "FAST",
      decision: pos ? `fast_pozicion_${pos.side}` : "fast_alive",
      reject_reason: !cfg?.fast_on ? "fast_off" : (!wsConnected ? "ws_i_shkeputur" : (ticksLastMin === 0 ? "pa_tike_1min" : null)),
    });
  } catch (e) { log("heartbeat dështoi:", e.message); }
}

// ---------- Websocket-i i tikëve (Binance aggTrade — push, pa vonesë) ----------
function connect() {
  // data-stream.binance.vision: i njëjti stream publik, PA bllokim gjeografik.
  const ws = new WebSocket("wss://data-stream.binance.vision/ws/paxgusdt@aggTrade");
  ws.on("open", () => { wsConnected = true; log("✓ i lidhur me stream-in e tikëve (PAXG aggTrade)"); });
  ws.on("message", async (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      ticks.push({ t: m.T / 1000, p: +m.p, q: +m.q, sellAggr: m.m === true });
      const cut = nowS() - 180; // mbaj 3 min tikë
      if (ticks.length > 6000 || (ticks[0] && ticks[0].t < cut - 60)) ticks = ticks.filter((t) => t.t >= cut);
      await managePos();
      await tryEnter();
    } catch (e) { log("tik err:", e.message); }
  });
  ws.on("close", () => { wsConnected = false; log("stream u mbyll — rilidhje pas 3s"); setTimeout(connect, 3000); });
  ws.on("error", (e) => { wsConnected = false; log("ws err:", e.message); try { ws.close(); } catch { /* */ } });
}

// ---------- Nisja ----------
log("MMT-FAST po niset…");
await refreshCfg();
await refreshTrend();
setInterval(refreshCfg, 15000);
setInterval(refreshTrend, 30000);
// Heartbeat i pavarur: i pari MENJËHERË (dëshmia e jetës edhe pa tikë), pastaj çdo 5 min.
await heartbeat();
setInterval(heartbeat, 5 * 60 * 1000);
connect();
