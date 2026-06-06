// Gjurmon "të lexuara" për njoftimet e përgjithshme (broadcast) PËR ÇDO përdorues.
// Broadcast-et janë një rresht i përbashkët dhe RLS s'lejon update të 'is_read' nga përdoruesi
// (politika: auth.uid() = user_id). Prandaj ruajmë gjendjen "lexuar" te tabela `notification_reads`
// (server-side, e qëndrueshme pas logout/clear/PWA) + cache lokal për përgjigje të menjëhershme.

import { supabase } from './supabase';

const key = (uid: string) => `read_broadcasts_${uid}`;

/** Cache lokal (i shpejtë, sinkron). Mund të jetë i paplotë para sinkronizimit me server. */
export function getReadBroadcasts(uid: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(uid)) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveLocal(uid: string, s: Set<string>): void {
  try { localStorage.setItem(key(uid), JSON.stringify([...s])); } catch { /* injoro */ }
}

/** Burimi i së vërtetës: lexon nga serveri (notification_reads), bashkon me cache-in lokal
 *  dhe e rifreskon localStorage-in. Përdore para se të shfaqësh gjendjen "lexuar". */
export async function loadReadBroadcasts(uid: string): Promise<Set<string>> {
  const s = getReadBroadcasts(uid); // fillo me cache-in (instant)
  try {
    const { data } = await supabase
      .from('notification_reads')
      .select('notification_id')
      .eq('user_id', uid);
    for (const r of (data as { notification_id: string }[] | null) || []) s.add(r.notification_id);
    saveLocal(uid, s); // ripopullon cache-in nga serveri (p.sh. pas logout/login)
  } catch { /* nëse serveri dështon, mbetet cache-i lokal */ }
  return s;
}

/** Shëno një ose disa broadcast si të lexuara — te serveri (i qëndrueshëm) + cache-i lokal. */
export async function markBroadcastRead(uid: string, ...ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const s = getReadBroadcasts(uid);
  ids.forEach(id => s.add(id));
  saveLocal(uid, s); // instant
  try {
    await supabase
      .from('notification_reads')
      .upsert(ids.map(id => ({ user_id: uid, notification_id: id })), { onConflict: 'user_id,notification_id' });
  } catch { /* mbetet të paktën te cache-i lokal */ }
}

/** Njofton shiritin/header-in që numri i palexuar të rifreskohet menjëherë. */
export function notifyNotificationsChanged(): void {
  try { window.dispatchEvent(new Event('notifications-updated')); } catch { /* injoro */ }
}
