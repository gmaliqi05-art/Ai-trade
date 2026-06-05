// Gjurmon "të lexuara" për njoftimet e përgjithshme (broadcast) PËR ÇDO përdorues, lokalisht.
// Arsyeja: njoftimet broadcast janë një rresht i përbashkët dhe RLS s'lejon update nga përdoruesi
// (politika: auth.uid() = user_id). Kështu ruajmë gjendjen "lexuar" për përdoruesin në localStorage.

const key = (uid: string) => `read_broadcasts_${uid}`;

export function getReadBroadcasts(uid: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(uid)) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markBroadcastRead(uid: string, ...ids: string[]): void {
  try {
    const s = getReadBroadcasts(uid);
    ids.forEach(id => s.add(id));
    localStorage.setItem(key(uid), JSON.stringify([...s]));
  } catch { /* injoro */ }
}

/** Njofton shiritin/header-in që numri i palexuar të rifreskohet menjëherë. */
export function notifyNotificationsChanged(): void {
  try { window.dispatchEvent(new Event('notifications-updated')); } catch { /* injoro */ }
}
