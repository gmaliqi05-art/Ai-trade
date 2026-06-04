// Badge i sesionit të arit. Logjika është e ankoruar te Frankfurt (Europe/Berlin,
// 09:00–23:00, me DST automatik) — njësoj si motori. Por dritarja SHFAQET në kohën
// LOKALE të pajisjes, kështu që është automatike për gjithë botën: një përdorues në
// Gjermani sheh 09:00–23:00, një në New York sheh 03:00–17:00, etj.

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

const TZ = 'Europe/Berlin';
const OPEN_H = 9;
const CLOSE_H = 23;

// Ofset-i i një zone kohore nga UTC (në minuta) për një moment të dhënë.
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

function frankfurtHour(d: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d);
  return parseInt(s, 10) || 0;
}

const fmtMin = (m: number) => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};

export default function GoldSessionBadge() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const fh = frankfurtHour(now);
  const active = fh >= OPEN_H && fh < CLOSE_H;

  // Konverto dritaren e Frankfurt-it në kohën lokale të pajisjes.
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || TZ;
  const diffMin = tzOffsetMinutes(TZ, now) - tzOffsetMinutes(localTz, now); // Frankfurt − lokal
  const localOpen = fmtMin(OPEN_H * 60 - diffMin);
  const localClose = fmtMin(CLOSE_H * 60 - diffMin);
  const sameAsFrankfurt = diffMin === 0;

  return (
    <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 border ${active ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-800/40 border-gray-700/50'}`}>
      <span className={`relative flex h-2.5 w-2.5`}>
        {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? 'bg-green-400' : 'bg-gray-500'}`} />
      </span>
      <Clock className={`w-4 h-4 ${active ? 'text-green-400' : 'text-gray-500'}`} />
      <div className="leading-tight">
        <div className="text-xs font-semibold text-white">
          Sesioni i arit: <span className={active ? 'text-green-400' : 'text-gray-400'}>{active ? 'AKTIV' : 'I MBYLLUR'}</span>
        </div>
        <div className="text-[10px] text-gray-500">
          {localOpen}–{localClose} {sameAsFrankfurt ? '(Frankfurt)' : '(koha jote)'}
          {!active && ` · hapet ${localOpen}`}
        </div>
      </div>
    </div>
  );
}
