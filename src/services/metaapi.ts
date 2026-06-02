// Shërbim për integrimin MetaApi.cloud (Faza 5): konfigurim + ekzekutim tregtish.

import { supabase } from '../lib/supabase';

export interface MetaApiConfig {
  account_id: string;
  token: string;
  region: string;
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
}

export const DEFAULT_CONFIG: MetaApiConfig = {
  account_id: '', token: '', region: 'new-york', mode: 'demo', auto_trade: false,
  default_lot: 0.01, max_lot: 0.1, max_daily_loss: 100, max_open_trades: 3, kill_switch: false,
  min_confidence: 70, auto_symbols: 'XAUUSD',
};

export interface TradeExecution {
  id: string; symbol: string; action: string; volume: number;
  mode: string; status: string; reason: string | null; created_at: string;
}

/** Lexon konfigurimin e MetaApi për përdoruesin aktual (ose default nëse s'ka). */
export async function loadMetaApiConfig(userId: string): Promise<MetaApiConfig> {
  const { data } = await supabase.from('metaapi_config').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return { ...DEFAULT_CONFIG };
  return {
    account_id: data.account_id ?? '', token: data.token ?? '', region: data.region ?? 'new-york',
    mode: (data.mode as 'demo' | 'live') ?? 'demo', auto_trade: !!data.auto_trade,
    default_lot: Number(data.default_lot ?? 0.01), max_lot: Number(data.max_lot ?? 0.1),
    max_daily_loss: Number(data.max_daily_loss ?? 100), max_open_trades: Number(data.max_open_trades ?? 3),
    kill_switch: !!data.kill_switch,
    min_confidence: Number(data.min_confidence ?? 70), auto_symbols: data.auto_symbols ?? 'XAUUSD',
  };
}

/** Ruan (upsert) konfigurimin e MetaApi. */
export async function saveMetaApiConfig(userId: string, cfg: MetaApiConfig): Promise<void> {
  const { error } = await supabase
    .from('metaapi_config')
    .upsert({ user_id: userId, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

interface TradeResponse {
  success?: boolean; error?: string; message?: string; mode?: string;
  order_id?: string | null; account?: unknown;
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

/** Ekzekuton një tregti në MT5 via MetaApi (me mbrojtjet e rrezikut në server). */
export function executeTrade(input: {
  action: 'BUY' | 'SELL'; symbol: string; volume?: number;
  stopLoss?: number; takeProfit?: number; signalId?: string;
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
