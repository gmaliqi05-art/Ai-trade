// Përzgjedhësi i gjuhës (EN / SQ) si menu që hapet me klik (hamburger/dropdown).
import { useState } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { useI18n, type Lang } from './i18n';

export default function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const opts: { code: Lang; label: string; name: string }[] = [
    { code: 'sq', label: 'SQ', name: 'Shqip' },
    { code: 'en', label: 'EN', name: 'English' },
  ];
  const current = opts.find(o => o.code === lang) ?? opts[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-800 rounded-lg px-2.5 py-1.5 transition-colors"
      >
        <Globe className="w-3.5 h-3.5 text-amber-400" />
        {current.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          {/* Sfond i tejdukshëm — mbyll menunë kur kliko jashtë. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-50 w-32 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
            {opts.map(o => (
              <button
                key={o.code}
                onClick={() => { setLang(o.code); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors ${
                  lang === o.code ? 'bg-amber-500/15 text-amber-400' : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span>{o.name}</span>
                <span className="font-semibold">{o.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
