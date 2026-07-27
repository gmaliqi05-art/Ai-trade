import { supabase } from '../lib/supabase';

// GoldSniper|FX — publikimi i sinjaleve te kanali i VETË përdoruesit (bot Telegram).
// bot_token ruhet me RLS (vetëm pronari) dhe postimi bëhet nga edge function 'gold-sniper-post'.

const PROJECT_REF = 'zwyuscgqacfpjafznybg';
const POST_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/gold-sniper-post`;

/** Të dhëna për të para-mbushur formularin e GoldSniper nga një sinjal i klikuar. */
export interface GoldSniperPrefill {
  direction: 'buy' | 'sell';
  symbol?: string | null;
  entry?: number | null;
  sl?: number | null;
  tps?: number[];
}

export interface GoldSniperConfig {
  bot_token: string;
  channel_id: string;
  channel_name: string;
  active: boolean;
  header: string;
  footer: string;
}
export const DEFAULT_GS_CONFIG: GoldSniperConfig = {
  bot_token: '', channel_id: '', channel_name: 'GoldSniper|FX', active: false,
  header: '🎯 SINJAL I RI — GoldSniper|FX', footer: '',
};

export async function loadGoldSniperConfig(userId: string): Promise<GoldSniperConfig> {
  const { data } = await supabase.from('gold_sniper_config').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return { ...DEFAULT_GS_CONFIG };
  return {
    bot_token: data.bot_token ?? '', channel_id: data.channel_id ?? '',
    channel_name: data.channel_name ?? 'GoldSniper|FX', active: !!data.active,
    header: data.header ?? DEFAULT_GS_CONFIG.header, footer: data.footer ?? '',
  };
}

export async function saveGoldSniperConfig(userId: string, patch: Partial<GoldSniperConfig>): Promise<void> {
  const { error } = await supabase.from('gold_sniper_config')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export interface GoldSniperPost {
  id: string; symbol: string | null; direction: string | null;
  entry: number | null; stop_loss: number | null; tps: number[] | null;
  note: string | null; message: string | null; status: string; error: string | null; created_at: string;
}
export async function loadGoldSniperPosts(userId: string, limit = 30): Promise<GoldSniperPost[]> {
  const { data } = await supabase.from('gold_sniper_posts')
    .select('id, symbol, direction, entry, stop_loss, tps, note, message, status, error, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as GoldSniperPost[];
}

async function callPost(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(POST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify(payload),
  });
  const j = await resp.json().catch(() => ({ ok: false }));
  return { ok: !!j.ok, message: j.message };
}

/** Poston një mesazh prove te kanali (verifikon botin + kanalin). */
export function testGoldSniper(): Promise<{ ok: boolean; message?: string }> {
  return callPost({ action: 'test' });
}

/** Poston një sinjal të formatuar (ose tekst custom) te kanali. */
export function postGoldSniperSignal(input: {
  symbol?: string; direction?: 'buy' | 'sell'; entry?: number; stop_loss?: number;
  tps?: number[]; note?: string; message?: string;
}): Promise<{ ok: boolean; message?: string }> {
  return callPost({ action: 'post', ...input });
}
