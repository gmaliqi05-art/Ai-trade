import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// MMT-FAST-LOOP v2 — roboti i sekondave me TIKË LIVE (milisekonda).
// Cron-i e thërret çdo minutë; brenda, funksioni hap WEBSOCKET te stream-i i
// tikëve (Binance aggTrade via binance.vision — pa gjeo-bllokim) dhe REAGON NË
// ÇDO TIK në kohë reale (~milisekonda zbulimi; ekzekutimi te brokeri ~200-500ms).
// Nëse websocket-i dështon → bie te polling-u 1s çdo ~4s (rezerva e provuar).
// Logjika (NDJEKËSI i lëvizjes): burst i vogël i konfirmuar (0.4s) → hyrje me
// bracket SL+TP; +$0.50 favor → SL në 0; ndiqet KULMI çdo tik dhe DILET sapo
// çmimi kthehet ~$0.40 nga kulmi (fitim i kyçur ose 0); SL i plotë = vetëm
// frena e fatkeqësisë. Rojë anti-dyfishim me robotët e tjerë MMT.
// I PAVARUR: kontrollohet vetëm nga fast_on + kufijtë fast_* (kill/stop/max të
// vetët) — sesionet, blackout-i dhe kill-switch-i i përbashkët NUK e ndalin.
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

interface C1s { t: number; o: number; h: number; l: number; c: number; v: number; }
interface Tick { t: number; p: number; q: number; sellAggr: boolean; }
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
// Çmimi REAL i brokerit — SL/TP live DUHEN në kornizën e tij: XAUUSD+ ndryshon
// disa $ nga PAXG, ndryshe brokeri i refuzon me TRADE_RETCODE_INVALID_STOPS.
async function maQuote(b: Broker): Promise<{ bid: number; ask: number } | null> {
  try {
    const r = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/symbols/${encodeURIComponent(b.symbol)}/current-price?keepSubscription=false`, {
      headers: { "auth-token": b.token }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { bid?: number; ask?: number };
    return typeof j.bid === "number" && typeof j.ask === "number" ? { bid: j.bid, ask: j.ask } : null;
  } catch { return null; }
}
// Pozicioni REAL te brokeri (hyrja, çmimi tani, SL/TP, fitimi real) — burimi i
// vërtetë për menaxhimin e parave reale (jo PAXG).
interface MaPos { id: string; type: string; openPrice: number; currentPrice: number; stopLoss?: number; takeProfit?: number; profit?: number; volume?: number; }
async function maPositions(b: Broker): Promise<MaPos[] | null> {
  try {
    const r = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/positions`, {
      headers: { "auth-token": b.token }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return (await r.json()) as MaPos[];
  } catch { return null; }
}
// Fitimi REAL i realizuar për një pozicion që brokeri e mbylli vetë (TP/SL server-side).
async function maRealizedPnl(b: Broker, positionId: string): Promise<number | null> {
  try {
    const r = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/history-deals/position/${positionId}`, {
      headers: { "auth-token": b.token }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const deals = (await r.json()) as { profit?: number; commission?: number; swap?: number }[];
    if (!Array.isArray(deals) || !deals.length) return null;
    return deals.reduce((a, d) => a + Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0), 0);
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Vetëm cron-i (x-cron-secret).
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "unauthorized" }, 401); }

  const { data: cfgRow } = await db.from("mmt_config").select("*").eq("id", 1).maybeSingle();
  const cfg = cfgRow as Record<string, never> & {
    fast_on: boolean; fast_runner: string; paper_equity: number; risk_pct: number;
    fast_move_usd: number; fast_window_s: number; fast_sl_usd: number; fast_tp_rr: number;
    fast_stall_s: number; fast_max_day: number; fast_cooldown_s: number;
    fast_kill_after_sl: number | null; fast_daily_stop_usd: number | null; fast_pullback_usd: number | null;
    live_enabled: boolean; live_lots: number; live_user_id: string | null;
  } | null;
  if (!cfg) return json({ error: "mmt_config mungon" }, 500);

  const beat = async (decision: string, reject: string | null, price: number | null) => {
    try { await db.from("mmt_scan_log").insert({ price, regime: "FAST", decision, reject_reason: reject }); } catch { /* diagnostikë */ }
  };

  // Portat e qeta (heartbeat çdo minutë).
  // MMT-Fast është I PAVARUR: e ndalin VETËM çelësi i tij FAST dhe kufijtë e tij
  // fast_* — jo çelësi global, jo sesionet, jo blackout-i, jo kill-switch-i i
  // përbashkët. E vetmja ndalesë e jashtme: tregu i arit i mbyllur (fundjava).
  if (cfg.fast_runner !== "edge") { await beat("fast_alive", "runner_vps", null); return json({ ok: true, skip: "runner_vps" }); }
  if (!cfg.fast_on) { await beat("fast_alive", "fast_off", null); return json({ ok: true, skip: "fast_off" }); }
  const nowD = new Date(); const dow = nowD.getUTCDay(); const hU = nowD.getUTCHours();
  if (dow === 6 || (dow === 0 && hU < 22) || (dow === 5 && hU >= 21)) { await beat("fast_alive", "treg_mbyllur", null); return json({ ok: true, skip: "market_closed" }); }

  // Kufijtë ditorë — VETËM të Fast-it (humbjet e Long/Scalp nuk e ngrijnë).
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { data: dayR } = await db.from("mmt_trades").select("status, pnl_usd, opened_at, closed_at").eq("strategy", "fast").gte("opened_at", today.toISOString());
  const fastToday = (dayR ?? []) as { status: string; pnl_usd: number | null; opened_at: string; closed_at: string | null }[];
  // KILL numëron VETËM humbjet REALE (pnl<0) — jo daljet me fitim që dikur etiketoheshin "sl".
  const fastSl = fastToday.filter((r) => r.status === "sl" && Number(r.pnl_usd ?? 0) < 0).length;
  const fastPnl = fastToday.reduce((a, r) => a + Number(r.pnl_usd ?? 0), 0);
  // Kufijtë NDALOJNË vetëm HYRJET E REJA — jo menaxhimin e pozicionit të hapur (i cili
  // duhet të vazhdojë të mbrohet/mbyllet sipas çmimit real edhe pas kill-switch-it).
  let entryBlock: string | null = null;
  if (fastSl >= (Number(cfg.fast_kill_after_sl) || 3)) entryBlock = `fast_kill(${fastSl}SL)`;
  else if (fastPnl <= -(Number(cfg.fast_daily_stop_usd) || 12)) entryBlock = `fast_stop_ditor(${fastPnl.toFixed(2)}$)`;
  else if (fastToday.length >= (Number(cfg.fast_max_day) || 40)) entryBlock = `fast_max_day(${fastToday.length})`;
  const lastClosed = fastToday.filter((r) => r.closed_at).map((r) => new Date(r.closed_at!).getTime()).sort((a, b) => b - a)[0] || 0;

  // Kredencialet live + trendi 1m.
  let broker: Broker | null = null;
  if (cfg.live_enabled && cfg.live_user_id) {
    const { data: mc } = await db.from("metaapi_config").select("account_id, token, region, kill_switch, symbol_map").eq("user_id", cfg.live_user_id).maybeSingle();
    const m = mc as { account_id?: string; token?: string; region?: string; kill_switch?: boolean; symbol_map?: Record<string, string> | null } | null;
    if (m?.account_id && m?.token && m.kill_switch !== true) broker = { account_id: m.account_id, token: m.token, region: m.region || "london", symbol: (m.symbol_map && m.symbol_map["XAUUSD"]) || "XAUUSD" };
  }
  // PA filtra indikatorësh: analizat i bëjnë MMT-Long/Scalp — Fast vetëm NDJEK
  // lëvizjen (bursti + presioni i agresorëve janë e gjithë "analiza" e tij).

  // Pozicioni fast i hapur + KUJTESA e mbrojtjes (best_fav nga DB + rillogaritje nga 1s).
  interface FastPos { id: string; side: string; entry_price: number; sl: number; tp: number; lots: number; risk_usd: number; live: boolean; live_order_id: string | null; opened_at: string; best_fav?: number | null; }
  const { data: openF } = await db.from("mmt_trades").select("*").eq("strategy", "fast").eq("status", "open").limit(1);
  let pos = ((openF ?? [])[0] as FastPos | undefined) || null;
  // Nëse hyrjet janë të bllokuara (kill/stop/max) DHE s'ka pozicion të hapur → s'ka ç'të
  // bëhet. Por nëse KA pozicion të hapur, VAZHDOJMË ta menaxhojmë (mbrojtje mbi çmim real).
  if (entryBlock && !pos) { await beat("fast_alive", entryBlock, null); return json({ ok: true, skip: entryBlock }); }
  let posSL = pos ? Number(pos.sl) : 0;
  let bestFav = pos ? Math.max(0, Number(pos.best_fav ?? 0)) : 0;
  // Rillogaritja e best_fav nga historia PAXG vlen VETËM për pozicionet në letër.
  // Për pozicionet REALE, best_fav llogaritet nga çmimi i vërtetë i brokerit (te manageLive) —
  // PAXG është instrument tjetër që divergon dhe do ta prishte menaxhimin e parave reale.
  if (pos && !pos.live) {
    try {
      const hist = await k1s(300);
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
  // Zhvendosja broker↔PAXG (freskohet çdo 20s) — çdo SL/TP live dërgohet me të.
  // RREGULLIM KRITIK: kur thirrja e çmimit dështon (rate-limit i MetaApi — shkaku i vërtetë
  // pse hyrjet live "anuloheshin" ndërsa manualet kalonin), RIPROVOHET 3× dhe si rezervë
  // përdoret offset-i i ruajtur i freskët (≤30s) — hyrja live NUK anulohet më kot.
  let liveOff: { v: number; ts: number } | null = null;
  const brokerOff = async (px: number, wantFresh = false): Promise<number | null> => {
    if (!broker) return null;
    const cacheOk = wantFresh ? 3_000 : 20_000; // hyrja kërkon çmim shumë të freskët
    if (liveOff && Date.now() - liveOff.ts < cacheOk) return liveOff.v;
    for (let i = 0; i < 3; i++) {
      const q = await maQuote(broker);
      if (q) { liveOff = { v: (q.bid + q.ask) / 2 - px, ts: Date.now() }; return liveOff.v; }
      await sleep(300);
    }
    // Rezerva: offset-i i fundit nëse është i freskët (offset-i lëviz ngadalë — i sigurt ≤30s).
    return liveOff && Date.now() - liveOff.ts < 30_000 ? liveOff.v : null;
  };

  let lastPersistedSL = posSL, lastPersistedFav = bestFav;
  const persistProtection = async () => {
    if (!pos) return;
    if (posSL === lastPersistedSL && Math.abs(bestFav - lastPersistedFav) < 0.05) return;
    try {
      await db.from("mmt_trades").update({ sl: Math.round(posSL * 100) / 100, best_fav: Math.round(bestFav * 100) / 100 }).eq("id", pos.id);
      lastPersistedSL = posSL; lastPersistedFav = bestFav;
    } catch { /* tiku tjetër */ }
  };

  // ======= GJENDJA E TIKËVE + LOGJIKA E UNIFIKUAR (ushqehet nga WS ose polling) =======
  // Rrjedha PAXG ka PAK tregtime (disa/min) — pa themel dritarja mbetej bosh dhe
  // hyrja s'ndizej kurrë. Prandaj seria mbushet me kandelet 1s (themeli); tikët
  // live të websocket-it i shtohen sipër në kohë reale.
  let ticks: Tick[] = [];
  try {
    const seed = await k1s(120);
    if (seed) ticks = seed.map((c) => ({ t: c.t, p: c.c, q: c.v || 1, sellAggr: c.c < c.o }));
  } catch { /* WS/polling e mbushin */ }
  let pending: { side: "BUY" | "SELL"; t0: number; move: number; p0: number } | null = null;
  let lastBeatPx: number | null = null;
  const t0 = Date.now();
  const DEADLINE = 52_000; // ~52s punë për thirrje (cron çdo 60s)
  const W = Math.max(2, Number(cfg.fast_window_s) || 3);
  const nowS = () => Date.now() / 1000;
  let entriesThisRun = 0;

  const closePos = async (status: string, exit: number) => {
    if (!pos) return;
    const p = pos; pos = null;
    const isBuy = p.side === "BUY";
    const pnl = (isBuy ? exit - Number(p.entry_price) : Number(p.entry_price) - exit) * VPP * Number(p.lots);
    const rM = Number(p.risk_usd) > 0 ? pnl / Number(p.risk_usd) : 0;
    if (p.live && p.live_order_id && broker) { try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: p.live_order_id }); } catch { /* bracket-i mund ta ketë mbyllur */ } }
    try { await db.from("mmt_trades").update({ status, exit_price: Math.round(exit * 100) / 100, pnl_usd: Math.round(pnl * 100) / 100, r_multiple: Math.round(rM * 100) / 100, closed_at: new Date().toISOString() }).eq("id", p.id); } catch { /* */ }
    await beat(pnl >= 0 ? "fast_dalje_fitim" : "fast_dalje_humbje", `${status} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}$`, exit);
  };

  // MENAXHIMI — thirret në çdo tik (WS: milisekonda; polling: çdo ~4s).
  // Filozofia (kërkesa e pronarit): NDIQ lëvizjen dhe DIL PARA se të kthehet —
  // me fitim ose në 0. SL-ja e plotë është vetëm frena e fatkeqësisë.
  const PULL = Math.max(0.15, Number(cfg.fast_pullback_usd) || 0.4); // sa $ kthim nga kulmi = dil
  const BE_AT = 0.5; // +$0.50 favor → mbrojtja në 0 (pa humbje nga këtu e tutje)
  const manageTick = async (px: number) => {
    if (!pos) return;
    const isBuy = pos.side === "BUY";
    const entry = Number(pos.entry_price), slD = Math.abs(entry - Number(pos.sl)) || Number(cfg.fast_sl_usd) || 2;
    const fav = isBuy ? px - entry : entry - px;
    if (fav > bestFav) bestFav = fav;
    // Statusi i daljes sipas rezultatit: fitim → trail; ~0 → be; humbje e vogël
    // (kthim i hershëm) → expired; vetëm SL i plotë → sl (ai numërohet te kill-i).
    const exitStatus = (pnlPx: number) => pnlPx > 0.1 ? "trail" : (pnlPx >= -0.15 ? "be" : (pnlPx > -0.6 * slD ? "expired" : "sl"));
    let newSL = posSL;
    if (bestFav >= BE_AT) {
      // SL ndjek KULMIN nga afër: kulmi − PULL (min. mbrojtja në 0). Kthimi
      // >PULL nga kulmi godet SL-në → dalja me fitim të kyçur është AUTOMATIKE.
      const lock = entry + (isBuy ? 1 : -1) * Math.max(0.05, bestFav - PULL);
      if (isBuy ? lock > newSL : lock < newSL) newSL = lock;
    }
    if (newSL !== posSL) {
      posSL = newSL;
      if (pos.live && pos.live_order_id && broker) {
        try {
          const off = await brokerOff(px);
          if (off != null) await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: pos.live_order_id, stopLoss: Math.round((newSL + off) * 100) / 100, takeProfit: Math.round((Number(pos.tp) + off) * 100) / 100 });
        } catch { /* tiku tjetër */ }
      }
    }
    await persistProtection();
    if (isBuy ? px >= Number(pos.tp) : px <= Number(pos.tp)) return closePos("tp", Number(pos.tp));
    if (isBuy ? px <= posSL : px >= posSL) return closePos(exitStatus(isBuy ? posSL - entry : entry - posSL), posSL);
    // DALJA KRYESORE — kthim FIKS $PULL nga kulmi = dil MENJËHERË me fitimin e kyçur
    // (rezervë e çastit; SL-ja që ndjek kulmin e garanton edhe mes tikëve).
    if (bestFav >= BE_AT && bestFav - fav >= PULL) return closePos(exitStatus(fav), px);
    // Kthim i hershëm (para +0.5$): kundër-lëvizje e dukshme në dritare → dil në ~0/minus të vogël.
    const cut = nowS() - W;
    const win = ticks.filter((t) => t.t >= cut);
    if (win.length >= 5) {
      const mv = win[win.length - 1].p - win[0].p;
      const against = isBuy ? -mv : mv;
      if (against >= (Number(cfg.fast_move_usd) || 0.6) * 0.6) return closePos(exitStatus(fav), px);
    }
    const ageS = (Date.now() - new Date(pos.opened_at).getTime()) / 1000;
    if (ageS >= (Number(cfg.fast_stall_s) || 45) && fav < 0.15) return closePos(exitStatus(fav), px);
  };

  // ======= MENAXHIMI I POZICIONIT REAL — mbi çmimin e VËRTETË të MT5 (jo PAXG) =======
  // RREGULLIM KRITIK: Fast tregton para reale në XAUUSD, por PAXG (burimi i tikëve) është
  // instrument tjetër që divergon (p.sh. rihapja e së dielës: MT5 +$7, PAXG i sheshtë) —
  // prandaj menaxhimi mbi PAXG e mbyllte pozicionin real gabimisht. Tani best_fav/trailing/
  // dalja llogariten nga çmimi real i brokerit (marrë çdo ~2s); TP/SL server-side të brokerit
  // mbeten frena e fortë. Nuk e mbyllim KURRË pozicionin real mbi mungesë të dhënash.
  let liveBestFav = -1, liveSLmt = 0, lastLivePoll = 0;
  // Mbyllja e Fast shkruhet DIREKT te position_closes (tabela e Tregto Live): watchdog-u
  // 2-minutësh s'i kap dot pozicionet ~30-60s që hapen e mbyllen mes dy kontrolleve të tij —
  // vetë loop-i e di mbylljen në sekondë, me fitimin real të brokerit.
  const recordFastClose = async (p: FastPos, exitPx: number | null, net: number | null) => {
    if (!p.live_order_id || !cfg.live_user_id) return; // vetëm tregtitë LIVE
    try {
      await db.from("position_closes").upsert({
        user_id: cfg.live_user_id, position_id: String(p.live_order_id), symbol: broker?.symbol || "XAUUSD",
        action: p.side, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01),
        entry_price: Number(p.entry_price) || null, exit_price: exitPx != null ? Math.round(exitPx * 100) / 100 : null,
        net: net != null ? Math.round(net * 100) / 100 : null,
        source: "auto", horizon: "short", robot: "MMT-Fast",
        opened_at: p.opened_at, closed_at: new Date().toISOString(),
      }, { onConflict: "user_id,position_id" });
    } catch { /* raporti s'duhet të ndalë tregtimin */ }
  };
  const closePosLive = async (px: number, profit: number, status: string) => {
    if (!pos) return;
    const p = pos; pos = null;
    if (p.live_order_id && broker) { try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: p.live_order_id }); } catch { /* TP/SL mund ta ketë mbyllur */ } }
    const rM = Number(p.risk_usd) > 0 ? profit / Number(p.risk_usd) : 0;
    try { await db.from("mmt_trades").update({ status, exit_price: Math.round(px * 100) / 100, pnl_usd: Math.round(profit * 100) / 100, r_multiple: Math.round(rM * 100) / 100, closed_at: new Date().toISOString() }).eq("id", p.id); } catch { /* */ }
    await recordFastClose(p, px, profit);
    await beat(profit >= 0 ? "fast_dalje_fitim" : "fast_dalje_humbje", `${status} ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}$ (real MT5)`, px);
  };
  const manageLive = async () => {
    if (!pos || !pos.live || !pos.live_order_id || !broker) return;
    if (Date.now() - lastLivePoll < 2000) return; // ngop REST — çmimi real çdo ~2s
    lastLivePoll = Date.now();
    const positions = await maPositions(broker);
    if (positions == null) return; // s'e prekim pozicionin real pa të dhëna të sigurta
    const bp = positions.find((x) => String(x.id) === pos!.live_order_id);
    if (!bp) {
      // Pozicioni s'ekziston më te brokeri → TP/SL server-side e mbylli vetë. Merr fitimin
      // REAL nga historia e brokerit dhe reflektoje saktë në DB (win/loss i drejtë).
      const p = pos; pos = null;
      const real = p.live_order_id ? await maRealizedPnl(broker, p.live_order_id) : null;
      const pnl = real ?? 0;
      const st = real == null ? "mbyllur_broker" : (pnl > 0.1 ? "tp" : (pnl < -0.1 ? "sl" : "be"));
      const rM = Number(p.risk_usd) > 0 ? pnl / Number(p.risk_usd) : 0;
      try { await db.from("mmt_trades").update({ status: st, pnl_usd: real != null ? Math.round(pnl * 100) / 100 : null, r_multiple: real != null ? Math.round(rM * 100) / 100 : null, closed_at: new Date().toISOString() }).eq("id", p.id); } catch { /* */ }
      await recordFastClose(p, null, real);
      await beat(pnl >= 0 ? "fast_dalje_fitim" : "fast_dalje_humbje", `brokeri e mbylli ${real != null ? (pnl >= 0 ? "+" : "") + pnl.toFixed(2) + "$ (real)" : ""}`, lastBeatPx);
      return;
    }
    const isBuy = pos.side === "BUY";
    const px = Number(bp.currentPrice), entry = Number(bp.openPrice);
    const profit = Number(bp.profit ?? 0);
    if (!Number.isFinite(px) || !Number.isFinite(entry)) return;
    lastBeatPx = px;
    const slD = Math.max(1, Number(cfg.fast_sl_usd) || 2);
    if (liveBestFav < 0) { liveSLmt = bp.stopLoss != null ? Number(bp.stopLoss) : (isBuy ? entry - slD : entry + slD); liveBestFav = 0; }
    const fav = isBuy ? px - entry : entry - px;
    if (fav > liveBestFav) liveBestFav = fav;
    // Trailing: SL ndjek kulmin − PULL pas +BE_AT (në kornizë REALE MT5 → dërgohet drejt).
    let newSL = liveSLmt;
    if (liveBestFav >= BE_AT) {
      const lock = entry + (isBuy ? 1 : -1) * Math.max(0.05, liveBestFav - PULL);
      if (isBuy ? lock > newSL : lock < newSL) newSL = lock;
    }
    if (newSL !== liveSLmt) {
      liveSLmt = newSL;
      try { await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: pos.live_order_id, stopLoss: Math.round(newSL * 100) / 100, takeProfit: bp.takeProfit ?? undefined }); } catch { /* poll-i tjetër */ }
      try { await db.from("mmt_trades").update({ sl: Math.round(newSL * 100) / 100, best_fav: Math.round(liveBestFav * 100) / 100 }).eq("id", pos.id); } catch { /* */ }
    }
    // DALJA me fitim të kyçur: kthim ≥ PULL nga kulmi (pas +BE_AT) → mbyll TANI në çmim real.
    const exitStatus = (pf: number) => pf > 0.1 ? "trail" : (pf >= -0.15 ? "be" : "expired");
    if (liveBestFav >= BE_AT && liveBestFav - fav >= PULL) return closePosLive(px, profit, exitStatus(profit));
    // Stall: pas fast_stall_s pa favor → dil (SL i plotë e bën vetë brokeri).
    const ageS = (Date.now() - new Date(pos.opened_at).getTime()) / 1000;
    if (ageS >= (Number(cfg.fast_stall_s) || 45) && fav < 0.15) return closePosLive(px, profit, exitStatus(profit));
  };

  // HYRJA — burst në tikë live me presion agresorësh + konfirmim 1.2s.
  const tryEntryTick = async (px: number) => {
    if (entryBlock) return; // kill/stop/max — pa hyrje të reja (menaxhimi i të hapurit vazhdon)
    if (pos || Date.now() - lastClosed < (Number(cfg.fast_cooldown_s) || 15) * 1000) return;
    if (fastToday.length + entriesThisRun >= (Number(cfg.fast_max_day) || 40)) return;
    const TH = Number(cfg.fast_move_usd) || 0.6;
    // Trigger 1 — BURST: lëvizje ≥TH brenda W sekondave.
    const cut = nowS() - W;
    const win = ticks.filter((t) => t.t >= cut);
    const burstMove = win.length >= 3 ? win[win.length - 1].p - win[0].p : 0;
    // Trigger 2 — RRJEDHË: çmimi ka ecur ≥TH brenda 30s DHE është te kulmi i saj
    // (lëvizje e qëndrueshme — kap edhe ngjitjet/rëniet graduale, jo vetëm shpërthimet).
    const w30 = ticks.filter((t) => t.t >= nowS() - 30);
    let driftMove = 0;
    if (w30.length >= 5) {
      const hi = Math.max(...w30.map((t) => t.p)), lo = Math.min(...w30.map((t) => t.p));
      if (px - lo >= TH && hi - px <= 0.15) driftMove = px - lo;
      else if (hi - px >= TH && px - lo <= 0.15) driftMove = -(hi - px);
    }
    const move = Math.abs(burstMove) >= TH ? burstMove : driftMove;
    if (move === 0 && !pending) return;
    const side: "BUY" | "SELL" = move > 0 ? "BUY" : "SELL";
    if (!pending) {
      if (Math.abs(move) < TH) return;
      // Presioni i agresorëve — kontrollohet vetëm kur ka mjaft tikë REALË;
      // me rrjedhë të rrallë nuk e bllokon hyrjen.
      const src = Math.abs(burstMove) >= TH ? win : w30;
      if (src.length >= 6) {
        let buyV = 0, sellV = 0;
        for (const t of src) { if (t.sellAggr) sellV += t.q; else buyV += t.q; }
        const tot = buyV + sellV;
        if (tot > 0) { const pressure = side === "BUY" ? buyV / tot : sellV / tot; if (pressure < 0.55) return; }
      }
      pending = { side, t0: Date.now(), move, p0: px };
      return;
    }
    if (Date.now() - pending.t0 < 400) return; // konfirmim i shkurtër 0.4s — sa për të skartuar tik-un e vetëm false
    const b = pending; pending = null;
    const held = b.side === "BUY"
      ? (px - (b.p0 - b.move)) / b.move
      : (((b.p0 + Math.abs(b.move)) - px) / Math.abs(b.move));
    if (!(held >= 0.5)) return;
    // ROJA ANTI-DYFISHIM: robot tjetër MMT sapo hapi në të njëjtin drejtim (≤2 min) → mos hyr.
    try {
      const { data: recent } = await db.from("mmt_trades").select("id").eq("status", "open").eq("side", b.side)
        .gte("opened_at", new Date(Date.now() - 120_000).toISOString()).limit(1);
      if (recent && recent.length) return;
    } catch { /* në dyshim, lejo */ }

    const slD = Math.max(1, Number(cfg.fast_sl_usd) || 2);
    const sl = b.side === "BUY" ? px - slD : px + slD;
    const tp = b.side === "BUY" ? px + slD * (Number(cfg.fast_tp_rr) || 1.2) : px - slD * (Number(cfg.fast_tp_rr) || 1.2);
    const riskU = Number(cfg.paper_equity) * (Number(cfg.risk_pct) / 100);
    const lots = Math.max(0.01, Math.floor((riskU / (slD * VPP)) * 100) / 100);
    let lOk = false, lId: string | null = null;
    // KORNIZA E DB: për tregti reale ruajmë në kornizën MT5 (të brokerit) që vija në grafik
    // = TP/SL reale = qirinjtë MT5. Për letër mbetet PAXG. (Off = MT5 − PAXG.)
    let dbEntry = px, dbSL = sl, dbTp = tp;
    if (broker) {
      try {
        // SL/TP përkthehen në kornizën e çmimit të brokerit (jo PAXG) — përndryshe INVALID_STOPS.
        const off = await brokerOff(px, true); // çmim i freskët me riprovë + rezervë ≤30s
        const slL = off != null ? sl + off : null, tpL = off != null ? tp + off : null;
        if (slL != null && tpL != null && off != null) {
          const orderBody = { actionType: b.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: broker.symbol, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), stopLoss: Math.round(slL * 100) / 100, takeProfit: Math.round(tpL * 100) / 100, comment: "MMT-F" };
          let r = await maTrade(broker, orderBody);
          // Gabimet KALIMTARE të brokerit → riprovo deri 3×: PRICE_OFF 10021, REQUOTE 10004,
          // dhe NO_MONEY 10019 (serveri demo i Vantage VALËZON gjatë volatilitetit ekstrem —
          // e provuar 07-16: refuzim në 17:26, pranim i të njëjtit urdhër në 17:33).
          for (let a = 0; a < 3; a++) {
            const rb0 = r.body as { orderId?: string; numericCode?: number } | null;
            if (r.ok && rb0?.orderId) break;
            if (rb0?.numericCode !== 10021 && rb0?.numericCode !== 10004 && rb0?.numericCode !== 10019) break;
            await sleep(500);
            r = await maTrade(broker, orderBody);
          }
          const rb = r.body as { orderId?: string } | null;
          lOk = r.ok && !!rb?.orderId; lId = rb?.orderId ?? null;
          if (lOk) { dbEntry = px + off; dbSL = slL; dbTp = tpL; } // ruaj në kornizën MT5
          try { await db.from("trade_executions").insert({ user_id: cfg.live_user_id, symbol: "XAUUSD", action: b.side, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), entry_price: Math.round((px + off) * 100) / 100, stop_loss: Math.round(slL * 100) / 100, take_profit: Math.round(tpL * 100) / 100, mode: "live", status: lOk ? "executed" : "error", reason: (lOk ? "MMT-F fast tik-live (burst i konfirmuar)" : `MMT-F live dështoi (${r.status})`).slice(0, 200), metaapi_order_id: lId, raw_response: r.body ?? null }); } catch { /* logu s'ndal */ }
        } else {
          try { await db.from("trade_executions").insert({ user_id: cfg.live_user_id, symbol: "XAUUSD", action: b.side, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), entry_price: Math.round(px * 100) / 100, stop_loss: Math.round(sl * 100) / 100, take_profit: Math.round(tp * 100) / 100, mode: "live", status: "error", reason: "MMT-F live u anulua: s'u mor çmimi i brokerit", raw_response: null }); } catch { /* */ }
        }
      } catch { /* letra vazhdon */ }
    }
    const { data: ins } = await db.from("mmt_trades").insert({ symbol: "XAUUSD", side: b.side, strategy: "fast", regime: "FAST", entry_price: Math.round(dbEntry * 100) / 100, sl: Math.round(dbSL * 100) / 100, tp: Math.round(dbTp * 100) / 100, lots, risk_usd: Math.round(slD * VPP * lots * 100) / 100, reason: `fast tik-live: burst ${b.move > 0 ? "+" : ""}${b.move.toFixed(2)}$/${W}s i konfirmuar (ms)`, live: lOk, live_order_id: lId, best_fav: 0 }).select().single();
    pos = ins as unknown as FastPos; posSL = Number(pos.sl); bestFav = 0;
    lastPersistedSL = posSL; lastPersistedFav = 0;
    entriesThisRun++;
    await beat(b.side === "BUY" ? "open_buy" : "open_sell", null, px);
  };

  // ======= MOTORI 1: WEBSOCKET LIVE (tikët e shtyrë — reagim në milisekonda) =======
  let busy = false;
  const runWs = (): Promise<boolean> => new Promise((resolve) => {
    let opened = false, done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; try { ws.close(); } catch { /* */ } resolve(ok); } };
    let ws: WebSocket;
    try { ws = new WebSocket("wss://data-stream.binance.vision/ws/paxgusdt@aggTrade"); }
    catch { resolve(false); return; }
    const guard = setTimeout(() => finish(opened), Math.max(1000, DEADLINE - (Date.now() - t0)));
    ws.onopen = () => { opened = true; };
    ws.onerror = () => { if (!opened) { clearTimeout(guard); finish(false); } };
    ws.onclose = () => { clearTimeout(guard); finish(opened); };
    ws.onmessage = async (ev: MessageEvent) => {
      try {
        const m = JSON.parse(String(ev.data));
        const tick: Tick = { t: Number(m.T) / 1000, p: +m.p, q: +m.q, sellAggr: m.m === true };
        ticks.push(tick);
        if (ticks.length > 4000) ticks = ticks.filter((x) => x.t >= nowS() - 120);
        lastBeatPx = tick.p;
        if (Date.now() - t0 >= DEADLINE) { clearTimeout(guard); finish(true); return; }
        if (busy) return; // mos u mbivendos — tiku tjetër e merr gjendjen e re
        busy = true;
        // Pozicioni REAL → menaxho mbi çmimin e vërtetë MT5 (throttle 2s brenda manageLive);
        // pozicioni në letër → PAXG; pa pozicion → provo hyrje me tikun PAXG.
        try { if (pos && pos.live) await manageLive(); else if (pos) await manageTick(tick.p); else await tryEntryTick(tick.p); }
        finally { busy = false; }
      } catch { /* tik i dëmtuar — injoro */ }
    };
  });

  // ======= MOTORI 2 (rezervë): polling 1s çdo ~4s — pseudo-tikë nga qirinjtë =======
  const runPolling = async () => {
    while (Date.now() - t0 < DEADLINE) {
      const cs = await k1s(90);
      if (cs && cs.length >= 15) {
        ticks = cs.map((c) => ({ t: c.t, p: c.c, q: c.v || 1, sellAggr: c.c < c.o }));
        const px = cs[cs.length - 1].c;
        lastBeatPx = px;
        if (pos && pos.live) await manageLive(); else if (pos) await manageTick(px); else await tryEntryTick(px);
      }
      await sleep(4000);
    }
  };

  // Për pozicionin REAL: menaxho çdo ~1.5s PAVARËSISHT tikëve PAXG (brokeri lëviz edhe
  // kur PAXG hesht). Timer i pavarur; manageLive ka throttle-in e vet 2s te REST.
  let liveTimer: number | undefined;
  if (pos && pos.live) {
    liveTimer = setInterval(() => {
      if (busy) return;
      busy = true;
      manageLive().finally(() => { busy = false; });
    }, 1500) as unknown as number;
  }
  const wsOk = await runWs();
  if (liveTimer !== undefined) clearInterval(liveTimer);
  if (!wsOk && Date.now() - t0 < DEADLINE - 5000) await runPolling();

  await beat(pos ? `fast_pozicion_${pos.side}` : "fast_alive", wsOk ? null : "ws_fallback_polling", lastBeatPx);
  return json({ ok: true, ws: wsOk, pos: !!pos });
});
