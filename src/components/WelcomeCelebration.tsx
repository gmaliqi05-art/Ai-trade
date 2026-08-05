import { useEffect, useState } from 'react';
import { Wallet, ArrowRight, Crown } from 'lucide-react';
import { useI18n } from '../i18n/i18n';

/* MIRËSEARDHJA PAS PAGESËS
 *
 * Shfaqet një herë, menjëherë pasi webhook-u i Stripe-it e ka aktivizuar llogarinë — pra pas
 * pagesës SË VERIFIKUAR, jo pas klikimit të butonit. Deri atëherë përdoruesi nuk e sheh.
 *
 * Çfarë tregon: çmimi lëviz mbi grafik dhe prek TP1 → TP2 → TP3 → TP4 me radhë, dhe pas çdo
 * objektivi një dollar fluturon te kuleta. Kjo NUK është fitim i premtuar dhe as shifër e vërtetë:
 * është ilustrim i mënyrës si punon roboti — hyn te sinjali dhe del me shkallë. Prandaj poshtë rri
 * një rresht i vogël që e thotë hapur; një festë që lë të kuptohet fitim i sigurt do të ishte
 * gënjeshtër e bukur, dhe ato paguhen më vonë me besim të humbur.
 *
 * Animacioni është CSS + SVG i shkruar me dorë, si grafikët e tjerë të projektit — pa varësi të re. */

const TPS = [
  { k: 'TP1', x: 30.0, y: 62 },
  { k: 'TP2', x: 50.0, y: 47 },
  { k: 'TP3', x: 70.0, y: 32 },
  { k: 'TP4', x: 90.0, y: 17 },
];

export default function WelcomeCelebration({ name, plan, expiresAt, onDone }: {
  name?: string | null;
  plan?: string | null;
  expiresAt?: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  // Sa objektiva janë prekur deri tani (0…4). Rritet një nga një, që syri ta ndjekë.
  const [hit, setHit] = useState(0);

  useEffect(() => {
    const timers = TPS.map((_, i) => window.setTimeout(() => setHit(i + 1), 700 + i * 850));
    return () => timers.forEach(clearTimeout);
  }, []);

  const planLabel = plan === 'yearly' ? t('Vjetor') : plan === 'monthly' ? t('Mujor') : t('Aktiv');
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString('en-GB') : null;

  return (
    <div className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <style>{`
        @keyframes gsf-draw  { to   { stroke-dashoffset: 0; } }
        @keyframes gsf-pop   { 0% { transform: scale(0); opacity: 0 }
                               60%{ transform: scale(1.25); opacity: 1 }
                               100%{ transform: scale(1); opacity: 1 } }
        @keyframes gsf-coin  { 0%  { opacity: 0; transform: translate(0,0) scale(.6) }
                               15% { opacity: 1 }
                               100%{ opacity: 0; transform: var(--gsf-to) scale(.55) } }
        @keyframes gsf-shine { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .gsf-anim { animation: none !important; opacity: 1 !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>

      <div className="bg-gray-900 border border-amber-500/30 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-amber-500/10">
        {/* Kreu */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 mb-3">
            <Crown className="w-3.5 h-3.5" />{t('Pagesa u konfirmua')}
          </div>
          <h2 className="text-white font-bold text-lg sm:text-xl">
            {name ? t('Mirë se erdhe, {n}!', { n: name }) : t('Mirë se erdhe!')}
          </h2>
          <p className="text-gray-400 text-xs sm:text-sm mt-1.5">
            {t('Llogaria jote është aktivizuar automatikisht. Plani: {p}', { p: planLabel })}
            {until ? ` · ${t('vlen deri më {d}', { d: until })}` : ''}
          </p>
        </div>

        {/* GRAFIKU — çmimi ngjitet dhe prek TP1…TP4; pas çdo objektivi një dollar shkon te kuleta. */}
        <div className="px-3 sm:px-5">
          <div className="relative rounded-xl border border-white/10 bg-black/40 p-3">
            <svg viewBox="0 0 100 80" className="w-full" style={{ height: 190 }} aria-hidden="true">
              {TPS.map((tp, i) => (
                <g key={tp.k}>
                  <line x1="4" y1={tp.y} x2="96" y2={tp.y}
                    stroke={hit > i ? '#34d399' : '#374151'} strokeWidth="0.4" strokeDasharray="2 2" />
                  <text x="5" y={tp.y - 1.6} fontSize="3.6" fill={hit > i ? '#34d399' : '#6b7280'} fontWeight="700">
                    {tp.k}
                  </text>
                </g>
              ))}

              {/* Vija e çmimit — vizatohet duke u ngjitur nëpër objektiva. */}
              <path
                className="gsf-anim"
                d="M4,72 L16,68 L30,62 L40,58 L50,47 L60,44 L70,32 L80,27 L90,17 L96,14"
                fill="none" stroke="#fbbf24" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 200, strokeDashoffset: 200, animation: 'gsf-draw 3.6s ease-out forwards' }}
              />

              {/* Pikat e objektivave të prekura. */}
              {TPS.map((tp, i) => hit > i && (
                <circle key={tp.k} cx={tp.x} cy={tp.y} r="1.8" fill="#34d399"
                  className="gsf-anim" style={{ animation: 'gsf-pop .45s ease-out' }} />
              ))}
            </svg>

            {/* DOLLARËT — nisen nga çdo objektiv i prekur dhe bien te kuleta poshtë majtas. */}
            {TPS.map((tp, i) => hit > i && (
              <span key={tp.k} aria-hidden="true"
                className="gsf-anim absolute text-emerald-300 font-black text-sm select-none pointer-events-none"
                style={{
                  left: `${tp.x}%`, top: `${(tp.y / 80) * 100}%`,
                  ['--gsf-to' as string]: `translate(${(10 - tp.x) * 0.9}%, ${120 - tp.y}px)`,
                  animation: 'gsf-coin 1.5s ease-in forwards',
                }}>
                $
              </span>
            ))}

            {/* Kuleta */}
            <div className="absolute left-3 bottom-2 flex items-center gap-1.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                <Wallet className={`w-4.5 h-4.5 text-emerald-300 ${hit > 0 ? 'gsf-anim' : ''}`}
                  style={hit > 0 ? { animation: 'gsf-shine 1.2s ease-in-out infinite' } : undefined} />
              </div>
              <span className="text-[11px] text-emerald-300/80 font-semibold">
                {hit}/4 {t('objektiva')}
              </span>
            </div>
          </div>

          {/* Rreshti që e mban festën të ndershme. */}
          <p className="text-[10px] text-gray-500 leading-relaxed mt-2">
            {t('Ilustrim i mënyrës si punon roboti — hyn te sinjali dhe del me shkallë te TP1–TP4. Nuk është parashikim fitimi: tregtimi mbart rrezik dhe rezultatet ndryshojnë nga llogaria në llogari.')}
          </p>
        </div>

        {/* Veprimi */}
        <div className="p-4 sm:p-5">
          <button onClick={onDone}
            className="w-full inline-flex items-center justify-center gap-2 text-sm font-bold px-4 py-3 rounded-xl bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors">
            {t('Hyr në Dashboard')}<ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
