// ─────────────────────────────────────────────────────────────────────────────
// FastT worker — always-on, KOHË REALE E VËRTETË përmes MetaApi streaming (WebSocket).
//
// Si funksionon:
//  • Lidhet me MetaApi me STREAMING (jo polling). terminalState mbahet i sinkronizuar
//    nga WebSocket-i — çmimi/pozicionet janë live në memorie pa thirrje REST.
//  • Një lak çdo ~250ms LEXON gjendjen live, ndërton qiririn 1m që po formohet nga tick-at,
//    dhe i jep "trurit" (strategy.js) pamjen 1m live për të arsyetuar hyrjen/daljen.
//  • Ekzekuton trade-t menjëherë (createMarketOrder / closePosition) me emrin "FastT".
//  • Regjistron te Supabase (trade_executions) që UI/Raportet të tregojnë badge "FastT".
//  • Respekton scalp_live_enabled / kill_switch / max_daily_loss nga metaapi_config.
//
// KUJDES: kërkon host ALWAYS-ON (Railway/Fly/Render/VPS) — JO Supabase/Vercel.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import http from 'node:http';
import MetaApi from 'metaapi.cloud-sdk/esm-node';
import { createClient } from '@supabase/supabase-js';
import { entryDecision, exitDecision } from './strategy.js';

// ---- Konfigurimi nga env ----
const TOKEN = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;
const REGION = process.env.METAAPI_REGION || 'new-york';
const SYMBOL = process.env.FASTT_SYMBOL || 'XAUUSD+';
const USER_ID = process.env.FASTT_USER_ID; // për të lexuar config + për të regjistruar trade-t
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Parametrat e strategjisë (me parazgjedhje të arsyeshme për arin; mund t'i mbivendosësh me env).
const PARAMS = {
  overExtAtr: Number(process.env.FASTT_OVEREXT_ATR || 1.2),   // mos hyr nëse > k×ATR larg EMA9
  pullbackLookback: Number(process.env.FASTT_PULLBACK_BARS || 4), // sa qirinj mbrapa kërkojmë pullback
  exitBufferAtr: Number(process.env.FASTT_EXIT_BUFFER_ATR || 0.15), // sa nën/mbi EMA9 = kthesë
  lockProfit: Number(process.env.FASTT_LOCK_PROFIT || 1.2),   // $ favor para se të aktivizohet siguria
  giveback: Number(process.env.FASTT_GIVEBACK || 0.5),        // $ i lejuar të kthehet nga maja
};
const CATASTROPHE = Number(process.env.FASTT_CATASTROPHE_USD || 2.0); // SL i gjerë te brokeri (parashutë)
const DEFAULT_LOT = Number(process.env.FASTT_LOT || 0.01);
const TICK_MS = Number(process.env.FASTT_TICK_MS || 250);     // sa shpesh arsyeton (kohë reale)
const ENTRY_COOLDOWN_MS = Number(process.env.FASTT_COOLDOWN_MS || 45000);
const PORT = Number(process.env.PORT || 8080);               // health-check (host-et e duan një port)
const STALE_MS = Number(process.env.FASTT_STALE_MS || 90000); // pa tick > kaq → rinis (vetë-rikuperim)

if (!TOKEN || !ACCOUNT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !USER_ID) {
  console.error('Mungojnë env: METAAPI_TOKEN, METAAPI_ACCOUNT_ID, FASTT_USER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const marketDataHost = `https://mt-market-data-client-api-v1.${REGION.trim()}.agiliumtrade.ai`;

// ---- Gjendja live ----
let closedCandles = [];        // qirinjtë 1m të mbyllur (warmup + të ndërtuar live)
let forming = null;            // qiriri 1m që po formohet: { time, open, high, low, close }
const ticks = [];              // tick-a të fundit: { t, p } për tickBias
let cfg = { enabled: true, killSwitch: false, maxDailyLoss: 1000, dayStartEquity: 0, lot: DEFAULT_LOT };
let lastEntryAt = 0;
const peakMap = new Map();     // positionId -> maja e favorit ($)
let busy = false;              // mbrojtje nga ekzekutime të mbivendosura
let lastTickAt = Date.now();   // koha e tick-ut të fundit live — për health-check + watchdog
let lastError = '';            // gabimi i fundit (shfaqet te /health)

// Server health-check: host-et (Railway/Render/Fly) e përdorin për të ditur se procesi është gjallë.
// Hapja: GET / ose /health → 200 nëse tick-at janë të freskët, 503 nëse kanë ngecur.
function startHealthServer() {
  http.createServer((req, res) => {
    const ageMs = Date.now() - lastTickAt;
    const healthy = ageMs < STALE_MS;
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'stale', lastTickAgeMs: ageMs, symbol: SYMBOL, lastError }));
  }).listen(PORT, () => console.log(`Health-check në portin ${PORT} (GET /health)`));

  // Watchdog: nëse rrjedha e tick-ave ngec (lidhja ra pa u rrëzuar procesi) → dil që host-i të rinisë.
  setInterval(() => {
    const ageMs = Date.now() - lastTickAt;
    if (ageMs > STALE_MS) {
      console.error(`Watchdog: pa tick prej ${Math.round(ageMs / 1000)}s → po rinisem për t'u rilidhur.`);
      process.exit(1); // host-i (restart=always) e ngre përsëri → rilidhje e pastër
    }
  }, Math.max(5000, Math.floor(STALE_MS / 3)));
}

function minuteStart(ms) { return Math.floor(ms / 60000) * 60000; }

// A është hapur tregu i LONDRËS ose i NJU-JORKUT tani? Ora lokale e tregjeve (DST-safe), Hën–Pre.
function londonOrNyOpen(d = new Date()) {
  const sess = (tz, openH, closeH) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(d);
    const wd = p.find((x) => x.type === 'weekday')?.value || '';
    const h = parseInt(p.find((x) => x.type === 'hour')?.value || '0', 10) % 24;
    if (wd === 'Sat' || wd === 'Sun') return false;
    return h >= openH && h < closeH;
  };
  return sess('Europe/London', 8, 17) || sess('America/New_York', 8, 17);
}

// Ndërto/azhurno qiririn 1m që po formohet nga çdo tick live.
function ingestTick(price, tMs) {
  ticks.push({ t: tMs, p: price });
  while (ticks.length && tMs - ticks[0].t > 20000) ticks.shift(); // mbaj ~20s tick-a (për tickStart + reversalExit)

  const m = minuteStart(tMs);
  if (!forming || forming.time !== m) {
    if (forming) { closedCandles.push(forming); if (closedCandles.length > 120) closedCandles.shift(); }
    forming = { time: m, open: price, high: price, low: price, close: price };
  } else {
    forming.high = Math.max(forming.high, price);
    forming.low = Math.min(forming.low, price);
    forming.close = price;
  }
}

// Drejtimi i çmimit TANI nga tick-at e fundit (> 0 ngjitet, < 0 bie).
function tickBias() {
  if (ticks.length < 2) return 0;
  const now = ticks[ticks.length - 1];
  const start = now.t - 4000;
  let ref = ticks[0];
  for (const x of ticks) { if (x.t >= start) { ref = x; break; } }
  return now.p - ref.p;
}

// Warmup: merr qirinjtë 1m historikë (REST) që EMA/ATR të jenë gati që në sekondën e parë.
async function warmupCandles() {
  const url = `${marketDataHost}/users/current/accounts/${ACCOUNT_ID}/historical-market-data/symbols/${encodeURIComponent(SYMBOL)}/timeframes/1m/candles?limit=120`;
  try {
    const resp = await fetch(url, { headers: { 'auth-token': TOKEN } });
    if (!resp.ok) { console.warn('warmup candles status', resp.status); return; }
    const arr = await resp.json();
    if (Array.isArray(arr)) {
      closedCandles = arr.map((k) => ({
        time: new Date(k.time || k.brokerTime).getTime(),
        open: +k.open, high: +k.high, low: +k.low, close: +k.close,
      }));
      console.log(`Warmup: ${closedCandles.length} qirinj 1m`);
    }
  } catch (e) { console.warn('warmup error', e.message); }
}

// Rifresko konfigurimin (enabled / kill / daily-loss / lot) nga Supabase.
async function refreshConfig() {
  try {
    const { data } = await db.from('metaapi_config')
      .select('scalp_live_enabled, kill_switch, max_daily_loss, day_start_equity, scalp_live_lot, scalp_live_catastrophe_usd')
      .eq('user_id', USER_ID).maybeSingle();
    if (data) {
      cfg.enabled = !!data.scalp_live_enabled;
      cfg.killSwitch = !!data.kill_switch;
      cfg.maxDailyLoss = Number(data.max_daily_loss) > 0 ? Number(data.max_daily_loss) : 1000;
      cfg.dayStartEquity = Number(data.day_start_equity) || 0;
      cfg.lot = Number(data.scalp_live_lot) > 0 ? Number(data.scalp_live_lot) : DEFAULT_LOT;
    }
  } catch (e) { console.warn('config refresh error', e.message); }
}

async function logExec(row) {
  try { await db.from('trade_executions').insert({ user_id: USER_ID, mode: 'live', ...row }); }
  catch (e) { console.warn('log error', e.message); }
}

async function main() {
  startHealthServer();           // health-check + watchdog (host-et e duan)
  lastTickAt = Date.now();       // mos lejo watchdog-un të rinisë gjatë warmup/sinkronizimit
  await warmupCandles();
  await refreshConfig();
  setInterval(refreshConfig, 20000);

  const api = new MetaApi(TOKEN, { region: REGION });
  const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);
  console.log('Po pritet lidhja me llogarinë...');
  await account.waitConnected();
  const connection = account.getStreamingConnection();
  await connection.connect();
  console.log('Po sinkronizohet terminali...');
  await connection.waitSynchronized({ timeoutInSeconds: 90 });
  await connection.subscribeToMarketData(SYMBOL, [{ type: 'quotes' }]);
  const ts = connection.terminalState;
  lastTickAt = Date.now(); // sapo u sinkronizua — nis numërimin e freskisë nga këtu
  console.log(`✅ FastT worker LIVE — streaming ${SYMBOL} @ ${REGION}. Arsyeton çdo ${TICK_MS}ms.`);

  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const q = ts.price(SYMBOL);
      if (!q || !(q.bid > 0) || !(q.ask > 0)) return;
      const price = (q.bid + q.ask) / 2;
      ingestTick(price, Date.now());
      lastTickAt = Date.now(); // shenjë gjallërie për health-check + watchdog

      const candles = forming ? [...closedCandles, forming] : closedCandles;
      if (candles.length < 25) return;

      const positions = (ts.positions || []).filter(
        (p) => /FastT/i.test(`${p.comment ?? ''} ${p.clientId ?? ''}`) &&
               String(p.symbol).toUpperCase() === SYMBOL.toUpperCase(),
      );

      // ===== MENAXHIM (dalje) — gjithmonë aktiv, edhe nëse u çaktivizua (mbyll me kujdes) =====
      for (const pos of positions) {
        const isBuy = String(pos.type).includes('BUY');
        const entry = Number(pos.openPrice);
        const moved = isBuy ? price - entry : entry - price;
        const prevPeak = peakMap.get(pos.id) ?? moved;
        const peak = Math.max(prevPeak, moved);
        peakMap.set(pos.id, peak);

        const nowMs = Date.now();
        const recTicks = ticks.filter((t) => nowMs - t.t <= 10000); // ~10s për daljen real-time
        const openMs = pos.time ? new Date(pos.time).getTime() : NaN;
        const ageMs = Number.isFinite(openMs) ? (nowMs - openMs) : Infinity;
        const reason = exitDecision({ candles, price, ticks: recTicks, position: pos, peak, ageMs }, { catastrophe: CATASTROPHE });
        if (reason) {
          try {
            await connection.closePosition(pos.id);
            peakMap.delete(pos.id);
            console.log(`MBYLL ${isBuy ? 'BUY' : 'SELL'} ${SYMBOL}: ${reason}`);
            await logExec({ symbol: SYMBOL, action: isBuy ? 'BUY' : 'SELL', volume: pos.volume,
              entry_price: entry, status: 'info', reason: `FastT mbylli: ${reason}`, metaapi_order_id: pos.id });
          } catch (e) { console.warn('close error', e.message); }
        }
      }

      // ===== HYRJE — vetëm nëse aktiv, pa kill-switch, pa ndalim ditor, pa pozicion =====
      if (!cfg.enabled || cfg.killSwitch) return;
      if (positions.length > 0) return;
      if (Date.now() - lastEntryAt < ENTRY_COOLDOWN_MS) return;
      // FILTËR SESIONI: hap vetëm kur Londra OSE Nju-Jorku është i hapur (sesionet me likuiditet, DST-safe).
      if (!londonOrNyOpen()) return;

      // Ndalim ditor i humbjes nga equity live.
      const info = ts.accountInformation;
      const equity = Number(info?.equity);
      if (cfg.dayStartEquity > 0 && Number.isFinite(equity) && equity - cfg.dayStartEquity <= -cfg.maxDailyLoss) {
        return; // u arrit humbja maksimale ditore
      }

      const sig = entryDecision({ candles, ticks }, PARAMS);
      if (!sig) return;

      const isBuy = sig.action === 'BUY';
      const sl = Math.round((isBuy ? price - CATASTROPHE : price + CATASTROPHE) * 100) / 100;
      const lot = Math.max(0.01, Math.round(cfg.lot * 100) / 100);
      lastEntryAt = Date.now();
      try {
        const opts = { comment: 'FastT' };
        const res = isBuy
          ? await connection.createMarketBuyOrder(SYMBOL, lot, sl, undefined, opts)
          : await connection.createMarketSellOrder(SYMBOL, lot, sl, undefined, opts);
        console.log(`HYR ${sig.action} ${SYMBOL} ${lot} lot @ ${price.toFixed(2)} SL ${sl} — ${sig.reason}`);
        await logExec({ symbol: SYMBOL, action: sig.action, volume: lot, entry_price: price, stop_loss: sl,
          status: 'executed', reason: `FastT auto (live): ${sig.reason}`, metaapi_order_id: res?.orderId ?? res?.positionId ?? null });
      } catch (e) {
        console.warn('order error', e.message);
        await logExec({ symbol: SYMBOL, action: sig.action, volume: lot, entry_price: price, stop_loss: sl,
          status: 'error', reason: `FastT: ${e.message}`.slice(0, 200) });
      }
    } catch (e) {
      console.warn('loop error', e.message);
    } finally {
      busy = false;
    }
  }, TICK_MS);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

// Mbyllje e qetë.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
