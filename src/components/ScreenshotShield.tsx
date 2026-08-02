import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';

// MBUROJA KUNDËR SCREENSHOT-EVE (kërkesa e pronarit): asnjë përdorues të mos marrë dot
// pamje ekrani me përmbajtjen e platformës — përveç llogarisë së përjashtuar më poshtë.
//
// Kufiri teknik (i pashmangshëm në web): butoni i screenshot-it është i sistemit operativ,
// jashtë shfletuesit — s'mund të NDALOHET. Prandaj mbrojtja punon si te aplikacionet bankare:
//  1) Kur dritarja humb fokusin (vegla e screenshot-it, kalimi diku tjetër) → përmbajtja
//     MBULOHET me ekran të errët + mesazhin e ndalimit → screenshot-i kap vetëm mesazhin.
//  2) PrintScreen → pastrohet clipboard-i dhe shfaqet mesazhi i ndalimit.
//  3) Ctrl+P / Ctrl+S bllokohen; printimi nxjerr faqe bosh (CSS @media print).
//  4) Klikimi i djathtë + selektimi i tekstit çaktivizohen (inputet mbeten normale).
// Screenshot-i me butona fizikë në telefon s'kapet dot nga asnjë web-teknologji.
const ALLOWED_EMAILS = ['marbaudoo@gmail.com'];

export default function ScreenshotShield() {
  const { user } = useAuth();
  const { t } = useI18n();
  // 'privacy' = fokusi jashtë dritares (mbulesë e përhershme sa zgjat) · 'warn' = tentativë e kapur (3s)
  const [mode, setMode] = useState<'none' | 'privacy' | 'warn'>('none');
  const warnTimer = useRef<number | null>(null);

  const exempt = !user || ALLOWED_EMAILS.includes((user.email || '').toLowerCase());

  useEffect(() => {
    if (exempt) return;

    const warn = () => {
      setMode('warn');
      if (warnTimer.current) window.clearTimeout(warnTimer.current);
      warnTimer.current = window.setTimeout(() => setMode((m) => (m === 'warn' ? 'none' : m)), 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        // Screenshot-i i tastit PrtScn shkon te clipboard-i — e zbrazim menjëherë.
        try { navigator.clipboard?.writeText(' '); } catch { /* pa leje clipboard-i */ }
        warn();
      }
      if ((e.ctrlKey || e.metaKey) && ['p', 's'].includes(e.key.toLowerCase())) { e.preventDefault(); warn(); }
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onBlur = () => {
      // Klikimi brenda grafikut (iframe i TradingView) e "humb" fokusin e dritares por
      // përdoruesi është ende në faqe — atë rast NUK e mbulojmë.
      window.setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') return;
        if (!document.hasFocus()) setMode((m) => (m === 'warn' ? m : 'privacy'));
      }, 60);
    };
    const onFocus = () => setMode((m) => (m === 'privacy' ? 'none' : m));
    const onVis = () => {
      if (document.visibilityState === 'hidden') setMode('privacy');
      else onFocus();
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    document.addEventListener('contextmenu', onCtx);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    document.documentElement.classList.add('noshot');
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      document.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      document.documentElement.classList.remove('noshot');
      if (warnTimer.current) window.clearTimeout(warnTimer.current);
    };
  }, [exempt]);

  if (exempt) return null;

  return (
    <>
      <style>{`
        .noshot, .noshot *:not(input):not(textarea) { -webkit-user-select: none; user-select: none; }
        .noshot input, .noshot textarea { -webkit-user-select: text; user-select: text; }
        .noshot img { -webkit-user-drag: none; }
        @media print { body { visibility: hidden !important; } }
      `}</style>
      {mode !== 'none' && (
        <div className="fixed inset-0 z-[99999] bg-gray-950 flex flex-col items-center justify-center gap-4 px-6 text-center select-none">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
            {mode === 'warn' ? <ShieldAlert className="w-8 h-8 text-amber-400" /> : <EyeOff className="w-8 h-8 text-amber-400" />}
          </div>
          <p className="text-white font-bold text-lg">
            {mode === 'warn' ? t('Screenshot-et janë të ndaluara në këtë platformë.') : t('Përmbajtja u fsheh për siguri.')}
          </p>
          <p className="text-gray-400 text-sm max-w-sm">
            {mode === 'warn'
              ? t('Përmbajtja e platformës është e mbrojtur dhe nuk lejohet të kopjohet apo fotografohet.')
              : t('Kthehu në këtë dritare për të vazhduar — përmbajtja mbulohet sa herë që dritarja humb fokusin.')}
          </p>
        </div>
      )}
    </>
  );
}
