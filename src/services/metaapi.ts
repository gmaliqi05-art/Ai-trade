// Shërbim për integrimin MetaApi.cloud (Faza 5): konfigurim + ekzekutim tregtish.

import { supabase } from '../lib/supabase';

export interface MetaApiConfig {
  account_id: string;
  token: string;
  region: string;
  /** Link i rikonfigurimit nga MetaApi (configure-trading-account-credentials) — shkurtore për të rregulluar lidhjen. */
  config_link: string;
  mode: 'demo' | 'live';
  auto_trade: boolean;
  default_lot: number;
  max_lot: number;
  max_daily_loss: number;
  max_open_trades: number;
  kill_switch: boolean;
  /** Vetëm sinjalet me besueshmëri >= këtij pragu ekzekutohen automatikisht. */
  min_confidence: number;
  /** Lista (me presje) e simboleve të lejuara për auto-trade. */
  auto_symbols: string;
  /** Madhësia e pozicionit dinamike sipas % të analizës (përndryshe përdor default_lot). */
  dynamic_lot: boolean;
  lot_conf_70: number;  // lot për bandën e parë (besueshmëri ≥ lot_conf_t1)
  lot_conf_80: number;  // lot për bandën e dytë (≥ lot_conf_t2)
  lot_conf_90: number;  // lot për bandën e tretë (≥ lot_conf_t3)
  lot_conf_t1: number;  // pragu i parë i besueshmërisë (default 70)
  lot_conf_t2: number;  // pragu i dytë (default 80)
  lot_conf_t3: number;  // pragu i tretë (default 90)
  /** Rreziku per-trade si % e kapitalit (fixed-fractional). Default 1%. */
  risk_per_trade_pct: number;
  /** Strategjia afat-gjatë (swing): sinjalet 15m/1h/4h nga motori. Default ON. */
  strategy_swing: boolean;
  /** Strategjia afat-shkurt (scalp): momentum live 1m/5m, SL/TP të ngushtë. Default OFF. */
  strategy_scalp: boolean;
  /** Distanca e SL-së për scalp, në çmim (sa $ lëviz ari). Default 2$. */
  scalp_sl_usd: number;
  /** Distanca e TP-së për scalp, në çmim (sa $ lëviz ari). Default 4$. */
  scalp_tp_usd: number;
  /** SL i scalp-it për CRYPTO si % e çmimit (BTC/ETH s'punojnë me $ fiks). Default 0.3%. */
  scalp_sl_pct: number;
  /** TP i scalp-it për CRYPTO si % e çmimit. Default 0.6%. */
  scalp_tp_pct: number;
  /** SL i scalp-it për NAFTË (USOIL/UKOIL) si % e çmimit. Default 0.4%. */
  scalp_sl_pct_oil: number;
  /** TP i scalp-it për NAFTË si % e çmimit. Default 0.8%. */
  scalp_tp_pct_oil: number;
  /** Sa pozicione scalp njëkohësisht maksimumi. Default 2. */
  scalp_max_trades: number;
  /** Scalp hyn edhe në lëvizje të vogla (kushte më të lehta, më shumë trade). Default OFF. */
  scalp_small_moves: boolean;
  /** SL/TP automatik nga analiza e tregut (ATR + balanca) — fushat manuale fiken. Default OFF. */
  auto_sltp: boolean;
  /** Trailing i SL (ndjekja e fitimit) — ndez/fik. Default ON. */
  trail_enabled: boolean;
  /** % e fitimit që mbahet nga SL (50 = gjysma, 33 = një e treta, 25 = një e katërta). Default 50. */
  trail_lock_pct: number;
  /** Profit minimal ($) para se të fillojë trailing-u. Default 1. */
  trail_start_usd: number;
  /** Trailing në anë të MT5/MetaApi (tick-by-tick, server-side). Default OFF. */
  broker_trailing: boolean;
  /** Filtrat e avancuar (Tier-1: Efficiency Ratio + Supertrend + Funding). Default OFF =
   *  logjika e thjeshtë e provuar. ON = shton filtrat Tier-1 për simbolet e tua. */
  advanced_filters: boolean;
}

export const DEFAULT_CONFIG: MetaApiConfig = {
  account_id: '', token: '', region: 'new-york', config_link: '', mode: 'demo', auto_trade: false,
  default_lot: 0.01, max_lot: 0.1, max_daily_loss: 100, max_open_trades: 3, kill_switch: false,
  min_confidence: 70, auto_symbols: 'XAUUSD',
  dynamic_lot: true, lot_conf_70: 0.01, lot_conf_80: 0.02, lot_conf_90: 0.05,
  lot_conf_t1: 70, lot_conf_t2: 80, lot_conf_t3: 90,
  risk_per_trade_pct: 1,
  strategy_swing: true, strategy_scalp: false,
  scalp_sl_usd: 2, scalp_tp_usd: 4, scalp_sl_pct: 0.3, scalp_tp_pct: 0.6, scalp_sl_pct_oil: 0.4, scalp_tp_pct_oil: 0.8, scalp_max_trades: 2, scalp_small_moves: false, auto_sltp: false,
  trail_enabled: true, trail_lock_pct: 50, trail_start_usd: 1, broker_trailing: false,
  advanced_filters: false,
};

export interface TradeExecution {
  id: string; symbol: string; action: string; volume: number;
  mode: string; status: string; reason: string | null; created_at: string;
}

/** Lexon konfigurimin e MetaApi. Riprovon te gabimet kalimtare (rrjet) dhe i NGRE ato —
 *  që thirrësi ta dallojë "dështim ngarkimi" nga "pa konfigurim" dhe të mos pulsojë te "i palidhur". */
export async function loadMetaApiConfig(userId: string): Promise<MetaApiConfig> {
  let lastErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.from('metaapi_config').select('*').eq('user_id', userId).maybeSingle();
    if (error) { lastErr = error; if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1))); continue; }
    if (!data) return { ...DEFAULT_CONFIG };
    return {
    account_id: data.account_id ?? '', token: data.token ?? '', region: data.region ?? 'new-york',
    config_link: data.config_link ?? '',
    mode: (data.mode as 'demo' | 'live') ?? 'demo', auto_trade: !!data.auto_trade,
    default_lot: Number(data.default_lot ?? 0.01), max_lot: Number(data.max_lot ?? 0.1),
    max_daily_loss: Number(data.max_daily_loss ?? 100), max_open_trades: Number(data.max_open_trades ?? 3),
    kill_switch: !!data.kill_switch,
    min_confidence: Number(data.min_confidence ?? 70), auto_symbols: data.auto_symbols ?? 'XAUUSD',
    dynamic_lot: data.dynamic_lot ?? true,
    lot_conf_70: Number(data.lot_conf_70 ?? 0.01),
    lot_conf_80: Number(data.lot_conf_80 ?? 0.02),
    lot_conf_90: Number(data.lot_conf_90 ?? 0.05),
    lot_conf_t1: Number(data.lot_conf_t1 ?? 70),
    lot_conf_t2: Number(data.lot_conf_t2 ?? 80),
    lot_conf_t3: Number(data.lot_conf_t3 ?? 90),
    risk_per_trade_pct: Number(data.risk_per_trade_pct ?? 1),
    strategy_swing: data.strategy_swing ?? true,
    strategy_scalp: !!data.strategy_scalp,
    scalp_sl_usd: Number(data.scalp_sl_usd ?? 2),
    scalp_tp_usd: Number(data.scalp_tp_usd ?? 4),
    scalp_sl_pct: Number(data.scalp_sl_pct ?? 0.3),
    scalp_tp_pct: Number(data.scalp_tp_pct ?? 0.6),
    scalp_sl_pct_oil: Number(data.scalp_sl_pct_oil ?? 0.4),
    scalp_tp_pct_oil: Number(data.scalp_tp_pct_oil ?? 0.8),
    scalp_max_trades: Number(data.scalp_max_trades ?? 2),
    scalp_small_moves: !!data.scalp_small_moves,
    auto_sltp: !!data.auto_sltp,
    trail_enabled: data.trail_enabled ?? true,
    trail_lock_pct: Number(data.trail_lock_pct ?? 50),
    trail_start_usd: Number(data.trail_start_usd ?? 1),
    broker_trailing: !!data.broker_trailing,
    advanced_filters: !!data.advanced_filters,
    };
  }
  throw new Error(lastErr?.message || 'metaapi_config_load_failed');
}

/** Ruan (upsert) konfigurimin e MetaApi. */
export async function saveMetaApiConfig(userId: string, cfg: MetaApiConfig): Promise<void> {
  const { error } = await supabase
    .from('metaapi_config')
    .upsert({ user_id: userId, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

/**
 * Ruajtje E PJESSHME: shkruan VETËM fushat e dhëna (jo gjithë konfigurimin).
 * Kritike për sigurinë: pengon që një gjendje e ngarkuar gabim (p.sh. sesion i skaduar →
 * vlera DEFAULT) t'i mbishkruajë fushat e tjera si `auto_trade` (që fikej "vetvetiu").
 */
export async function saveMetaApiConfigPartial(userId: string, patch: Partial<MetaApiConfig>): Promise<void> {
  const { error } = await supabase
    .from('metaapi_config')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

/** Pozicion i hapur nga MetaApi (fushat kryesore që na duhen). */
export interface OpenPosition {
  id: string;
  symbol: string;
  type: string; // POSITION_TYPE_BUY | POSITION_TYPE_SELL
  volume: number;
  openPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  swap?: number;
  /** Komenti/clientId — mban shenjën "SCALP" për trade-t afat-shkurta të robotit. */
  comment?: string;
  clientId?: string;
}

/** Porosi NË PRITJE (limit/stop) nga MT5 — pret çmimin për t'u hapur. */
export interface PendingOrder {
  id: string;
  symbol: string;
  type: string; // ORDER_TYPE_BUY_LIMIT | ORDER_TYPE_SELL_LIMIT | ORDER_TYPE_BUY_STOP | ORDER_TYPE_SELL_STOP
  volume?: number;
  openPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

/** Deal i mbyllur nga historiku i MT5. */
export interface HistoryDeal {
  id: string;
  positionId?: string;
  symbol?: string;
  type?: string;       // DEAL_TYPE_BUY | DEAL_TYPE_SELL
  entryType?: string;  // DEAL_ENTRY_IN | DEAL_ENTRY_OUT
  volume?: number;
  price?: number;
  profit?: number;
  commission?: number;
  swap?: number;
  time?: string;
}

/** Gjendja e llogarisë MT5 (nga account-information). */
export interface AccountInfo {
  balance?: number;
  equity?: number;
  profit?: number;
  margin?: number;
  freeMargin?: number;
  currency?: string;
  leverage?: number;
}

/** Qiri nga MT5 (historical-market-data). */
export interface Mt5Candle {
  time: string; open: number; high: number; low: number; close: number;
}

interface TradeResponse {
  success?: boolean; error?: string; message?: string; mode?: string;
  order_id?: string | null; account?: AccountInfo; positions?: OpenPosition[];
  deals?: HistoryDeal[]; candles?: Mt5Candle[]; orders?: PendingOrder[];
  price?: { symbol?: string; bid?: number; ask?: number; brokerTime?: string; time?: string };
  /** True nëse u vendos porosi NË PRITJE (limit/stop) sepse çmimi s'ishte ende te hyrja. */
  pending?: boolean;
  /** Çmimi i hapjes së porosisë në pritje (kur pending=true). */
  open_price?: number | null;
}

async function callTrade(body: Record<string, unknown>): Promise<TradeResponse> {
  const { data, error } = await supabase.functions.invoke('metaapi-trade', { body });
  if (error) {
    let detail = error.message;
    let code = 'invoke_error';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json();
        if (b?.error) code = b.error;
        if (b?.message) detail = b.message;
      }
    } catch { /* injoro */ }
    return { error: code, message: detail };
  }
  return data as TradeResponse;
}

/** Teston lidhjen me MetaApi (kthen info të llogarisë). */
export function checkMetaApiConnection() {
  return callTrade({ action: 'CHECK' });
}

/** Lexon pozicionet e hapura REALE nga MT5 (live). */
export function loadOpenPositions() {
  return callTrade({ action: 'POSITIONS' });
}

/** Mbyll një pozicion të hapur sipas id-së. */
export function closePosition(positionId: string) {
  return callTrade({ action: 'CLOSE', positionId });
}

/** Lexon porositë NË PRITJE (limit/stop) nga MT5. */
export function loadPendingOrders() {
  return callTrade({ action: 'ORDERS' });
}

/** Anulon një porosi në pritje sipas id-së. */
export function cancelOrder(orderId: string) {
  return callTrade({ action: 'CANCEL_ORDER', orderId });
}

/** Lexon historikun e trade-ve të mbyllura nga MT5 (parametri days, default 7). */
export function loadTradeHistory(days = 7) {
  return callTrade({ action: 'HISTORY', days });
}

/** Lexon qirinjtë historikë nga MT5 për një simbol + periudhë. */
export function loadCandles(symbol: string, timeframe: string, limit = 300) {
  return callTrade({ action: 'CANDLES', symbol, timeframe, limit });
}

/** Çmimi REAL live i brokerit (bid/ask) për një simbol — përkon me app-in MT5. */
export function loadSymbolPrice(symbol: string) {
  return callTrade({ action: 'PRICE', symbol });
}

/** Ndryshon SL/TP të një pozicioni të hapur (dërgon në MT5). */
export function modifyPosition(positionId: string, stopLoss?: number, takeProfit?: number) {
  return callTrade({ action: 'MODIFY', positionId, stopLoss, takeProfit });
}

/**
 * Ekzekuton një tregti në MT5 via MetaApi (me mbrojtjet e rrezikut në server).
 * `entryPrice` (opsionale): nëse jepet dhe çmimi s'është ende aty, vendoset POROSI NË PRITJE
 * te ai nivel (hyn automatik kur çmimi e arrin); përndryshe → porosi tregu menjëherë.
 */
export function executeTrade(input: {
  action: 'BUY' | 'SELL'; symbol: string; volume?: number;
  stopLoss?: number; takeProfit?: number; signalId?: string; entryPrice?: number;
}) {
  return callTrade({ ...input });
}

/** Lexon ekzekutimet e fundit për përdoruesin. */
export async function loadExecutions(userId: string, limit = 10): Promise<TradeExecution[]> {
  const { data } = await supabase
    .from('trade_executions')
    .select('id, symbol, action, volume, mode, status, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as TradeExecution[]) ?? [];
}
