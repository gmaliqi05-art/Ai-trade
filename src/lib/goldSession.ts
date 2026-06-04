// Sesioni i tregtimit të arit — i ankoruar te Frankfurt (Europe/Berlin), 09:00–23:00,
// me korrigjim automatik të orës verore/dimërore (DST). E njëjta logjikë si te motori
// në server (engine-scan), që klienti dhe serveri të jenë gjithmonë në sinkron.

export const GOLD_TZ = 'Europe/Berlin';
export const GOLD_OPEN_H = 9;
export const GOLD_CLOSE_H = 23;

/** Ora aktuale në Frankfurt (0–23), me DST automatik. */
export function frankfurtHour(d: Date = new Date()): number {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: GOLD_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d);
  return parseInt(s, 10) || 0;
}

/** A është brenda sesionit aktiv të arit (09:00–23:00 Frankfurt)? */
export function isGoldSessionActive(d: Date = new Date()): boolean {
  const h = frankfurtHour(d);
  return h >= GOLD_OPEN_H && h < GOLD_CLOSE_H;
}

/** Ofset-i i një zone kohore nga UTC (minuta) për një moment të dhënë. */
function tzOffsetMinutes(tz: string, d: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUTC - d.getTime()) / 60000);
}

const fmtMin = (m: number) => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};

/** Dritarja e sesionit (09:00–23:00 Frankfurt) e shprehur në kohën LOKALE të pajisjes. */
export function goldWindowLocal(d: Date = new Date()): { open: string; close: string; sameAsFrankfurt: boolean } {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || GOLD_TZ;
  const diffMin = tzOffsetMinutes(GOLD_TZ, d) - tzOffsetMinutes(localTz, d); // Frankfurt − lokal
  return {
    open: fmtMin(GOLD_OPEN_H * 60 - diffMin),
    close: fmtMin(GOLD_CLOSE_H * 60 - diffMin),
    sameAsFrankfurt: diffMin === 0,
  };
}
