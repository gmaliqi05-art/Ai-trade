// Përkthyes pa-hook (për module jo-React: motori, format, etj.).
// Lexon gjuhën nga localStorage (e njëjta që vendos LanguageProvider) dhe përdor të njëjtin fjalor `en`.
import { en } from './en';

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

export function tr(key: string, params?: Record<string, string | number>): string {
  let lang = 'en';
  try {
    const s = localStorage.getItem('lang');
    if (s === 'sq' || s === 'en') lang = s;
  } catch { /* injoro */ }
  const str = lang === 'en' ? (en[key] ?? key) : key;
  return interpolate(str, params);
}
