// Web Push (web + PWA): abonim i shfletuesit + ruajtje te push_tokens, që përdoruesi të marrë
// njoftime edhe kur app-i është i mbyllur (roboti hap/mbyll trade, sinjale të reja).
// Çelësi publik VAPID — jo sekret (i palidhur me privatin që rri vetëm te serveri).

import { supabase } from '../lib/supabase';

export const VAPID_PUBLIC_KEY =
  'BNI4ADV2fLYvVeuThu0yCGMNcAj6NEmp1CLAMjiDRKcOSFOS6ooyItBGboYWRklVSRFbZAC18yj0eKGZ7UFxOF4';

/** A i mbështet shfletuesi njoftimet push (service worker + PushManager + Notification)? */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** A jemi në PWA të instaluar (standalone) — për iOS push duhet "Add to Home Screen". */
export function isStandalone(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function ready(): Promise<ServiceWorkerRegistration> {
  // SW-ja regjistrohet te index.html; presim derisa të jetë gati.
  await navigator.serviceWorker.register('/sw.js').catch(() => {});
  return navigator.serviceWorker.ready;
}

/** Gjendja aktuale: a mbështetet, leja, dhe a është abonuar kjo pajisje. */
export async function getPushState(): Promise<{ supported: boolean; permission: NotificationPermission; subscribed: boolean }> {
  if (!isPushSupported()) return { supported: false, permission: 'denied', subscribed: false };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    subscribed = !!sub;
  } catch { /* */ }
  return { supported: true, permission: Notification.permission, subscribed };
}

/** Kërkon lejen, abonon këtë pajisje dhe e ruan abonimin te push_tokens. */
export async function subscribePush(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: false, error: 'unsupported' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, error: 'denied' };

    const reg = await ready();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const endpoint = json.endpoint || sub.endpoint;
    const p256dh = json.keys?.p256dh || bufToB64Url(sub.getKey('p256dh'));
    const auth = json.keys?.auth || bufToB64Url(sub.getKey('auth'));

    const { error } = await supabase.from('push_tokens').upsert({
      user_id: userId,
      token: endpoint,
      p256dh,
      auth,
      platform: isStandalone() ? 'pwa' : 'web',
      is_active: true,
      device_info: { ua: navigator.userAgent.slice(0, 200) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,token' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Çabonon këtë pajisje dhe e çaktivizon te push_tokens. */
export async function unsubscribePush(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe().catch(() => {});
    if (endpoint) {
      await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', endpoint);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Dërgon një njoftim PROVE te kjo llogari (përmes funksionit web-push-send me JWT-në e përdoruesit). */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('web-push-send', {
    body: { self: true, title: 'ProTrade — test', body: 'Njoftimet push janë aktive ✅', url: '/' },
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { sent?: number; error?: string };
  if (r?.error) return { ok: false, error: r.error };
  return { ok: true };
}
