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
  scalp_on: boolean; scalp_tp_rr: number; scalp_max_day: number; scalp_cooldown_min: number; scalp_time_stop_min: number;
  scalp_candle_confirm: boolean;
  smart_exit: boolean; tp_time_h: number; tp_time_usd: number;
  // Fusha të Fast-it (menaxhohen nga mmt-fast-loop, por mësimi këtu i rregullon).
  fast_move_usd: number; fast_cooldown_s: number; fast_max_day: number; fast_pullback_usd: number;
}

// ---------- FIGURAT E QIRINJVE (konfirmim opsional — konfluencë) ----------
// Vetëm figurat me bazë të mirë në backtest: Engulfing, Morning/Evening Star,
// Hammer/Shooting Star (pin bar). NUK përdoren si sinjal i vetëm (studimet e provuan
// të dobëta të vetme) — vetëm si FILTËR konfirmimi mbi hyrjen ekzistuese EMA/RSI.
// Kthen emrin e figurës nëse përputhet me anën, ose null. z = qiriri i fundit.
function candlePattern(c: Candle[], side: "BUY" | "SELL"): string | null {
  const n = c.length;
  if (n < 3) return null;
  const a = c[n - 3], b = c[n - 2], z = c[n - 1];
  const body = (x: Candle) => Math.abs(x.close - x.open);
  const rng = (x: Candle) => (x.high - x.low) || 1e-9;
  const bull = (x: Candle) => x.close > x.open;
  const bear = (x: Candle) => x.close < x.open;
  const upW = (x: Candle) => x.high - Math.max(x.open, x.close);
  const dnW = (x: Candle) => Math.min(x.open, x.close) - x.low;
  if (side === "BUY") {
    if (bear(b) && bull(z) && z.open <= b.close && z.close >= b.open && body(z) > body(b)) return "Engulfing";
    if (bear(a) && body(a) > rng(a) * 0.5 && body(b) < rng(b) * 0.4 && bull(z) && z.close > (a.open + a.close) / 2) return "Morning Star";
    if (body(z) > 0 && dnW(z) >= body(z) * 2 && upW(z) <= body(z) * 0.6) return "Hammer";
    return null;
  }
  if (bull(b) && bear(z) && z.open >= b.close && z.close <= b.open && body(z) > body(b)) return "Engulfing";
  if (bull(a) && body(a) > rng(a) * 0.5 && body(b) < rng(b) * 0.4 && bear(z) && z.close < (a.open + a.close) / 2) return "Evening Star";
  if (body(z) > 0 && upW(z) >= body(z) * 2 && dnW(z) <= body(z) * 0.6) return "Shooting Star";
  return null;
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
  // Strategjitë e NGADALTA (trend/range/momentum) bëjnë ~5-10 tregti në 14 ditë — pragu i plotë
  // minN i linte PA mësim përgjithmonë (trend −0.52R me 10 tregti s'aktivizonte asgjë).
  // Për to mjafton gjysma e mostrës: sinjali −0.3R..−0.5R mbi 8+ tregti është i fortë.
  const minSlow = Math.max(6, Math.floor(minN / 2));
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
  if (m.n >= minSlow) {
    if (m.exp < -0.5 && cfg.momentum_on) { patch.momentum_on = false; await log("momentum_on", true, false, "momentum humbës i qëndrueshëm — u fik vetë", m.n, m.exp); }
    else if (m.exp < -0.2) { const v = Math.min(0.85, cfg.momentum_er + 0.05); if (v !== cfg.momentum_er) { patch.momentum_er = v; await log("momentum_er", cfg.momentum_er, v, "momentum nën pritshmëri — kërkohet lëvizje më e pastër", m.n, m.exp); } }
    else if (m.exp > 0.5) { const v = Math.max(0.5, cfg.momentum_er - 0.02); if (v !== cfg.momentum_er) { patch.momentum_er = v; await log("momentum_er", cfg.momentum_er, v, "momentum fitues — lehtësim i lehtë", m.n, m.exp); } }
  }
  // TREND: humb → kërko trend më të fortë (ADX/ER më lart); fiton qartë → kthehu ngadalë drejt 25.
  const t = expOf("trend");
  if (t.n >= minSlow) {
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
  if (rg.n >= minSlow && rg.exp < -0.2) {
    const v = Math.max(15, cfg.adx_range_max - 2);
    if (v !== cfg.adx_range_max) { patch.adx_range_max = v; await log("adx_range_max", cfg.adx_range_max, v, "range humbës — kërkohet range më i qetë", rg.n, rg.exp); }
  }
  // FAST: analizon tregtitë e VETA. Humb → më selektiv (prag shpërthimi më i lartë + pushim
  // më i gjatë + më pak/ditë = kundër bluarjes); fiton → lehtëson pak. Rreziku s'rritet kurrë.
  // FAST ka frekuencë shumë të lartë (qindra tregtime): edhe pritshmëri pak nën zero =
  // humbje e madhe totale nga kostot. Prandaj pragu është i ngushtë (−0.02R).
  const f = expOf("fast");
  if (f.n >= minN) {
    if (f.exp < -0.02) {
      const mv = Math.min(2.0, Math.round(((Number(cfg.fast_move_usd) || 0.6) + 0.2) * 100) / 100);
      const cd = Math.min(120, (Number(cfg.fast_cooldown_s) || 15) + 15);
      const md = Math.max(10, (Number(cfg.fast_max_day) || 40) - 20);
      if (mv !== cfg.fast_move_usd) { patch.fast_move_usd = mv; await log("fast_move_usd", cfg.fast_move_usd, mv, `Fast humbës (${f.n} trade, ${f.exp.toFixed(2)}R) — kërkon shpërthim më të fortë, më pak hyrje false`, f.n, f.exp); }
      if (cd !== cfg.fast_cooldown_s) { patch.fast_cooldown_s = cd; await log("fast_cooldown_s", cfg.fast_cooldown_s, cd, "Fast humbës — pushim më i gjatë mes hyrjeve (kundër mbi-tregtimit)", f.n, f.exp); }
      if (md !== cfg.fast_max_day) { patch.fast_max_day = md; await log("fast_max_day", cfg.fast_max_day, md, "Fast humbës — më pak tregtime/ditë (cilësi mbi sasi)", f.n, f.exp); }
    } else if (f.exp > 0.02) {
      // FITUES (kërkesa e pronarit): Fast duhet të tregtojë PANDËRPRERË kur po fiton — mësimi
      // liron gradualisht PO ATO çelësa që shtrëngon kur humb (simetrik), kurrë nën dyshemetë
      // e sigurisë: prag ≥0.8$ (kundër zhurmës), pushim ≥30s (kundër bluarjes). Rreziku për
      // tregti (SL/lot) NUK preket kurrë — lirohet vetëm frekuenca.
      const mv = Math.max(0.8, Math.round(((Number(cfg.fast_move_usd) || 1.0) - 0.1) * 100) / 100);
      const cd = Math.max(30, (Number(cfg.fast_cooldown_s) || 90) - 15);
      if (mv !== cfg.fast_move_usd) { patch.fast_move_usd = mv; await log("fast_move_usd", cfg.fast_move_usd, mv, `Fast fitues (${f.n} trade, ${f.exp.toFixed(2)}R) — prag më i ulët shpërthimi, më shumë hyrje`, f.n, f.exp); }
      if (cd !== cfg.fast_cooldown_s) { patch.fast_cooldown_s = cd; await log("fast_cooldown_s", cfg.fast_cooldown_s, cd, "Fast fitues — pushim më i shkurtër mes hyrjeve (tregtim më i vazhdueshëm)", f.n, f.exp); }
    }
  }
  // SCALP: analizon tregtitë e VETA. Humb → ndez konfirmimin me figurë qiriu (më selektiv) +
  // zgjat pushimin; fiton qartë → lehtëson pak pushimin. Rreziku s'rritet kurrë.
  const sc = expOf("scalp");
  if (sc.n >= minN) {
    if (sc.exp < -0.05) {
      if (!cfg.scalp_candle_confirm) { patch.scalp_candle_confirm = true; await log("scalp_candle_confirm", false, true, `Scalp humbës (${sc.n} trade, ${sc.exp.toFixed(2)}R) — u ndez konfirmimi me figurë qiriu (kërkon Engulfing/Star para hyrjes)`, sc.n, sc.exp); }
      else { const v = Math.min(10, (Number(cfg.scalp_cooldown_min) || 1) + 1); if (v !== cfg.scalp_cooldown_min) { patch.scalp_cooldown_min = v; await log("scalp_cooldown_min", cfg.scalp_cooldown_min, v, "Scalp ende humbës me konfirmim — pushim më i gjatë mes tyre", sc.n, sc.exp); } }
    } else if (sc.exp > 0.25 && cfg.scalp_candle_confirm) {
      // fiton fort me konfirmim → provo pa të (më shumë hyrje) vetëm nëse fitimi është i qëndrueshëm.
      patch.scalp_candle_confirm = false; await log("scalp_candle_confirm", true, false, `Scalp fitues i qëndrueshëm (${sc.exp.toFixed(2)}R) — hiqet kufizimi i figurës për më shumë mundësi`, sc.n, sc.exp);
    }
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
  // C) REKOMANDIMI i shkallëzimit të lotit (KURRË automatik — kufi i fortë sigurie):
  // pas ≥20 tradesh me pritshmëri pozitive dhe ≥50% fitore, shkruhet REKOMANDIM te mmt_learning —
  // pronari e sheh te faqja MMT dhe e ndryshon vetë live_lots nëse pajtohet.
  const allR = rows.filter((r) => r.r_multiple != null).map((r) => Number(r.r_multiple));
  if (allR.length >= 20) {
    const expAll = allR.reduce((a, b) => a + b, 0) / allR.length;
    const wr = allR.filter((x) => x > 0).length / allR.length;
    if (expAll > 0.3 && wr >= 0.5) {
      const cur = Number(cfg.live_lots) || 0.01;
      const next = Math.min(0.05, Math.round((cur + 0.01) * 100) / 100);
      if (next > cur) await log("rekomandim_lot", cur, next, `${allR.length} trade me mesatare +${expAll.toFixed(2)}R dhe ${Math.round(wr * 100)}% fitore — mund ta rrisësh lotin live te seksioni LIVE (vendimi YTI, s'ndryshohet vetë)`, allR.length, expAll);
    }
  }
  // SINJALET (roboti i sinjaleve): mësim automatik i besueshmërisë minimale, për ÇDO përdorues
  // me auto-trade mbi sinjalet e VETA 14-ditore. Saktësia e të vendosurve (TP/SL) <35% → ngre
  // min_confidence +5 (max 85, vetëm sinjalet më të sigurta); ≥50% → ule −5 (min 70). Kërkon ≥10
  // sinjale të vendosura — mostra të vogla s'lëvizin asgjë. Çdo ndryshim auditohet te mmt_learning.
  try {
    const { data: users } = await db.from("metaapi_config").select("user_id, min_confidence").eq("auto_trade", true);
    for (const u of (users ?? []) as { user_id: string; min_confidence: number | null }[]) {
      const { data: sigs } = await db.from("signals").select("status")
        .eq("user_id", u.user_id).in("status", ["hit_tp", "hit_sl"]).gte("created_at", since);
      const dec = (sigs ?? []).length;
      if (dec < 10) continue;
      const wins = ((sigs ?? []) as { status: string }[]).filter((s) => s.status === "hit_tp").length;
      const wr = wins / dec;
      const cur = Number(u.min_confidence) || 70;
      let next = cur;
      if (wr < 0.35) next = Math.min(85, cur + 5);
      else if (wr >= 0.5) next = Math.max(70, cur - 5);
      if (next !== cur) {
        await db.from("metaapi_config").update({ min_confidence: next }).eq("user_id", u.user_id);
        await log(`signals_min_confidence(${String(u.user_id).slice(0, 8)})`, cur, next,
          wr < 0.35
            ? `Sinjalet ${Math.round(wr * 100)}% saktësi (${wins}/${dec} TP) — roboti pranon vetëm sinjalet më të sigurta`
            : `Sinjalet ${Math.round(wr * 100)}% saktësi — pragu lehtësohet drejt default-it`,
          dec, Math.round(wr * 100) / 100);
      }
    }
  } catch { /* mësimi i sinjaleve s'duhet të ndalë atë të MMT-së */ }
  await db.from("mmt_config").update(patch).eq("id", 1);
}
interface Trade {
  id: string; side: string; strategy: string; entry_price: number; sl: number; tp: number;
  lots: number; risk_usd: number; status: string; opened_at: string;
  live?: boolean; live_order_id?: string | null;
}
const VPP = 100;

// ---------- LIVE (MetaApi) — identike me robotin e provuar; përdoret VETËM kur live_enabled=true ----------
interface Broker { account_id: string; token: string; region: string; symbol: string; }
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
// Çmimi REAL i brokerit — SL/TP live DUHEN në kornizën e tij: XAUUSD+ ndryshon
// disa $ nga burimi i kandelave, ndryshe stops të ngushta refuzohen (INVALID_STOPS).
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

    // ---- KREDENCIALET LIVE (para vlerësimit — daljet scalp live kanë nevojë për to) ----
    let broker: Broker | null = null;
    if (cfg.live_enabled && cfg.live_user_id) {
      const { data: mc } = await db.from("metaapi_config").select("account_id, token, region, kill_switch, symbol_map")
        .eq("user_id", cfg.live_user_id).maybeSingle();
      const m = mc as { account_id?: string; token?: string; region?: string; kill_switch?: boolean; symbol_map?: Record<string, string> | null } | null;
      if (m?.account_id && m?.token && m.kill_switch !== true) {
        // Emri REAL i arit te brokeri (p.sh. Vantage: "XAUUSD+") nga harta e mësuar e simboleve —
        // rregullon "Unknown symbol 4301" që bllokoi urdhrat e parë live.
        const sym = (m.symbol_map && (m.symbol_map["XAUUSD"] || m.symbol_map["xauusd"])) || "XAUUSD";
        broker = { account_id: m.account_id, token: m.token, region: m.region || "london", symbol: sym };
      }
    }

    // ======= L4 — VLERËSIMI I TRADE-VE TË HAPURA (mbrojtja e fitimit GJITHMONË) =======
    // Break-even në +be_at_r; trailing (trail_lock_pct% e fitimit) pas +trail_at_r; TP/SL nga 1m high/low.
    const { data: openRows } = await db.from("mmt_trades").select("*").eq("status", "open");
    const open = (openRows ?? []) as unknown as Trade[];
    let closedNow = 0;
    // Momentum-i 15m (për Daljen e Mençur): a po kthehet tregu fort kundër pozicionit?
    const cl15sm = c15.map((c) => c.close);
    const e9_15v = last(ema(cl15sm, 9)), e21_15v = last(ema(cl15sm, 21)), rsi15sm = last(rsi(cl15sm, 14));
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
        } else if (rNow >= (t.strategy === "scalp" ? Math.min(cfg.be_at_r, 0.5) : cfg.be_at_r)) {
          // SCALP: mbrojtje e HERSHME (+0.5R) — "sapo del në profit, mbroje te hyrja" (kërkesa e pronarit).
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
      // DALJET SCALP (Blic): time-stop (nëse s'lëviz brenda X min, dil) + venitje momentum-i
      // (EMA9 kryqëzohet mbrapsht kundër pozicionit → dil menjëherë). Të dyja nga hulumtimi
      // i skalperave profesionistë: "nëse s'ecën shpejt, s'ecën fare".
      if (!closed && t.strategy === "scalp") {
        const cl1e = c1.map((c) => c.close);
        const e9now = last(ema(cl1e, 9)), e21now = last(ema(cl1e, 21));
        const fade = isBuy ? e9now < e21now : e9now > e21now;
        const ageMin = (Date.now() - since) / 60000;
        if (fade || ageMin >= Math.max(3, Number(cfg.scalp_time_stop_min) || 15)) {
          closed = { status: "expired", exit: px };
          if (t.live && t.live_order_id && broker) {
            try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: t.live_order_id }); } catch { /* pozicioni mund të jetë mbyllur vetë */ }
          }
        }
      }
      // A) DALJA E MENÇUR (miratuar nga pronari): pozicion swing/momentum në fitim të LARTË (≥2R)
      // dhe momentum-i 15m kthehet FORT kundër → merr fitimin e lartë tani, mos prit kthesën/TP-në.
      if (!closed && cfg.smart_exit !== false && t.strategy !== "scalp") {
        const favNow = isBuy ? px - t.entry_price : t.entry_price - px;
        if (riskDist > 0 && favNow / riskDist >= 2) {
          const flip = isBuy ? (e9_15v < e21_15v && rsi15sm < 45) : (e9_15v > e21_15v && rsi15sm > 55);
          if (flip) {
            closed = { status: "trail", exit: px };
            if (t.live && t.live_order_id && broker) {
              try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: t.live_order_id }); } catch { /* mund të jetë mbyllur vetë */ }
            }
          }
        }
      }
      // MERR FITIMIN PAS KOHE (kërkesa e pronarit): pozicion i hapur GJATË (≥ tp_time_h orë)
      // me fitim të mjaftueshëm (≥ tp_time_usd $) → mbylle me fitim dhe LIRO vendin — fituesit
      // e ngadaltë të mos bllokojnë max_open dhe të humbin mundësitë e reja.
      if (!closed && Number(cfg.tp_time_h) > 0 && t.strategy !== "scalp") {
        const ageH = (Date.now() - since) / 3600000;
        const pnlNow = (isBuy ? px - t.entry_price : t.entry_price - px) * VPP * t.lots;
        if (ageH >= Number(cfg.tp_time_h) && pnlNow >= Math.max(1, Number(cfg.tp_time_usd) || 10)) {
          closed = { status: "trail", exit: px };
          if (t.live && t.live_order_id && broker) {
            try { await maTrade(broker, { actionType: "POSITION_CLOSE_ID", positionId: t.live_order_id }); } catch { /* mund të jetë mbyllur vetë */ }
          }
        }
      }
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
          } else if (rNow >= (String(p.comment || "").includes("MMT-S") ? Math.min(cfg.be_at_r, 0.5) : cfg.be_at_r)) {
            // Scalp live (MMT-S): mbrojtje e hershme +0.5R edhe te pozicioni real.
            const be = entry + (isBuy ? 1 : -1) * riskDist * 0.05;
            if (isBuy ? be > target : be < target) target = be;
          }
          if (target !== slNow && (isBuy ? target > slNow : target < slNow)) {
            await maTrade(broker, { actionType: "POSITION_MODIFY", positionId: p.id, stopLoss: Math.round(target * 100) / 100, takeProfit: p.takeProfit ?? undefined });
          }
        }
      } catch { /* menaxhimi live s'duhet të ndalë skanimin */ }
    }

    // ======= MMT-SCALP (Blic) — modul afat-shkurtër 1m, punon ÇDO MINUTË =======
    // Metoda e ekspertëve: EMA9/EMA21(1m) + pullback + RSI7, në drejtim të 15m; SL i ngushtë
    // (max($2, 1.2×ATR1m)), TP 1.5R; daljet: TP/SL/BE/trailing + time-stop + venitje EMA (te vlerësimi).
    if (cfg.scalp_on && cfg.active && !(cfg.blackout_until && new Date(cfg.blackout_until).getTime() > Date.now())) {
      const hU = new Date().getUTCHours();
      const inSess = (cfg.sessions || []).some(([a, b]) => hU >= a && hU < b);
      if (inSess) {
        const today0 = new Date(); today0.setUTCHours(0, 0, 0, 0);
        const { data: dayR } = await db.from("mmt_trades").select("status, pnl_usd, strategy, opened_at").gte("opened_at", today0.toISOString());
        const dRows = (dayR ?? []) as { status: string; pnl_usd: number | null; strategy: string; opened_at: string }[];
        const slT = dRows.filter((r) => r.status === "sl" && r.strategy !== "fast").length;
        const pnlT = dRows.filter((r) => r.strategy !== "fast").reduce((a, r) => a + Number(r.pnl_usd ?? 0), 0);
        const scT = dRows.filter((r) => r.strategy === "scalp").length;
        const lastSc = dRows.filter((r) => r.strategy === "scalp").map((r) => new Date(r.opened_at).getTime()).sort((a, b) => b - a)[0] || 0;
        const openNow = open.filter((t) => t.status === "open").length - closedNow;
        if (slT < cfg.kill_after_sl && pnlT > -cfg.paper_equity * (cfg.daily_stop_pct / 100)
          && openNow < cfg.max_open && scT < (Number(cfg.scalp_max_day) || 8)
          && Date.now() - lastSc >= (Number(cfg.scalp_cooldown_min) || 5) * 60 * 1000) {
          const cl1s = c1.map((c) => c.close);
          const e9s = ema(cl1s, 9), e21s = ema(cl1s, 21), r7s = rsi(cl1s, 7);
          const atr1m = last(atr(c1.map((c) => c.high), c1.map((c) => c.low), cl1s, 14));
          const lastB = c1[c1.length - 1], prevB = c1[c1.length - 2];
          const dir15s = last(c15.map((c) => c.close)) > last(ema(c15.map((c) => c.close), 20)) ? "BUY" : "SELL";
          let sSide: "BUY" | "SELL" | null = null;
          // BUY: mikro-trendi lart + pullback te EMA9 + qiri konfirmues + RSI7 50-80 (momentum pa ekstrem)
          if (dir15s === "BUY" && last(e9s) > last(e21s) && lastB.close > last(e9s)
            && prevB.low <= e9s[e9s.length - 2] * 1.0003 && lastB.close > lastB.open
            && last(r7s) >= 50 && last(r7s) <= 80) sSide = "BUY";
          // SELL: pasqyra
          if (dir15s === "SELL" && last(e9s) < last(e21s) && lastB.close < last(e9s)
            && prevB.high >= e9s[e9s.length - 2] * 0.9997 && lastB.close < lastB.open
            && last(r7s) <= 50 && last(r7s) >= 20) sSide = "SELL";
          // ROJA ANTI-DYFISHIM: nëse një robot tjetër MMT (fast/long) sapo hapi në të njëjtin
          // drejtim (≤2 min), scalp-i s'hyn — dy hyrje identike njëkohësisht = rrezik 2×.
          if (sSide && open.some((t) => t.status === "open" && t.side === sSide
            && Date.now() - new Date(t.opened_at).getTime() < 120_000)) sSide = null;
          // KONFIRMIMI ME FIGURË QIRIU (konfluencë): matet GJITHMONË që të mbledhim
          // provën A/B (fitorja me figurë vs pa figurë), por e BLLOKON hyrjen VETËM
          // kur pronari ndez çelësin scalp_candle_confirm. Zero rrezik derisa provohet.
          const cpat = sSide ? candlePattern(c1, sSide) : null;
          if (sSide && cfg.scalp_candle_confirm && !cpat) sSide = null;
          if (sSide) {
            // Mbrojtjet e çastit (versionet scalp): spike + presioni 8×1m + skanimi 10-sekondësh.
            const rngs = c1.slice(-30).map((c) => c.high - c.low);
            const avg1s = rngs.reduce((a, b) => a + b, 0) / rngs.length;
            const okSpike = (lastB.high - lastB.low) <= cfg.spike_mult * avg1s;
            let okPress = true;
            { let bu = 0, be = 0; for (const b of c1.slice(-8)) { const bd = Math.abs(b.close - b.open) * (b.volume || 1); if (b.close >= b.open) bu += bd; else be += bd; } const tt = bu + be; if (tt > 0) { const ag = sSide === "BUY" ? be / tt : bu / tt; okPress = ag * 100 < cfg.pressure_pct; } }
            if (okSpike && okPress) {
              const s1b = await candles("1s", 15);
              let px2 = lastB.close, okS = true;
              if (s1b && s1b.length >= 10) { const l10 = s1b.slice(-10); const mv = l10[l10.length - 1].close - l10[0].close; const ag = sSide === "BUY" ? -mv : mv; okS = ag <= 0.3 * avg1s; px2 = l10[l10.length - 1].close; }
              if (okS) {
                const slD = Math.max(2, 1.2 * (Number.isFinite(atr1m) ? atr1m : 2));
                const sl2 = sSide === "BUY" ? px2 - slD : px2 + slD;
                const tp2 = sSide === "BUY" ? px2 + slD * (Number(cfg.scalp_tp_rr) || 1.5) : px2 - slD * (Number(cfg.scalp_tp_rr) || 1.5);
                const riskU = cfg.paper_equity * (cfg.risk_pct / 100);
                const lots2 = Math.max(0.01, Math.floor((riskU / (slD * VPP)) * 100) / 100);
                let lOk = false, lId: string | null = null;
                if (broker) {
                  try {
                    // SL/TP në kornizën e çmimit REAL të brokerit — ndryshe INVALID_STOPS.
                    const q = await maQuote(broker);
                    const off = q ? (q.bid + q.ask) / 2 - px2 : null;
                    const slL = off != null ? sl2 + off : sl2, tpL = off != null ? tp2 + off : tp2;
                    const r = await maTrade(broker, { actionType: sSide === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: broker.symbol, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), stopLoss: Math.round(slL * 100) / 100, takeProfit: Math.round(tpL * 100) / 100, comment: "MMT-S" });
                    const rb = r.body as { orderId?: string } | null;
                    lOk = r.ok && !!rb?.orderId; lId = rb?.orderId ?? null;
                    try {
                      await db.from("trade_executions").insert({ user_id: cfg.live_user_id, symbol: "XAUUSD", action: sSide, volume: Math.max(0.01, Number(cfg.live_lots) || 0.01), entry_price: Math.round(px2 * 100) / 100, stop_loss: Math.round(slL * 100) / 100, take_profit: Math.round(tpL * 100) / 100, mode: "live", status: lOk ? "executed" : "error", reason: (lOk ? "MMT-S scalp auto (1m)" : `MMT-S live dështoi (${r.status})`).slice(0, 200), metaapi_order_id: lId, raw_response: r.body ?? null });
                    } catch { /* logu s'ndal motorin */ }
                  } catch { /* dështimi live s'e ndal letrën */ }
                }
                await db.from("mmt_trades").insert({ symbol: "XAUUSD", side: sSide, strategy: "scalp", regime: "SCALP", entry_price: Math.round(px2 * 100) / 100, sl: Math.round(sl2 * 100) / 100, tp: Math.round(tp2 * 100) / 100, lots: lots2, risk_usd: Math.round(slD * VPP * lots2 * 100) / 100, reason: `scalp 1m: EMA9/21 ${sSide === "BUY" ? "lart" : "poshtë"} + pullback, RSI7 ${Math.round(last(r7s))} · ${cpat ? "figurë:" + cpat : "pa figurë"}`, live: lOk, live_order_id: lId });
                await logScan({ price: px2, regime: "SCALP", decision: sSide === "BUY" ? "open_buy" : "open_sell", details: { strategy: "scalp", sl: sl2, tp: tp2, lots: lots2, live: lOk } });
                return json({ ok: true, decision: sSide, strategy: "scalp", live: lOk, closed: closedNow });
              }
            }
          }
        }
      }
    }

    // Skanimi i PLOTË (regjimi + strategjitë swing/momentum) vetëm në kufijtë 5-minutësh —
    // cron-i tani rreh çdo minutë vetëm për scalp-in dhe daljet e shpejta.
    if (new Date().getUTCMinutes() % 5 !== 0) return json({ ok: true, tick: "1m", closed: closedNow });

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
    // Fast ka kufijte e VET (fast_kill/fast_daily) — SL-te dhe P&L-ja e tij te shumta
    // NUK duhet te ndalin Long/Scalp/Range (me pare e ndotnin numeratorin e perbashket).
    const { data: dayRows } = await db.from("mmt_trades").select("status, pnl_usd, strategy").gte("closed_at", today.toISOString());
    const closedToday = ((dayRows ?? []) as { status: string; pnl_usd: number | null; strategy: string }[]).filter((r) => r.strategy !== "fast");
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
    // ANTI-DUBLIKAT: e njejta strategji + i njejti drejtim = 1 pozicion i hapur maksimumi.
    // (Skanimi 5-min ri-hapte te NJEJTIN setup 2 here — humbje dyfishe identike 3x ne jave.)
    if (open.some((t) => t.status === "open" && t.strategy === strategy && t.side === side))
      return rej(`dublikat_${strategy}_${side} (pozicion i hapur i te njejtes strategji)`);

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
        // SL/TP në kornizën e çmimit REAL të brokerit — ndryshe stops të ngushta refuzohen.
        const q = await maQuote(broker);
        const off = q ? (q.bid + q.ask) / 2 - pxNow : 0;
        const r = await maTrade(broker, {
          actionType: isBuySide ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: broker.symbol,
          volume: Math.max(0.01, Number(cfg.live_lots) || 0.01),
          stopLoss: Math.round((sl + off) * 100) / 100, takeProfit: Math.round((tp + off) * 100) / 100, comment: "MMT",
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
            stop_loss: Math.round((sl + off) * 100) / 100, take_profit: Math.round((tp + off) * 100) / 100,
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
