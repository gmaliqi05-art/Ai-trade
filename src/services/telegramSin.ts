import { supabase } from '../lib/supabase';

// Telegram Sin — shërbimi i frontend-it: lexon/shkruan cilësimet dhe raportet e sinjaleve.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
export const TELEGRAM_WEBHOOK_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1/telegram-signals`;

export type TpMode = 'multi' | 'first' | 'split';

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
  };
}

export async function saveTelegramSinConfigPartial(userId: string, patch: Partial<TelegramSinConfig>): Promise<void> {
  const { error } = await supabase
    .from('telegram_sin_config')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function loadTelegramSignals(userId: string, limit = 50): Promise<TelegramSignalRow[]> {
  const { data } = await supabase
    .from('telegram_signals')
    .select('id, raw_text, kind, symbol, direction, entry_type, entry_price, stop_loss, tps, status, error, tg_sender, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as TelegramSignalRow[];
}
