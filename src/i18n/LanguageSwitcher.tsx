// Butoni i ndërrimit të gjuhës (EN / SQ).
import { Languages } from 'lucide-react';
import { useI18n, type Lang } from './i18n';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const opts: { code: Lang; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'sq', label: 'SQ' },
  ];
  return (
    <div className={`flex items-center gap-1 ${compact ? '' : 'bg-gray-800/60 rounded-lg p-0.5'}`}>
      {!compact && <Languages className="w-3.5 h-3.5 text-gray-500 ml-1" />}
      {opts.map(o => (
        <button
          key={o.code}
          onClick={() => setLang(o.code)}
          className={`text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
            lang === o.code ? 'bg-amber-500 text-gray-950' : 'text-gray-400 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
