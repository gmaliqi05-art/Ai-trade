// I18n i lehtë pa varësi — anglishtja default, shqipja opsionale.
// Çelësat janë tekstet ORIGJINALE shqip; `en` jep përkthimet angleze.
// Nëse mungon një përkthim, bie te çelësi (shqip) — asgjë s'thyhet.
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { en } from './en';

export type Lang = 'en' | 'sq';

// Gjuha aktive në nivel moduli — që formatuesit jashtë komponentëve (data/ora) ta dinë gjuhën.
let _activeLang: Lang = (() => {
  try { return localStorage.getItem('lang') === 'sq' ? 'sq' : 'en'; } catch { return 'en'; }
})();
// Locale për data/ora sipas gjuhës aktive: en-US (default) ose sq-AL.
export function dtLocale(): string { return _activeLang === 'sq' ? 'sq-AL' : 'en-US'; }

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LangContext = createContext<I18nCtx | null>(null);

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('lang');
      if (saved === 'sq' || saved === 'en') return saved;
    } catch { /* injoro */ }
    return 'en'; // default: anglisht
  });

  const setLang = useCallback((l: Lang) => {
    _activeLang = l;
    try { localStorage.setItem('lang', l); } catch { /* injoro */ }
    setLangState(l);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const str = lang === 'en' ? (en[key] ?? key) : key;
    return interpolate(str, params);
  }, [lang]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useI18n must be used within LanguageProvider');
  return ctx;
}
