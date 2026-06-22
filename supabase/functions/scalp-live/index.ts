import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// scalp-live — robot scalping në "kohë reale". Cron-i e nis çdo minutë, por funksioni bën një
// CIKËL ~50s brenda minutës duke ndjekur tick-un live (~çdo 2.5s):
//  • Hyrje e shpejtë në momentum (1m/5m, e njëjta logjikë e provuar e scalp-it).
//  • Mbrojtje e shpejtë e fitimit: sapo lëvizja kalon "grab", del kur kthehet pak nga maja (giveback).
//  • Prerje e hershme në kthesë me një HAPËSIRË të vogël (lejon një ri-test para se të dalë).
//  • SL "katastrofe" i gjerë te brokeri = rrjetë sigurie nëse funksioni/rrjeti bie (pozicioni s'mbetet i zhveshur).
// Modalitet i RI, krah për krah me auto-trade-runner (s'e prek formulën fituese). Pa Claude në rrugën e shpejtë.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Etiketa/emri që dallon pozicionet e këtij roboti (te `comment`/`clientId`) — shfaqet te MT5
// si emri i trade-it: "FastT". NUK përmban "SCALP" me qëllim — që auto-trade-runner
// (isScalpPosition → /SCALP/i) të mos e mbyllë në kthesën e tij 1-minutëshe; këtë pozicion e
// menaxhon EKSKLUZIVISHT scalp-live (me hapësirën e ri-testit).
const SCALP_LIVE_TAG = "FastT";

interface Cfg {
  user_id: string; account_id: string; token: string; region: string; mode: string;
  max_lot?: number; max_daily_loss?: number; kill_switch?: boolean;
  symbol_map?: Record<string, string> | null;
  day_start_equity?: number; day_start_date?: string;
  scalp_live_enabled?: boolean; scalp_live_lot?: number; scalp_live_symbols?: string;
  scalp_live_max_trades?: number; scalp_live_grab_usd?: number; scalp_live_giveback_usd?: number;
  scalp_live_cut_usd?: number; scalp_live_catastrophe_usd?: number;
}
interface Position {
  id: string; type?: string; symbol?: string; volume?: number; openPrice?: number; currentPrice?: number;
  stopLoss?: number; takeProfit?: number; profit?: number; comment?: string; clientId?: string;
}
interface Candle { time: number; open: number; high: number; low: number; close: number; }

function host(region: string) { return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`; }
function marketDataHost(region: string) { return `https://mt-market-data-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`; }

function isScalpLivePosition(p: Position): boolean {
  return new RegExp(SCALP_LIVE_TAG, "i").test(String(p.comment ?? "")) || new RegExp(SCALP_LIVE_TAG, "i").test(String(p.clientId ?? ""));
}

// Tregu FX/metale i hapur tani? (E premte pas 21:00 UTC → E diel 22:00 UTC = mbyllur.)
function isMarketOpen(d = new Date()): boolean {
  const day = d.getUTCDay(), h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && h < 22) return false;
  if (day === 5 && h >= 21) return false;
  return true;
}
// Orari i arit (Europe/Berlin): Hën–Pre 06:00–23:00; e Diel nga 23:00; e Shtunë mbyllur.
function goldSessionOpen(d = new Date()): boolean {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", hour12: false }).formatToParts(d);
  const wd = p.find((x) => x.type === "weekday")?.value || "";
  const h = parseInt(p.find((x) => x.type === "hour")?.value || "0", 10) % 24;
  if (wd === "Sat") return false;
  if (wd === "Sun") return h >= 23;
  return h >= 6 && h < 23;
}
function isCrypto(symbol: string): boolean { return /^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test((symbol || "").toUpperCase()); }
function isOil(symbol: string): boolean { return /^(USOIL|UKOIL|WTI|XTI|XBR|BRENT|UKO|USO|CL)/i.test((symbol || "").toUpperCase()); }
function valuePerPrice(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU")) return 100;
  if (s.includes("XAG")) return 5000;
  if (/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK)/.test(s)) return 1;
  if (isOil(s)) return 1000;
  if (s.length === 6) return 100000;
  return 100;
}

// ---------- Indikatorë (për sinjalin e hyrjes scalp) ----------
function ema(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length < p) return out;
  const k = 2 / (p + 1); let s = 0;
  for (let i = 0; i < p; i++) s += v[i];
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
function macdHist(v: number[]): number[] {
  const ef = ema(v, 12), es = ema(v, 26);
  const line = v.map((_, i) => (Number.isNaN(ef[i]) || Number.isNaN(es[i]) ? NaN : ef[i] - es[i]));
  const first = line.findIndex((x) => !Number.isNaN(x));
  const sig = new Array(v.length).fill(NaN);
  if (first !== -1) { const s = ema(line.slice(first), 9); for (let i = 0; i < s.length; i++) sig[first + i] = s[i]; }
  return v.map((_, i) => (Number.isNaN(line[i]) || Number.isNaN(sig[i]) ? NaN : line[i] - sig[i]));
}
function atr(highs: number[], lows: number[], closes: number[], p = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= p) return out;
  const tr = new Array(n).fill(NaN); tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i];
  let prev = s / p; out[p] = prev;
  for (let i = p + 1; i < n; i++) { prev = (prev * (p - 1) + tr[i]) / p; out[i] = prev; }
  return out;
}
function adx(highs: number[], lows: number[], closes: number[], p = 14): number[] {
  const n = closes.length, out = new Array(n).fill(NaN);
  if (n <= p * 2 + 1) return out;
  const pdm = new Array(n).fill(0), mdm = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let as = 0, ps = 0, ms = 0;
  for (let i = 1; i <= p; i++) { as += tr[i]; ps += pdm[i]; ms += mdm[i]; }
  const dx = new Array(n).fill(NaN);
  for (let i = p + 1; i < n; i++) {
    as = as - as / p + tr[i]; ps = ps - ps / p + pdm[i]; ms = ms - ms / p + mdm[i];
    const pdi = as === 0 ? 0 : 100 * ps / as, mdi = as === 0 ? 0 : 100 * ms / as;
    const den = pdi + mdi; dx[i] = den === 0 ? 0 : 100 * Math.abs(pdi - mdi) / den;
  }
  const f = dx.findIndex((x) => !Number.isNaN(x));
  if (f === -1 || f + p >= n) return out;
  let sum = 0; for (let i = f; i < f + p; i++) sum += dx[i];
  let prev = sum / p; out[f + p - 1] = prev;
  for (let i = f + p; i < n; i++) { prev = (prev * (p - 1) + dx[i]) / p; out[i] = prev; }
  return out;
}
function efficiencyRatio(closes: number[], n = 10): number {
  if (closes.length < n + 1) return 0;
  const seg = closes.slice(-(n + 1));
  const change = Math.abs(seg[seg.length - 1] - seg[0]);
  let vol = 0;
  for (let i = 1; i < seg.length; i++) vol += Math.abs(seg[i] - seg[i - 1]);
  return vol > 0 ? change / vol : 0;
}

// Sinjali i hyrjes scalp (i njëjti filtër regjimi i provuar: trend 5m + breakout 1m, anti-chop).
function scalpSignal(c1m: Candle[], c5m: Candle[]): { action: "BUY" | "SELL"; reason: string } | null {
  if (c1m.length < 35 || c5m.length < 30) return null;
  const cl1 = c1m.map((c) => c.close), cl5 = c5m.map((c) => c.close);
  const i1 = cl1.length - 1, i5 = cl5.length - 1;
  const e9_5 = ema(cl5, 9)[i5], e21_5 = ema(cl5, 21)[i5];
  if (!Number.isFinite(e9_5) || !Number.isFinite(e21_5)) return null;
  const dir5 = e9_5 > e21_5 ? "up" : e9_5 < e21_5 ? "down" : "flat";
  if (dir5 === "flat") return null;
  const e9_1 = ema(cl1, 9)[i1], e21_1 = ema(cl1, 21)[i1];
  const r1 = rsi(cl1, 14)[i1];
  const mh1 = macdHist(cl1)[i1];
  const price = cl1[i1];
  const last = c1m[i1];
  if (!Number.isFinite(e9_1) || !Number.isFinite(e21_1) || !Number.isFinite(r1) || !Number.isFinite(mh1)) return null;
  // Filtri i regjimit (anti-whipsaw): trend real (ADX 5m ≥ 22) + lëvizje efikase (ER 5m ≥ 0.35).
  const hi5r = c5m.map((c) => c.high), lo5r = c5m.map((c) => c.low);
  const adx5 = adx(hi5r, lo5r, cl5, 14)[i5];
  const er5 = efficiencyRatio(cl5, 10);
  if (!Number.isFinite(adx5) || adx5 < 22) return null;
  if (er5 < 0.35) return null;
  // Over-extension veto: mos hyr kur çmimi është >1.5×ATR(1m) larg EMA9(1m).
  const atr1g = atr(c1m.map((c) => c.high), c1m.map((c) => c.low), cl1, 14)[i1];
  if (Number.isFinite(atr1g) && atr1g > 0 && Math.abs(price - e9_1) > 1.5 * atr1g) return null;
  // BUY: trend 5m↑, 1m EMA9>EMA21, çmimi mbi EMA9, qiri ngjitës, RSI<75, MACD hist>0, breakout 3-qirinjsh.
  if (dir5 === "up" && e9_1 > e21_1 && price > e9_1 && last.close > last.open && r1 < 75 && mh1 > 0) {
    const recentHigh = Math.max(c1m[i1 - 1].high, c1m[i1 - 2].high, c1m[i1 - 3].high);
    if (price >= recentHigh) return { action: "BUY", reason: "momentum 1m↑ në trend 5m↑ (breakout)" };
  }
  // SELL: pasqyrë.
  if (dir5 === "down" && e9_1 < e21_1 && price < e9_1 && last.close < last.open && r1 > 25 && mh1 < 0) {
    const recentLow = Math.min(c1m[i1 - 1].low, c1m[i1 - 2].low, c1m[i1 - 3].low);
    if (price <= recentLow) return { action: "SELL", reason: "momentum 1m↓ në trend 5m↓ (breakdown)" };
  }
  return null;
}

async function fetchMt5Candles(cfg: Cfg, symbol: string, tf: string, limit = 120): Promise<Candle[] | null> {
  const url = `${marketDataHost(cfg.region)}/users/current/accounts/${cfg.account_id}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${tf}/candles?limit=${limit}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(10000) });
      if (resp.status === 429 || resp.status === 502 || resp.status === 503) { if (attempt < 1) { await new Promise((r) => setTimeout(r, 500)); continue; } return null; }
      if (!resp.ok) return null;
      const arr = await resp.json();
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr.map((k: Record<string, unknown>) => ({
        time: new Date((k.time ?? k.brokerTime) as string).getTime(),
        open: +(k.open as number), high: +(k.high as number), low: +(k.low as number), close: +(k.close as number),
      }));
    } catch { /* riprovo */ }
    if (attempt < 1) await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function maGet(cfg: Cfg, path: string) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
        headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(12000),
      });
      const txt = await resp.text();
      let body: unknown = txt; try { body = JSON.parse(txt); } catch { /* */ }
      if (resp.status === 429 || resp.status === 502 || resp.status === 503) { lastErr = new Error(`MetaApi ${resp.status}`); }
      else if (!resp.ok) throw new Error(`MetaApi ${resp.status}`);
      else return body;
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/^MetaApi \d{3}$/.test(msg)) throw e;
      lastErr = e as Error;
    }
    if (attempt < 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw lastErr || new Error("MetaApi unreachable");
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

type DB = ReturnType<typeof createClient>;
const _symCache = new Map<string, string>();
async function resolveSymbol(cfg: Cfg, requested: string, db?: DB): Promise<string> {
  const req = requested.toUpperCase();
  const key = `${cfg.account_id}:${req}`;
  const inMem = _symCache.get(key);
  if (inMem) return inMem;
  const persisted = (cfg.symbol_map && typeof cfg.symbol_map === "object") ? (cfg.symbol_map as Record<string, string>)[req] : undefined;
  if (persisted) { _symCache.set(key, persisted); return persisted; }
  try {
    const list = await maGet(cfg, `/symbols`) as unknown;
    if (Array.isArray(list) && list.length > 0) {
      const names = list.map(String);
      const found = names.find((s) => s.toUpperCase() === req)
        || names.find((s) => s.toUpperCase().startsWith(req))
        || (req.includes("XAU") ? (names.find((s) => /xau.*usd/i.test(s)) || names.find((s) => /^gold/i.test(s.trim()))) : undefined);
      if (found) {
        _symCache.set(key, found);
        if (db) {
          const map = (cfg.symbol_map && typeof cfg.symbol_map === "object") ? cfg.symbol_map as Record<string, string> : {};
          try { await db.from("metaapi_config").update({ symbol_map: { ...map, [req]: found } }).eq("user_id", cfg.user_id); } catch { /* */ }
        }
        return found;
      }
    }
  } catch { /* */ }
  return persisted || requested;
}

function brokerResult(body: unknown): { ok: boolean; code: number; msg: string; orderId: string | null } {
  const o = (body ?? {}) as Record<string, unknown>;
  const code = Number(o.numericCode);
  const orderId = (o.orderId as string) ?? (o.positionId as string) ?? null;
  const msg = String(o.message ?? "");
  const ok = code === 10009 || code === 10008 || code === 10010 || (!!orderId && !Number.isFinite(code));
  return { ok, code, msg, orderId };
}

function frankfurtDateStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function pushNotify(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/web-push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
    });
  } catch { /* */ }
}

// Gjendja per-përdorues e llogaritur një herë për ekzekutim (equity + ndalues ditor + simbolet).
interface UserState { cfg: Cfg; equity: number; dailyStop: boolean; maxRisk: number; allowed: string[]; max: number; lot: number; }

// Maja e fitimit (lëvizja maksimale në favor) për çdo pozicion — për trailing-un me giveback.
// E mban gjatë gjithë ciklit ~50s; pozicionet scalp-live janë jetëshkurtra.
const peakMap = new Map<string, number>();
// Koha e hyrjes së fundit scalp-live per (user:symbol) — cooldown anti-grumbullim brenda ciklit.
const lastEntry = new Map<string, number>();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // PORTË SIGURIE (fail-closed): vetëm cron-i me 'x-cron-secret' të saktë.
  try {
    const { data: _cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const _secret = (_cs as { value?: string } | null)?.value;
    if (!_secret || req.headers.get("x-cron-secret") !== _secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const summary: Array<Record<string, unknown>> = [];

  // LOCK i dedikuar (stale > 65s). Nëse e mban një ekzekutim tjetër → dil (cikli ~50s mbulon minutën).
  let lockHeld = false;
  try {
    const staleIso = new Date(Date.now() - 65_000).toISOString();
    const { data: lockRows, error: lockErr } = await db.from("scalp_live_lock")
      .update({ locked_at: new Date().toISOString() }).eq("id", 1)
      .or(`locked_at.is.null,locked_at.lt.${staleIso}`).select("id");
    if (!lockErr) {
      lockHeld = Array.isArray(lockRows) && lockRows.length > 0;
      if (!lockHeld) return new Response(JSON.stringify({ skipped: "busy" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch { /* fail-open */ }

  try {
    const { data: configs } = await db.from("metaapi_config").select("*")
      .eq("scalp_live_enabled", true).eq("kill_switch", false);
    const rows = (configs ?? []).map((r) => r as Cfg).filter((c) => c.account_id && c.token);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, note: "asnjë përdorues scalp-live" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Gjendja per-përdorues (një herë): equity, ndalues ditor i humbjes, simbolet, lot-i ----
    const states: UserState[] = [];
    for (const cfg of rows) {
      let equity = 0, dayStartEq = Number(cfg.day_start_equity);
      try {
        const info = await maGet(cfg, "/account-information") as { balance?: number; equity?: number };
        const bal = Number(info?.balance), eq = Number(info?.equity);
        equity = Number.isFinite(eq) ? eq : (Number.isFinite(bal) ? bal : 0);
        const todayStr = frankfurtDateStr();
        const dsd = cfg.day_start_date ? String(cfg.day_start_date).slice(0, 10) : "";
        if (equity > 0 && (dsd !== todayStr || !Number.isFinite(dayStartEq) || dayStartEq <= 0)) {
          dayStartEq = equity;
          try { await db.from("metaapi_config").update({ day_start_equity: equity, day_start_date: todayStr }).eq("user_id", cfg.user_id); } catch { /* */ }
        }
      } catch (e) { summary.push({ user: cfg.user_id, error: `metaapi: ${(e as Error).message}` }); continue; }
      const maxRisk = Number(cfg.max_daily_loss) > 0 ? Number(cfg.max_daily_loss) : 100;
      const dayPnl = (Number.isFinite(dayStartEq) && dayStartEq > 0 && equity > 0) ? equity - dayStartEq : 0;
      const dailyStop = dayPnl <= -maxRisk;
      // Lot i sigurt: i konfiguruar, i kapur te max_lot; për kapital < €50 → vetëm 0.01.
      let lot = Number(cfg.scalp_live_lot) > 0 ? Number(cfg.scalp_live_lot) : 0.01;
      if (Number(cfg.max_lot) > 0) lot = Math.min(lot, Number(cfg.max_lot));
      if (equity > 0 && equity < 50) lot = 0.01;
      lot = Math.max(0.01, Math.round(lot * 100) / 100);
      const allowed = (cfg.scalp_live_symbols || "XAUUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const max = Math.max(1, Number(cfg.scalp_live_max_trades ?? 1));
      states.push({ cfg, equity, dailyStop, maxRisk, allowed, max, lot });
    }
    if (states.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- CIKLI REAL-TIME: ~50s, çdo ~2.5s ndjek tick-un live ----
    const deadline = Date.now() + 50_000;
    let iter = 0;
    while (Date.now() < deadline) {
      for (const st of states) {
        const cfg = st.cfg;
        let positions: Position[] = [];
        try { positions = (await maGet(cfg, "/positions") as Position[]) ?? []; } catch { continue; }
        if (!Array.isArray(positions)) positions = [];
        const mine = positions.filter(isScalpLivePosition);

        // ===== MENAXHIMI LIVE I POZICIONEVE (çdo iteracion ~2.5s) =====
        for (const p of mine) {
          const isBuy = String(p.type || "").includes("BUY");
          const entry = Number(p.openPrice), cur = Number(p.currentPrice);
          if (!Number.isFinite(entry) || !Number.isFinite(cur)) continue;
          const moved = isBuy ? cur - entry : entry - cur; // lëvizja në FAVOR (njësi çmimi)
          const grab = Math.max(0.05, Number(cfg.scalp_live_grab_usd ?? 0.50));
          const giveback = Math.max(0.02, Number(cfg.scalp_live_giveback_usd ?? 0.25));
          const cut = Math.max(0.05, Number(cfg.scalp_live_cut_usd ?? 0.60));
          const prevPeak = peakMap.get(p.id) ?? moved;
          const peak = Math.max(prevPeak, moved);
          peakMap.set(p.id, peak);

          let close: string | null = null;
          // (1) MBROJTJE FITIMI: pasi lëvizja kalon "grab", del nëse kthehet nga maja > giveback (grab profitin shpejt).
          if (peak >= grab && moved <= peak - giveback) close = `fitim i siguruar (+${moved.toFixed(2)} nga maja +${peak.toFixed(2)})`;
          // (2) PRERJE E HERSHME: kthim kundër > cut (hapësira e ri-testit) → dil para SL-së katastrofe.
          else if (moved <= -cut) close = `prerje e hershme në kthesë (${moved.toFixed(2)})`;

          if (close) {
            try {
              const r = await maTrade(cfg, { actionType: "POSITION_CLOSE_ID", positionId: p.id });
              const br = brokerResult(r.body);
              if (r.ok && (br.ok || br.orderId || !Number.isFinite(br.code))) {
                peakMap.delete(p.id);
                try {
                  await db.from("trade_executions").insert({
                    user_id: cfg.user_id, symbol: p.symbol || "XAUUSD", action: isBuy ? "BUY" : "SELL",
                    volume: p.volume ?? st.lot, entry_price: entry, mode: cfg.mode, status: "info",
                    reason: `Scalp-LIVE mbylli: ${close}`, metaapi_order_id: p.id, raw_response: null,
                  });
                } catch { /* */ }
                await pushNotify({ user_id: cfg.user_id, title: "Scalp-LIVE mbylli një trade", body: `${p.symbol || "XAUUSD"} ${isBuy ? "BLEJ" : "SHIT"} • ${close}`, url: "/", tag: "slv-close" });
                summary.push({ user: cfg.user_id, slv_exit: p.id, reason: close });
              }
            } catch { /* */ }
          }
        }

        // ===== HYRJET (më rrallë: ~çdo 12.5s) =====
        if (iter % 5 !== 0) continue;
        if (st.dailyStop) continue;
        if (!isMarketOpen()) continue;
        const openMine = mine.length;
        if (openMine >= st.max) continue;

        for (const rawSym of st.allowed) {
          if (mine.length + summary.filter((s) => s.user === cfg.user_id && s.slv_open).length >= st.max) break;
          // Vetëm ari në orarin e tij; crypto/naftë lejohen kur tregu i hapur.
          if (!isCrypto(rawSym) && !isOil(rawSym) && !goldSessionOpen()) continue;
          const sym = await resolveSymbol(cfg, rawSym, db);
          // Një pozicion scalp-live për simbol.
          if (positions.some((q) => isScalpLivePosition(q) && (q.symbol || "").toUpperCase() === sym.toUpperCase())) continue;
          // Cooldown 90s për (user:symbol) brenda ciklit.
          const ck = `${cfg.user_id}:${sym.toUpperCase()}`;
          if (Date.now() - (lastEntry.get(ck) ?? 0) < 90_000) continue;
          // Cooldown i qëndrueshëm: mos hap nëse u hap një scalp-live për këtë simbol < 2 min (mes ekzekutimeve).
          const { data: lastSc } = await db.from("trade_executions").select("created_at")
            .eq("user_id", cfg.user_id).eq("symbol", sym).eq("status", "executed")
            .ilike("reason", "Scalp-LIVE auto%").order("created_at", { ascending: false }).limit(1);
          const lastT = lastSc && lastSc[0] ? new Date((lastSc[0] as { created_at: string }).created_at).getTime() : 0;
          if (lastT > 0 && Date.now() - lastT < 2 * 60 * 1000) continue;

          const [c1, c5] = await Promise.all([fetchMt5Candles(cfg, sym, "1m", 120), fetchMt5Candles(cfg, sym, "5m", 120)]);
          if (!c1 || !c5) continue;
          const sgl = scalpSignal(c1, c5);
          if (!sgl) continue;

          const isBuyS = sgl.action === "BUY";
          const entryPx = c1[c1.length - 1].close;
          const cat = Math.max(0.10, Number(cfg.scalp_live_catastrophe_usd ?? 1.50)); // distanca e SL-së katastrofe
          const stopLoss = Math.round((isBuyS ? entryPx - cat : entryPx + cat) * 100) / 100;
          const volume = st.lot;

          const slog = (status: string, reason: string, orderId: string | null, raw: unknown) =>
            db.from("trade_executions").insert({ user_id: cfg.user_id, symbol: sym, action: sgl.action, volume,
              entry_price: entryPx, stop_loss: stopLoss, mode: cfg.mode, status, reason: reason.slice(0, 200), metaapi_order_id: orderId, raw_response: raw ?? null });

          if (!(stopLoss > 0)) { await slog("rejected", "Scalp-LIVE pa SL katastrofe — refuzuar (siguri)", null, null); continue; }
          lastEntry.set(ck, Date.now());
          const body: Record<string, unknown> = { actionType: isBuyS ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: sym, volume, stopLoss, comment: SCALP_LIVE_TAG };
          try {
            const r = await maTrade(cfg, body);
            if (!r.ok) { await slog("error", `Scalp-LIVE trade ${r.status}`, null, r.body); continue; }
            const br = brokerResult(r.body);
            if (!br.ok) { await slog("rejected", `Scalp-LIVE brokeri: ${br.msg || "refuzuar"} (${br.code})`, null, r.body); summary.push({ user: cfg.user_id, slv_reject: sym, code: br.code }); continue; }
            await slog("executed", `Scalp-LIVE auto (${cfg.mode}): ${sgl.reason}`, br.orderId, r.body);
            await pushNotify({ user_id: cfg.user_id, title: "Scalp-LIVE hapi një trade", body: `${isBuyS ? "BLEJ" : "SHIT"} ${sym} • ${volume} lot (live, ${cfg.mode})`, url: "/", tag: "slv-open" });
            summary.push({ user: cfg.user_id, slv_open: sym, order: br.orderId });
          } catch (e) { await slog("error", `Scalp-LIVE: ${(e as Error).message}`, null, null); }
        }
      }
      iter++;
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 2500));
    }

    return new Response(JSON.stringify({ success: true, iterations: iter, processed: summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    if (lockHeld) { try { await db.from("scalp_live_lock").update({ locked_at: null }).eq("id", 1); } catch { /* */ } }
  }
});
