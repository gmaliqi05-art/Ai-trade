import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// MMT — SUPER ROBOTI (motor KOMPLET I VEÇANTË; HIJE/letër — ASNJË urdhër real).
// Ndërtuar nga: hulumtimi i industrisë (regime detection, prop-firm risk, PTJ 5:1),
// 415 trade-t e mësuara të MMTI (NY session, R:R 1:4, conf>=75) dhe Dhoma e
// Ekspertëve (kill-zones 07-10/13-17 UTC, 1 sinjal = 1 pozicion, kill-switch pas 2 SL).
// Parimi i artë: "Play great defense, not great offense" (Paul Tudor Jones).
// SHTRESAT: L0 Regjimi → L1 Ansambli → L2 Rreziku → L3 Ngjarjet → L4 Mbrojtja e fitimit.
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }

// ---------- Indikatorët (të vetëpërmbajtur — moduli s'varet nga asnjë funksion tjetër) ----------
function ema(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length < p) return out;
  const k = 2 / (p + 1);
  let s = 0; for (let i = 0; i < p; i++) s += v[i];
  let prev = s / p; out[p - 1] = prev;
  for (let i = p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsi(v: number[], p = 14): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const c = v[i] - v[i - 1]; if (c >= 0) g += c; else l -= c; }
  let ag = g / p, al = l / p;
  const rf = (a: number, b: number) => (b === 0 ? 100 : 100 - 100 / (1 + a / b));
  out[p] = rf(ag, al);
  for (let i = p + 1; i < v.length; i++) {
    const c = v[i] - v[i - 1];
    ag = (ag * (p - 1) + (c > 0 ? c : 0)) / p;
    al = (al * (p - 1) + (c < 0 ? -c : 0)) / p;
    out[i] = rf(ag, al);
  }
  return out;
}
function atr(h: number[], l: number[], c: number[], p = 14): number[] {
  const n = c.length, out = new Array(n).fill(NaN);
  if (n <= p) return out;
  const tr = new Array(n).fill(NaN); tr[0] = h[0] - l[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i];
  let prev = s / p; out[p] = prev;
  for (let i = p + 1; i < n; i++) { prev = (prev * (p - 1) + tr[i]) / p; out[i] = prev; }
  return out;
}
function adx(h: number[], l: number[], c: number[], p = 14): number[] {
  const n = c.length, out = new Array(n).fill(NaN);
  if (n <= p * 2 + 1) return out;
  const pDM = new Array(n).fill(0), mDM = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pDM[i] = up > dn && up > 0 ? up : 0;
    mDM[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  let aS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= p; i++) { aS += tr[i]; pS += pDM[i]; mS += mDM[i]; }
  const dx = new Array(n).fill(NaN);
  for (let i = p + 1; i < n; i++) {
    aS = aS - aS / p + tr[i]; pS = pS - pS / p + pDM[i]; mS = mS - mS / p + mDM[i];
    const pDI = aS === 0 ? 0 : 100 * pS / aS, mDI = aS === 0 ? 0 : 100 * mS / aS;
    const d = pDI + mDI; dx[i] = d === 0 ? 0 : 100 * Math.abs(pDI - mDI) / d;
  }
  const f = dx.findIndex((x) => !Number.isNaN(x));
  if (f === -1 || f + p >= n) return out;
  let s = 0; for (let i = f; i < f + p; i++) s += dx[i];
  let prev = s / p; out[f + p - 1] = prev;
  for (let i = f + p; i < n; i++) { prev = (prev * (p - 1) + dx[i]) / p; out[i] = prev; }
  return out;
}
function effRatio(c: number[], n = 10): number {
  const L = c.length - 1;
  if (L < n) return 0;
  const net = Math.abs(c[L] - c[L - n]);
  let vol = 0;
  for (let i = L - n + 1; i <= L; i++) vol += Math.abs(c[i] - c[i - 1]);
  return vol > 0 ? net / vol : 0;
}
const last = (a: number[]) => a[a.length - 1];

// ---------- Qirinjtë: Binance PAXG (ari 24/7) ----------
async function candles(interval: string, limit = 300): Promise<Candle[] | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${limit}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const raw = (await r.json()) as unknown[][];
    return raw.map((k) => ({ time: Number(k[0]), open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), volume: +(k[5] as string) }));
  } catch { return null; }
}

interface Cfg {
  active: boolean; paper_equity: number; risk_pct: number; rr: number;
  max_open: number; max_same_dir: number; daily_stop_pct: number; kill_after_sl: number;
  adx_trend_min: number; adx_range_max: number; er_trend_min: number;
  overext_atr: number; overext_days: number; sessions: [number, number][];
  blackout_until: string | null; be_at_r: number; trail_at_r: number; trail_lock_pct: number;
  live_enabled: boolean; live_lots: number; live_user_id: string | null;
  spike_mult: number; zone_atr: number; pressure_pct: number;
  momentum_on: boolean; momentum_er: number; momentum_atr: number;
  learn_enabled: boolean; learn_min_trades: number; last_learned_at: string | null;
}

// ---------- L5 — MËSIMI NGA VETVETJA (1×/24h) ----------
// Analizon trade-t e veta të mbyllura (14 ditët e fundit) dhe rregullon parametrat
// BRENDA kufijve të fortë: kur një strategji humb (expectancy < -0.2R me mostër të
// mjaftueshme) → ia NGRE shtangën e hyrjes (më selektiv); kur fiton qartë → ia lehtëson
// pak drejt default-it. KURRË s'e rrit rrezikun (risk_pct/live_lots/max_open s'preken).
// Çdo ndryshim shkruhet te mmt_learning — plotësisht i auditueshëm.
async function learnPass(db: ReturnType<typeof createClient>, cfg: Cfg): Promise<void> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data } = await db.from("mmt_trades").select("strategy, r_multiple, opened_at")
    .not("closed_at", "is", null).gte("opened_at", since);
  const rows = (data ?? []) as { strategy: string; r_multiple: number | null; opened_at: string }[];
  const minN = Math.max(10, cfg.learn_min_trades);
  const patch: Record<string, unknown> = { last_learned_at: new Date().toISOString() };
  const log = async (param: string, oldV: unknown, newV: unknown, reason: string, n: number, exp: number) => {
    await db.from("mmt_learning").insert({ param, old_value: String(oldV), new_value: String(newV), reason, sample_n: n, expectancy: Math.round(exp * 100) / 100 });
  };
  const expOf = (s: string) => {
    const xs = rows.filter((r) => r.strategy === s && r.r_multiple != null).map((r) => Number(r.r_multiple));
    return { n: xs.length, exp: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 };
  };
  // MOMENTUM: humb → ngre pastërtinë ER (më selektiv); humb rëndë → fike; fiton → lehtëso pak.
  const m = expOf("momentum");
  if (m.n >= minN) {
    if (m.exp < -0.5 && cfg.momentum_on) { patch.momentum_on = false; await log("momentum_on", true, false, "momentum humbës i qëndrueshëm — u fik vetë", m.n, m.exp); }
    else if (m.exp < -0.2) { const v = Math.min(0.85, cfg.momentum_er + 0.05); if (v !== cfg.momentum_er) { patch.momentum_er = v; await log("momentum_er", cfg.momentum_er, v, "momentum nën pritshmëri — kërkohet lëvizje më e pastër", m.n, m.exp); } }
    else if (m.exp > 0.5) { const v = Math.max(0.5, cfg.momentum_er - 0.02); if (v !== cfg.momentum_er) { patch.momentum_er = v; await log("momentum_er", cfg.momentum_er, v, "momentum fitues — lehtësim i lehtë", m.n, m.exp); } }
  }
  // TREND: humb → kërko trend më të fortë (ADX/ER më lart); fiton qartë → kthehu ngadalë drejt 25.
  const t = expOf("trend");
  if (t.n >= minN) {
    if (t.exp < -0.2) {
      const a = Math.min(30, cfg.adx_trend_min + 1), e = Math.min(0.4, Math.round((cfg.er_trend_min + 0.02) * 100) / 100);
      if (a !== cfg.adx_trend_min) { patch.adx_trend_min = a; await log("adx_trend_min", cfg.adx_trend_min, a, "trend humbës — kërkohet trend më i fortë", t.n, t.exp); }
      if (e !== cfg.er_trend_min) { patch.er_trend_min = e; await log("er_trend_min", cfg.er_trend_min, e, "trend humbës — kërkohet lëvizje më e pastër", t.n, t.exp); }
    } else if (t.exp > 0.5) {
      const a = Math.max(25, cfg.adx_trend_min - 1);
      if (a !== cfg.adx_trend_min) { patch.adx_trend_min = a; await log("adx_trend_min", cfg.adx_trend_min, a, "trend fitues — lehtësim drejt default-it", t.n, t.exp); }
    }
  }
  // RANGE: humb → kërko range më të qetë (ADX max më i ulët).
  const rg = expOf("range");
  if (rg.n >= minN && rg.exp < -0.2) {
    const v = Math.max(15, cfg.adx_range_max - 2);
    if (v !== cfg.adx_range_max) { patch.adx_range_max = v; await log("adx_range_max", cfg.adx_range_max, v, "range humbës — kërkohet range më i qetë", rg.n, rg.exp); }
  }
  // SESIONET: hiq dritaren e orëve që humb qartë (kurrë s'shton orë të reja vetë; min 1 dritare mbetet).
  if (Array.isArray(cfg.sessions) && cfg.sessions.length > 1) {
    const byWin = cfg.sessions.map(([a, b]) => {
      const xs = rows.filter((r) => { const h = new Date(r.opened_at).getUTCHours(); return h >= a && h < b && r.r_multiple != null; }).map((r) => Number(r.r_multiple));
      return { win: [a, b] as [number, number], n: xs.length, exp: xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0 };
    });
    const bad = byWin.find((w) => w.n >= minN && w.exp < -0.3);
    if (bad) {
      const kept = cfg.sessions.filter(([a, b]) => !(a === bad.win[0] && b === bad.win[1]));
      if (kept.length >= 1) { patch.sessions = kept; await log("sessions", JSON.stringify(cfg.sessions), JSON.stringify(kept), `dritarja ${bad.win[0]}-${bad.win[1]}h humbëse — u hoq`, bad.n, bad.exp); }
    }
  }
  await db.from("mmt_config").update(patch).eq("id", 1);
}
interface Trade {
  id: string; side: string; strategy: string; entry_price: number; sl: number; tp: number;
  lots: number; risk_usd: number; status: string; opened_at: string;
}
const VPP = 100;

// ---------- LIVE (MetaApi) — identike me robotin e provuar; përdoret VETËM kur live_enabled=true ----------
interface Broker { account_id: string; token: string; region: string; }
const maHost = (r: string) => `https://mt-client-api-v1.${(r || "new-york").trim()}.agiliumtrade.ai`;
async function maTrade(b: Broker, body: Record<string, unknown>) {
  const resp = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/trade`, {
    method: "POST", headers: { "auth-token": b.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  let j: unknown = txt; try { j = JSON.parse(txt); } catch { /* tekst i thjeshtë */ }
  return { ok: resp.ok, status: resp.status, body: j };
}
async function maPositions(b: Broker): Promise<Record<string, unknown>[] | null> {
  try {
    const r = await fetch(`${maHost(b.region)}/users/current/accounts/${b.account_id}/positions`, {
      headers: { "auth-token": b.token }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
} // ari: $1 lëvizje × 1 lot = $100

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Autorizim: cron (x-cron-secret) ose admin i kyçur.
  let authorized = false;
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    if ((cs as { value?: string } | null)?.value && req.headers.get("x-cron-secret") === (cs as { value: string }).value) authorized = true;
  } catch { /* vazhdo te kontrolli i user-it */ }
  if (!authorized) {
    const auth = req.headers.get("Authorization") || "";
    const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await uc.auth.getUser();
    if (u?.user) {
      const { data: p } = await db.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
      if ((p as { is_admin?: boolean } | null)?.is_admin) authorized = true;
    }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const logScan = async (row: Record<string, unknown>) => { try { await db.from("mmt_scan_log").insert(row); } catch { /* diagnostikë — mos ndal motorin */ } };

  try {
    const { data: cfgRow } = await db.from("mmt_config").select("*").eq("id", 1).maybeSingle();
    const cfg = cfgRow as unknown as Cfg | null;
    if (!cfg) return json({ error: "mmt_config mungon" }, 500);

    // L5 — MËSIMI NGA VETVETJA: 1× në 24h, analizon rezultatet e veta dhe përshtat parametrat
    // (brenda kufijve; rreziku KURRË s'rritet vetë). Dështimi i mësimit s'e ndal skanimin.
    if (cfg.learn_enabled !== false) {
      const lastL = cfg.last_learned_at ? new Date(cfg.last_learned_at).getTime() : 0;
      if (Date.now() - lastL > 24 * 3600 * 1000) {
        try { await learnPass(db, cfg); } catch { /* mësimi provohet sërish nesër */ }
      }
    }

    // Qirinjtë: 1m (vlerësim i trade-ve të hapura), 15m (hyrje), 1h (regjim), 4h (konfirmim).
    const [c1, c15, c1h, c4h] = await Promise.all([candles("1m"), candles("15m"), candles("1h"), candles("4h")]);
    if (!c1 || !c15 || !c1h || !c4h || c1h.length < 210) { await logScan({ decision: "blocked", reject_reason: "no_data" }); return json({ ok: false, reason: "no_data" }); }
    const px = last(c1.map((c) => c.close));

    // ======= L4 — VLERËSIMI I TRADE-VE TË HAPURA (mbrojtja e fitimit GJITHMONË) =======
    // Break-even në +be_at_r; trailing (trail_lock_pct% e fitimit) pas +trail_at_r; TP/SL nga 1m high/low.
    const { data: openRows } = await db.from("mmt_trades").select("*").eq("status", "open");
    const open = (openRows ?? []) as unknown as Trade[];
    let closedNow = 0;
    for (const t of open) {
      const isBuy = t.side === "BUY";
      const since = new Date(t.opened_at).getTime();
      const bars = c1.filter((c) => c.time >= since);
      if (bars.length === 0) continue;
      const riskDist = Math.abs(t.entry_price - t.sl);
      let sl = t.sl, closed: { status: string; exit: number } | null = null;
      // Rindërto SL-në efektive bar-pas-bari (BE + trailing), pastaj kontrollo prekjet.
      let bestMove = 0;
      for (const b of bars) {
        const fav = isBuy ? b.high - t.entry_price : t.entry_price - b.low;
        if (fav > bestMove) bestMove = fav;
        const rNow = riskDist > 0 ? bestMove / riskDist : 0;
        if (rNow >= cfg.trail_at_r) {
          const lock = t.entry_price + (isBuy ? 1 : -1) * bestMove * (cfg.trail_lock_pct / 100);
          if (isBuy ? lock > sl : lock < sl) sl = lock;
        } else if (rNow >= cfg.be_at_r) {
          const be = t.entry_price + (isBuy ? 1 : -1) * riskDist * 0.05; // BE + ofset i vogël (mbulon spread-in)
          if (isBuy ? be > sl : be < sl) sl = be;
        }
        const hitSL = isBuy ? b.low <= sl : b.high >= sl;
        const hitTP = isBuy ? b.high >= t.tp : b.low <= t.tp;
        // Nëse preken të dyja në të njëjtin bar → konservativ: numëro SL (defense first).
        if (hitSL) { const moved = sl !== t.sl; closed = { status: moved ? (bestMove / (riskDist || 1) >= cfg.trail_at_r ? "trail" : "be") : "sl", exit: sl }; break; }
        if (hitTP) { closed = { status: "tp", exit: t.tp }; break; }
      }
      // Skadim: pas 48h mbyll me çmimin aktual (mos mbaj pozicione pafund).
      if (!closed && Date.now() - since > 48 * 3600 * 1000) closed = { status: "expired", exit: px };
      if (closed) {
        const pnl = (isBuy ? closed.exit - t.entry_price : t.entry_price - closed.exit) * VPP * t.lots;
        const rMult = t.risk_usd > 0 ? pnl / t.risk_usd : 0;
        await db.from("mmt_trades").update({
          status: closed.status, exit_price: Math.round(closed.exit * 100) / 100,
          pnl_usd: Math.round(pnl * 100) / 100, r_multiple: Math.round(rMult * 100) / 100,
          closed_at: new Date().toISOString(),
        }).eq("id", t.id);
        closedNow++;
      }
    }

    // ---- KREDENCIALET LIVE (vetëm nëse pronari e ka ndezur çelësin te faqja MMT) ----
    let broker: Broker | null = null;
    if (cfg.live_enabled && cfg.live_user_id) {
      const { data: mc } = await db.from("metaapi_config").select("account_id, token, region, kill_switch")
        .eq("user_id", cfg.live_user_id).maybeSingle();
      const m = mc as { account_id?: string; token?: string; region?: string; kill_switch?: boolean } | null;
      if (m?.account_id && m?.token && m.kill_switch !== true) broker = { account_id: m.account_id, token: m.token, region: m.region || "london" };
    }

    // ---- MENAXHIMI LIVE (BE + trailing për pozicionet reale "MMT") — çdo skanim ----
    if (broker) {
      try {
        const pos = await maPositions(broker);
        for (const p of pos ?? []) {
          if (!String(p.comment || "").includes("MMT")) continue; // vetëm pozicionet e MMT — të tjerët s'i prek
          const isBuy = String(p.type || "").includes("BUY");
          const entry = Number(p.openPrice), cur = Number(p.currentPrice);
          const slNow = p.stopLoss != null ? Number(p.stopLoss) : null;
          if (!Number.isFinite(entry) || !Number.isFinite(cur) || slNow == null) continue;
          const riskDist = Math.abs(entry - slNow) || 1;
          const fav = isBuy ? cur - entry : entry - cur;
          const rNow = fav / riskDist;
          let target = slNow;
          if (rNow >= cfg.trail_at_r) {
            const lock = entry + (isBuy ? 1 : -1) * fav * (cfg.trail_lock_pct / 100);
            if (isBuy ? lock > target : lock < target) target = lock;
          } else if (rNow >= cfg.be_at_r) {
            const be = entry + (isBuy ? 1 : -1) * riskDist * 0.05;
            if (isBuy ? be > target : be < target) target = be;
          }
          if (target !== slNow && (isBuy ? target > slNow : target < slNow)) {
            await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: Math.round(target * 100) / 100, takeProfit: p.takeProfit ?? undefined });
          }
        }
      } catch { /* menaxhimi live s'duhet të ndalë skanimin */ }
    }

    // ======= L0 — KLASIFIKUESI I REGJIMIT (1h + konfirmim 4h) =======
    const cl1h = c1h.map((c) => c.close), hi1h = c1h.map((c) => c.high), lo1h = c1h.map((c) => c.low);
    const cl4h = c4h.map((c) => c.close), cl15 = c15.map((c) => c.close);
    const ema200_1h = last(ema(cl1h, 200));
    const adx1h = last(adx(hi1h, lo1h, cl1h, 14));
    const er1h = effRatio(cl1h, 10);
    const atr1h = last(atr(hi1h, lo1h, cl1h, 14));
    const rsi15 = last(rsi(cl15, 14));

    // Konfirmimi 4h me EMA50 (jo EMA200 — shumë e ngadaltë, humbte kthesat shumëditore
    // si rally i 2 korrikut). EMA200(4h) mbahet vetëm si kontekst në log.
    const ema50_4h = last(ema(cl4h, 50));
    let regime = "TRANSITION";
    if (cfg.blackout_until && new Date(cfg.blackout_until).getTime() > Date.now()) regime = "EVENT";
    else if (adx1h >= cfg.adx_trend_min && er1h >= cfg.er_trend_min) {
      if (px > ema200_1h && px > ema50_4h) regime = "TREND_UP";
      else if (px < ema200_1h && px < ema50_4h) regime = "TREND_DOWN";
    } else if (adx1h < cfg.adx_range_max) regime = "RANGE";

    const base = { price: px, regime, adx: Math.round(adx1h * 10) / 10, er: Math.round(er1h * 100) / 100, rsi15: Math.round(rsi15), atr1h: Math.round(atr1h * 100) / 100 };
    const rej = async (r: string) => { await logScan({ ...base, decision: "hold", reject_reason: r }); return json({ ok: true, regime, decision: "hold", reason: r, closed: closedNow }); };

    if (!cfg.active) return rej("mmt_off");
    if (regime === "EVENT") return rej("event_blackout");
    // TRANZICION: strategjitë klasike s'punojnë, por MOMENTUM-i (shpërthimet e forta,
    // BUY dhe SELL njësoj) lejohet — vetëm ai, me të gjitha mbrojtjet e çastit.
    if (regime === "TRANSITION" && !cfg.momentum_on) return rej("transition_no_trade");

    // ======= L3 — SESIONET (kill-zones UTC; jashtë tyre → pa hyrje të reja) =======
    const hUTC = new Date().getUTCHours();
    const inSession = (cfg.sessions || []).some(([a, b]) => hUTC >= a && hUTC < b);
    if (!inSession) return rej(`jashte_sesionit(${hUTC}h)`);

    // ======= L2 — MENAXHERI I RREZIKUT (prop-style, PARA se të mendojmë hyrjen) =======
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const { data: dayRows } = await db.from("mmt_trades").select("status, pnl_usd").gte("closed_at", today.toISOString());
    const closedToday = (dayRows ?? []) as { status: string; pnl_usd: number | null }[];
    const dayPnl = closedToday.reduce((a, r) => a + Number(r.pnl_usd ?? 0), 0);
    const slToday = closedToday.filter((r) => r.status === "sl").length;
    if (slToday >= cfg.kill_after_sl) return rej(`kill_switch(${slToday}SL)`);              // Dhoma e Ekspertëve
    if (dayPnl <= -cfg.paper_equity * (cfg.daily_stop_pct / 100)) return rej(`stop_ditor(${dayPnl.toFixed(0)}$)`); // prop-firm
    const stillOpen = open.length - closedNow;
    if (stillOpen >= cfg.max_open) return rej(`max_open(${stillOpen})`);

    // ======= L1 — ANSAMBLI I STRATEGJIVE (secila vetëm në regjimin e vet) =======
    let side: "BUY" | "SELL" | null = null;
    let strategy = "", why = "";
    const e20_15 = last(ema(cl15, 20));
    const prevRsi15 = rsi(cl15, 14)[cl15.length - 2];

    // MOMENTUM (BUY dhe SELL njësoj) — kap shpërthimet e forta që strategjitë e ngadalta i humbin:
    // 12 min të fundit lëvizje ≥ momentum_atr×ATR(1h), e PASTËR (ER 1m ≥ momentum_er), në anën e
    // duhur të EMA200(1h); qiriu i fundit i qetësuar (hyn në mikro-pauzë, jo në majë të flakës).
    const tryMomentum = (): boolean => {
      if (!cfg.momentum_on) return false;
      const m12 = c1.slice(-12).map((c) => c.close);
      const move = m12[m12.length - 1] - m12[0];
      const erM = effRatio(m12, m12.length - 1);
      if (Math.abs(move) < cfg.momentum_atr * atr1h || erM < cfg.momentum_er) return false;
      const dir: "BUY" | "SELL" = move > 0 ? "BUY" : "SELL";
      if (dir === "BUY" && px <= ema200_1h) return false;   // blej vetëm mbi strukturën 1h
      if (dir === "SELL" && px >= ema200_1h) return false;  // shit vetëm nën të
      const lb = c1[c1.length - 1];
      const avg12 = c1.slice(-30).map((c) => c.high - c.low).reduce((a, b) => a + b, 0) / 30;
      if (lb.high - lb.low > 2 * avg12) return false;        // qiriu i fundit ende flakë → prit pauzën
      side = dir; strategy = "momentum";
      why = `momentum: ${move > 0 ? "+" : ""}${move.toFixed(1)}$ në 12min, ER ${erM.toFixed(2)}`;
      return true;
    };

    if (regime === "TREND_DOWN" || regime === "TREND_UP") {
      strategy = "trend";
      const isDown = regime === "TREND_DOWN";
      // Hyrje në PULLBACK me konfirmim mbylljeje (jo ndjekje e spike-ut — mësimi kundër kthesave të rreme):
      // çmimi u tërhoq te EMA20(15m) dhe qiriu i fundit u MBYLL sërish në drejtim të trendit.
      const lastBar = c15[c15.length - 1];
      const pulled = isDown ? lastBar.high >= e20_15 * 0.999 : lastBar.low <= e20_15 * 1.001;
      const confirmed = isDown ? lastBar.close < lastBar.open : lastBar.close > lastBar.open;
      const rsiOk = isDown ? (rsi15 < 60 && rsi15 > 25) : (rsi15 > 40 && rsi15 < 75); // jo në ekstrem
      if (pulled && confirmed && rsiOk) { side = isDown ? "SELL" : "BUY"; why = `pullback EMA20(15m) + mbyllje konfirmuese, RSI ${Math.round(rsi15)}`; }
      else if (!tryMomentum()) return rej(isDown ? "pa_pullback_sell" : "pa_pullback_buy");
    } else if (regime === "RANGE") {
      strategy = "range";
      // Mean-reversion: fade ekstremet me RSI 15m + kthim konfirmues.
      if (rsi15 <= 27 && prevRsi15 < rsi15) { side = "BUY"; why = `range: RSI ${Math.round(rsi15)} kthehet nga poshtë`; }
      else if (rsi15 >= 73 && prevRsi15 > rsi15) { side = "SELL"; why = `range: RSI ${Math.round(rsi15)} kthehet nga lart`; }
      else if (!tryMomentum()) return rej("range_pa_ekstrem");
    } else if (regime === "TRANSITION") {
      // Në tranzicion punon VETËM momentum-i (shpërthimet e qarta); përndryshe prit.
      if (!tryMomentum()) return rej("transition_pa_momentum");
    }
    if (!side) return rej("pa_sinjal");

    // ======= MBROJTJA E MBI-EKSTENSIONIT (mësimi i 1 korrikut: mos shit te fundi) =======
    // MOMENTUM përjashtohet: shpërthimi te ekstremi ËSHTË vetë hyrja e tij (e mbrojnë ER-ja e pastër,
    // mikro-pauza, skanimi 1s, SL-ja e ngushtë dhe break-even +1R).
    if (strategy !== "momentum") {
      const days = Math.max(2, cfg.overext_days);
      const dayBars = c1h.slice(-24 * days);
      const nLow = Math.min(...dayBars.map((c) => c.low)), nHigh = Math.max(...dayBars.map((c) => c.high));
      if (side === "SELL" && px - nLow < cfg.overext_atr * atr1h) return rej(`mbi_ekstension_sell(${(px - nLow).toFixed(1)}$ nga minimumi)`);
      if (side === "BUY" && nHigh - px < cfg.overext_atr * atr1h) return rej(`mbi_ekstension_buy(${(nHigh - px).toFixed(1)}$ nga maksimumi)`);
    }

    // Anti-stacking: max N në të njëjtin drejtim (Dhoma: 1 sinjal = 1 pozicion).
    const sameDir = open.filter((t) => t.status === "open" && t.side === side).length;
    if (sameDir >= cfg.max_same_dir) return rej(`max_same_dir(${sameDir} ${side})`);

    // ======= MBROJTJET E ÇASTIT PARA HYRJES (analiza e thellë e mikro-strukturës) =======
    const isBuySide = side === "BUY";
    // 1) ROJA E SPIKE-VE: qiriu i fundit 1m shumë më i madh se mesatarja → lëvizje lajmesh/paniku, prit të ulet pluhuri.
    const r1m = c1.slice(-30).map((c) => c.high - c.low);
    const avg1m = r1m.reduce((a, b) => a + b, 0) / r1m.length;
    const last1m = c1[c1.length - 1];
    if ((last1m.high - last1m.low) > cfg.spike_mult * avg1m) return rej(`spike_i_madh(${(last1m.high - last1m.low).toFixed(1)}$ vs mes ${avg1m.toFixed(1)}$)`);
    // 2) PRESIONI BLERËS/SHITËS (10 qirinjtë e fundit 1m, peshuar me volum): mos hyr kundër rrjedhës së parasë.
    const p10 = c1.slice(-10);
    let bullVol = 0, bearVol = 0;
    for (const b of p10) { const body = Math.abs(b.close - b.open) * (b.volume || 1); if (b.close >= b.open) bullVol += body; else bearVol += body; }
    const tot = bullVol + bearVol;
    if (tot > 0) {
      const against = isBuySide ? bearVol / tot : bullVol / tot;
      if (against * 100 >= cfg.pressure_pct) return rej(`presion_kunder(${Math.round(against * 100)}% ${isBuySide ? "shites" : "blerës"})`);
    }
    // 3) ZONAT E RREZIKUT: nivele të rrumbullakëta ($50) + pivotet e fundit 1h — mos SHIT ngjitur me mbështetjen,
    //    mos BLI ngjitur me rezistencën (aty tregu shpesh kthehet).
    const zone = cfg.zone_atr * atr1h;
    const roundBelow = Math.floor(px / 50) * 50, roundAbove = roundBelow + 50;
    const sw = c1h.slice(-48); // pivotet e 2 ditëve të fundit
    const swingLow = Math.min(...sw.map((c) => c.low)), swingHigh = Math.max(...sw.map((c) => c.high));
    if (!isBuySide && (px - roundBelow < zone || px - swingLow < zone)) return rej(`zone_mbeshtetje(${Math.min(px - roundBelow, px - swingLow).toFixed(1)}$)`);
    if (isBuySide && (roundAbove - px < zone || swingHigh - px < zone)) return rej(`zone_rezistence(${Math.min(roundAbove - px, swingHigh - px).toFixed(1)}$)`);
    // 4) RI-SKANIMI I ÇASTIT (kërkesa jote): SEKONDAT E FUNDIT para ekzekutimit — qirinj 1-SEKONDËSH.
    //    Krahasohet lëvizja e 10 sekondave të fundit: nëse po ecën fort KUNDËR drejtimit → anulo.
    //    Rezervë: nëse 1s s'ka të dhëna, përdoret qiriu i freskët 1m (i njëjti parim).
    let pxNow = px;
    const s1 = await candles("1s", 30);
    if (s1 && s1.length >= 10) {
      const last10s = s1.slice(-10);
      const move10s = last10s[last10s.length - 1].close - last10s[0].close;
      const against10s = isBuySide ? -move10s : move10s; // + = po ecën kundër nesh
      if (against10s > 0.3 * avg1m) return rej(`sekondat_kunder(${against10s.toFixed(2)}$ në 10s)`);
      pxNow = last10s[last10s.length - 1].close; // çmimi i sekondës së fundit — hyrja ankorohet këtu
    } else {
      const fresh = await candles("1m", 5);
      if (!fresh || fresh.length < 2) return rej("recheck_pa_te_dhena");
      const now1m = fresh[fresh.length - 1];
      const againstMove = isBuySide ? now1m.open - now1m.close : now1m.close - now1m.open;
      if (againstMove > 0.5 * avg1m) return rej(`qiri_kunder_hyrjes(${againstMove.toFixed(2)}$ kundër)`);
      pxNow = now1m.close;
    }

    // ======= HAPJA: SL nga ATR, TP nga R:R, lot nga rreziku fiks =======
    const slDist = Math.max(atr1h * 1.5, 2);
    const rrUsed = strategy === "range" ? Math.min(cfg.rr, 1.5) : cfg.rr; // range: objektiv modest (mesi), trend: R:R i plotë
    const sl = isBuySide ? pxNow - slDist : pxNow + slDist;
    const tp = isBuySide ? pxNow + slDist * rrUsed : pxNow - slDist * rrUsed;
    const riskUsd = cfg.paper_equity * (cfg.risk_pct / 100);
    const lots = Math.max(0.01, Math.floor((riskUsd / (slDist * VPP)) * 100) / 100);

    // EKZEKUTIMI LIVE (vetëm kur pronari e ka ndezur çelësin LIVE te faqja MMT; lot fiks live_lots).
    let liveOrderId: string | null = null;
    let liveOk = false;
    if (broker) {
      try {
        const r = await maTrade(broker, {
          actionType: isBuySide ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: "XAUUSD",
          volume: Math.max(0.01, Number(cfg.live_lots) || 0.01),
          stopLoss: Math.round(sl * 100) / 100, takeProfit: Math.round(tp * 100) / 100, comment: "MMT",
        });
        const rb = r.body as { orderId?: string; numericCode?: number } | null;
        liveOk = r.ok && !!rb?.orderId;
        liveOrderId = rb?.orderId ?? null;
        // LIDHJA me tabelën e tregtimeve live: regjistro te trade_executions (shfaqet te
        // "Ekzekutimet e fundit" / Tregto Live, si robotët e tjerë) — sukses OSE gabim.
        try {
          await db.from("trade_executions").insert({
            user_id: cfg.live_user_id, symbol: "XAUUSD", action: side,
            volume: Math.max(0.01, Number(cfg.live_lots) || 0.01),
            entry_price: Math.round(pxNow * 100) / 100,
            stop_loss: Math.round(sl * 100) / 100, take_profit: Math.round(tp * 100) / 100,
            mode: "live", status: liveOk ? "executed" : "error",
            reason: (liveOk ? `MMT auto (${strategy}/${regime}): ${why}` : `MMT live dështoi (${r.status})`).slice(0, 200),
            metaapi_order_id: liveOrderId, raw_response: r.body ?? null,
          });
        } catch { /* logu s'duhet të ndalë motorin */ }
      } catch { /* dështimi live s'e ndal regjistrimin në letër */ }
    }

    await db.from("mmt_trades").insert({
      symbol: "XAUUSD", side, strategy, regime,
      entry_price: Math.round(pxNow * 100) / 100, sl: Math.round(sl * 100) / 100, tp: Math.round(tp * 100) / 100,
      lots, risk_usd: Math.round(slDist * VPP * lots * 100) / 100, reason: why,
      live: liveOk, live_order_id: liveOrderId,
    });
    await logScan({ ...base, decision: side === "BUY" ? "open_buy" : "open_sell", details: { strategy, why, sl, tp, lots, rr: rrUsed, live: liveOk, live_order_id: liveOrderId } });
    return json({ ok: true, regime, decision: side, strategy, why, live: liveOk, closed: closedNow });
  } catch (err) {
    await logScan({ decision: "blocked", reject_reason: `error: ${(err as Error).message}`.slice(0, 180) });
    return json({ error: (err as Error).message }, 500);
  }
});
