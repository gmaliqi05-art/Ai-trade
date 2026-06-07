// Service worker minimal për PWA. Strategji DEPLOY-SAFE:
// - network-first për gjithçka same-origin (navigime + asete) → përdoruesi merr GJITHMONË
//   versionin e fundit pas çdo publish; cache-i është vetëm fallback offline.
// - thirrjet API (Supabase/MetaApi, cross-origin) nuk preken kurrë.
// Versioni i cache-it ndryshohet me çdo ndryshim → 'activate' pastron cache-in e vjetër,
// që të mos ngecë kurrë me kod të vjetër (shkak i logout/NOT CONNECTED/ngrirje pas publish).
const CACHE = 'ai-trade-v3';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Lejo aplikacionin të aplikojë menjëherë një SW të ri (përditësim pa ngecje).
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Mos ndërhy te thirrjet API (Supabase, MetaApi) — gjithmonë rrjet direkt.
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST për gjithçka same-origin: merr nga rrjeti (gjithmonë i fundit),
  // ruaj kopje në cache, dhe bie te cache-i VETËM kur s'ka rrjet (offline).
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
