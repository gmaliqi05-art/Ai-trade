import { supabase } from '../lib/supabase';

// Telegram Sin — shërbimi i frontend-it: lexon/shkruan cilësimet dhe raportet e sinjaleve.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
export const TELEGRAM_WEBHOOK_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1/telegram-signals`;

export type TpMode = 'multi' | 'first' | 'split' | 'last';

export interface TelegramSinConfig {
  active: boolean;
  lot: number;
  tp_mode: TpMode;
  fallback_sl_usd: number;
  move_be_after_tp1: boolean;
  symbol_default: string;
  max_open: number;
  bot_token: string;
  webhook_secret: string;
  allowed_chat_ids: string[];
  allowed_senders: string[];
  /** Kanalet e ÇAKTIVIZUARA (tg_chat_id) — sinjalet e tyre injorohen. */
  disabled_chats: string[];
}

export const DEFAULT_TG_CONFIG: TelegramSinConfig = {
  active: false,
  lot: 0.01,
  tp_mode: 'multi',
  fallback_sl_usd: 30,
  move_be_after_tp1: true,
  symbol_default: 'XAUUSD',
  max_open: 12,
  bot_token: '',
  webhook_secret: '',
  allowed_chat_ids: [],
  allowed_senders: [],
  disabled_chats: [],
};

export interface TelegramSignalRow {
  id: string;
  raw_text: string | null;
  kind: string | null;
  symbol: string | null;
  direction: string | null;
  entry_type: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  tps: number[];
  status: string;
  tp_hit?: number;
  tg_chat_id?: string | null;
  error: string | null;
  tg_sender: string | null;
  created_at: string;
}

/** Sekret i rastësishëm për URL-në e webhook-ut (identifikon + autentikon përdoruesin). */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function webhookUrlFor(secret: string): string {
  return `${TELEGRAM_WEBHOOK_BASE}?key=${encodeURIComponent(secret)}`;
}

/** URL-ja e setWebhook të Telegram — hapet në tab të ri për ta lidhur botin (GET, pa CORS). */
export function setWebhookUrl(botToken: string, secret: string): string {
  const hook = webhookUrlFor(secret);
  const allowed = encodeURIComponent(JSON.stringify(['message', 'channel_post', 'edited_message']));
  return `https://api.telegram.org/bot${botToken.trim()}/setWebhook?url=${encodeURIComponent(hook)}&secret_token=${encodeURIComponent(secret)}&allowed_updates=${allowed}`;
}

export async function loadTelegramSinConfig(userId: string): Promise<TelegramSinConfig> {
  const { data } = await supabase.from('telegram_sin_config').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return { ...DEFAULT_TG_CONFIG };
  return {
    active: !!data.active,
    lot: Number(data.lot ?? 0.01),
    tp_mode: (data.tp_mode as TpMode) ?? 'multi',
    fallback_sl_usd: Number(data.fallback_sl_usd ?? 30),
    move_be_after_tp1: data.move_be_after_tp1 ?? true,
    symbol_default: data.symbol_default ?? 'XAUUSD',
    max_open: Number(data.max_open ?? 12),
    bot_token: data.bot_token ?? '',
    webhook_secret: data.webhook_secret ?? '',
    allowed_chat_ids: data.allowed_chat_ids ?? [],
    allowed_senders: data.allowed_senders ?? [],
    disabled_chats: data.disabled_chats ?? [],
  };
}

export async function saveTelegramSinConfigPartial(userId: string, patch: Partial<TelegramSinConfig>): Promise<void> {
  const { error } = await supabase
    .from('telegram_sin_config')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

// ---- Kontrolli i robotëve të tjerë (MMT + Sinjalet) nga faqja e Telegram Sin ----
export interface OthersState {
  signalsOn: boolean;      // roboti i Sinjaleve (auto-trade-runner) — për këtë përdorues
  mmtOn: boolean;          // MMT (global)
  mmtControllable: boolean; // a është ky përdorues pronari i llogarisë MMT (live_user_id)
  othersOn: boolean;       // të paktën njëri prej tyre është aktiv
}

export async function loadOthersState(userId: string): Promise<OthersState> {
  const { data: mc } = await supabase.from('metaapi_config').select('kill_switch').eq('user_id', userId).maybeSingle();
  const signalsOn = !(mc?.kill_switch);
  const { data: mmt } = await supabase.from('mmt_config').select('active, live_user_id').eq('id', 1).maybeSingle();
  const mmtControllable = !!mmt && String(mmt.live_user_id) === String(userId);
  const mmtOn = mmtControllable ? !!mmt?.active : false;
  return { signalsOn, mmtOn, mmtControllable, othersOn: signalsOn || mmtOn };
}

/** Ndal (on=false) ose nis (on=true) robotët e tjerë. MMT preket VETËM nga pronari i live_user_id. */
export async function setOthersEnabled(userId: string, on: boolean): Promise<void> {
  const { error: e1 } = await supabase.from('metaapi_config')
    .update({ kill_switch: !on, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (e1) throw new Error(e1.message);
  const { data: mmt } = await supabase.from('mmt_config').select('live_user_id').eq('id', 1).maybeSingle();
  if (mmt && String(mmt.live_user_id) === String(userId)) {
    await supabase.from('mmt_config').update({ active: on }).eq('id', 1);
  }
}

/** ADMIN: gjendja e robotëve të tjerë për llogarinë PRONARE (pa ekspozuar token-at e MetaApi). */
export async function loadOthersStateAdmin(targetId: string): Promise<OthersState> {
  const { data, error } = await supabase.rpc('admin_others_state', { target: targetId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { signalsOn?: boolean; mmtOn?: boolean; mmtControllable?: boolean };
  const signalsOn = d.signalsOn !== false;
  const mmtOn = !!d.mmtOn && !!d.mmtControllable;
  return { signalsOn, mmtOn, mmtControllable: !!d.mmtControllable, othersOn: signalsOn || mmtOn };
}

/** ADMIN: ndal/nis robotët e tjerë për llogarinë PRONARE. */
export async function setOthersEnabledAdmin(targetId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_others', { target: targetId, turn_on: on });
  if (error) throw new Error(error.message);
}

export async function loadTelegramSignals(userId: string, limit = 50): Promise<TelegramSignalRow[]> {
  const { data } = await supabase
    .from('telegram_signals')
    .select('id, raw_text, kind, symbol, direction, entry_type, entry_price, stop_loss, tps, status, tp_hit, error, tg_sender, tg_chat_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as TelegramSignalRow[];
}

/** Vetëm SINJALET E HYRJES (kind='entry') — dritare më e gjerë (150), që mesazhet e shumta
 *  të feed-it të MOS i shtyjnë sinjalet jashtë tabelave të Trade Live (bug: tabela dilte bosh). */
export async function loadTelegramEntrySignals(userId: string, limit = 150): Promise<TelegramSignalRow[]> {
  const { data } = await supabase
    .from('telegram_signals')
    .select('id, raw_text, kind, symbol, direction, entry_type, entry_price, stop_loss, tps, status, tp_hit, error, tg_sender, tg_chat_id, created_at')
    .eq('user_id', userId)
    .eq('kind', 'entry')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as TelegramSignalRow[];
}

/** Pozicionet e hapura/pending të Telegram Sin (për numërimin "aktive" për kanal). */
export interface TgTradeRow { id: string; signal_id: string | null; status: string; tp_index: number | null; symbol: string | null; action: string | null; }
export async function loadOpenTgTrades(userId: string): Promise<TgTradeRow[]> {
  const { data } = await supabase.from('telegram_trades')
    .select('id, signal_id, status, tp_index, symbol, action')
    .eq('user_id', userId).in('status', ['open', 'pending']);
  return (data ?? []) as TgTradeRow[];
}

/** Të gjitha legs e Telegram Sin (edhe të mbyllurat, ditët e fundit) — për pips + P&L në raporte. */
export interface TgLegRow { signal_id: string | null; status: string; action: string | null; entry_price: number | null; exit_price: number | null; net: number | null; closed_at?: string | null; }
export async function loadTgLegs(userId: string, days = 8): Promise<TgLegRow[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase.from('telegram_trades')
    .select('signal_id, status, action, entry_price, exit_price, net, closed_at')
    .eq('user_id', userId).gte('created_at', since).limit(1000);
  return (data ?? []) as TgLegRow[];
}

/** Përmbledhje për sinjal nga legs: fitimi total ($) + pips REALË (ari: 1 pip = $0.10 lëvizje). */
export function sigPnl(legs: TgLegRow[]): { net: number | null; pips: number | null } {
  const closed = legs.filter((l) => l.net != null || (l.exit_price != null && l.entry_price != null));
  if (closed.length === 0) return { net: null, pips: null };
  const nets = closed.filter((l) => l.net != null);
  const net = nets.length ? Math.round(nets.reduce((s, l) => s + Number(l.net), 0) * 100) / 100 : null;
  const withPx = closed.find((l) => l.exit_price != null && l.entry_price != null);
  const pips = withPx
    ? Math.round((Number(withPx.exit_price) - Number(withPx.entry_price)) * (String(withPx.action).toUpperCase() === 'BUY' ? 1 : -1) * 10 * 10) / 10
    : null;
  return { net, pips };
}

/** Parametrat PËR KANAL — çdo grup ka lot/TP/SL/max/shkallët e veta. */
export interface TgChannelRow { chat_id: string; name: string | null; enabled: boolean; lot: number; tp_mode: TpMode; fallback_sl_usd: number; move_be_after_tp1: boolean; max_open: number; }
export async function loadTgChannels(userId: string): Promise<TgChannelRow[]> {
  const { data } = await supabase.from('telegram_sin_channels').select('*').eq('user_id', userId);
  return (data ?? []) as TgChannelRow[];
}
export async function upsertTgChannel(userId: string, chatId: string, patch: Partial<TgChannelRow>): Promise<void> {
  const { error } = await supabase.from('telegram_sin_channels')
    .upsert({ user_id: userId, chat_id: chatId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,chat_id' });
  if (error) throw new Error(error.message);
}
