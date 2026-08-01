import { useState } from 'react';
import { Check, Loader2, Crown, Zap, Gift, CreditCard } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import {
  choosePlan, TRIAL_DAYS, PRICE_MONTHLY, PRICE_YEARLY, PRICE_YEARLY_FULL, YEARLY_SAVING,
  type PlanId, type SubState, daysLeft,
} from '../services/subscription';

// TABELA E PLANEVE — e përbashkët për ekranin pas regjistrimit dhe për Cilësimet → Abonimi.
// Provë falas 15 ditë · Mujor 69€ · Vjetor 699€ (në vend të 828€). Pagesa me Stripe.
export default function SubscriptionPlans({ sub, onDone, compact = false }: {
  sub?: SubState | null;          // gjendja aktuale (për shenjën "Aktiv" dhe fshehjen e provës
  onDone?: () => void;            // thirret pas nisjes së provës (rifreskim i profilit)
  compact?: boolean;              // pamje më e ngjeshur (te Cilësimet)
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const trialUsed = !!sub?.trialEndsAt;
  const activeTier = sub && ['trialing', 'active'].includes(sub.status) ? sub.tier : null;

  const pick = async (plan: PlanId) => {
    setBusy(plan); setMsg(null);
    const r = await choosePlan(plan);
    if (r.url) return;                                  // po ridrejtohet te Stripe
    if (r.trial) { setMsg({ type: 'success', text: t('Prova falas u aktivizua!') }); onDone?.(); }
    else if (r.error === 'trial_used') setMsg({ type: 'error', text: t('Prova falas është përdorur tashmë për këtë llogari.') });
    else if (r.error === 'stripe_not_configured') setMsg({ type: 'error', text: t('Pagesat nuk janë konfiguruar ende. Provo më vonë ose kontakto administratorin.') });
    else setMsg({ type: 'error', text: r.message || r.error || t('Diçka shkoi keq. Provo sërish.') });
    setBusy(null);
  };

  // Përfitimet — të njëjta për të tria planet (ndryshon vetëm kohëzgjatja/çmimi).
  const features = [
    t('Sinjalet GoldSniperFX në Telegram'),
    t('Roboti auto-trade i sinjaleve (MT5)'),
    t('Menaxhim automatik i SL/TP dhe breakeven'),
    t('Raportet, Journal-i dhe njoftimet push'),
  ];

  const Card = ({ id, title, icon, price, sub: subtitle, badge, highlight, cta, note }: {
    id: PlanId; title: string; icon: React.ReactNode; price: React.ReactNode; sub?: string;
    badge?: string; highlight?: boolean; cta: string; note?: string;
  }) => {
    const isActive = activeTier === id;
    return (
      <div className={`relative bg-gray-900 border-2 rounded-2xl p-5 flex flex-col ${
        isActive ? 'border-green-500' : highlight ? 'border-amber-500' : 'border-gray-700'}`}>
        {badge && !isActive && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-gray-950 text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap">{badge}</div>
        )}
        {isActive && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[11px] font-bold px-3 py-1 rounded-full">{t('Aktiv')}</div>
        )}
        <div className="flex items-center gap-2 mb-1">{icon}<h4 className="text-white font-bold text-lg">{title}</h4></div>
        <div className="mb-1">{price}</div>
        {subtitle && <p className="text-gray-400 text-xs mb-3">{subtitle}</p>}
        <ul className="space-y-1.5 my-3 flex-1">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2 text-gray-300 text-[13px]">
              <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />{f}
            </li>
          ))}
        </ul>
        {note && <p className="text-[11px] text-gray-500 mb-2">{note}</p>}
        <button onClick={() => pick(id)} disabled={busy !== null || isActive || (id === 'trial' && trialUsed)}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isActive ? 'bg-gray-700 text-gray-300'
            : highlight ? 'bg-amber-500 hover:bg-amber-400 text-gray-950'
            : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-600'}`}>
          {busy === id && <Loader2 className="w-4 h-4 animate-spin" />}
          {isActive ? t('Aktiv') : (id === 'trial' && trialUsed) ? t('E përdorur') : cta}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`text-sm rounded-xl px-3 py-2 ${msg.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>{msg.text}</div>
      )}

      <div className={`grid gap-4 ${compact ? 'md:grid-cols-3' : 'md:grid-cols-3'}`}>
        {/* PROVË FALAS — 15 ditë, pa kartë */}
        <Card
          id="trial"
          title={t('Provë falas')}
          icon={<Gift className="w-5 h-5 text-emerald-400" />}
          price={<div className="flex items-baseline gap-1"><span className="text-3xl font-bold text-white">0€</span><span className="text-gray-400 text-sm">/ {TRIAL_DAYS} {t('ditë')}</span></div>}
          sub={t('Pa kartë krediti — akses i plotë për {d} ditë.', { d: TRIAL_DAYS })}
          cta={t('Nis provën falas')}
        />

        {/* MUJOR */}
        <Card
          id="monthly"
          title={t('Mujor')}
          icon={<Zap className="w-5 h-5 text-amber-400" />}
          price={<div className="flex items-baseline gap-1"><span className="text-3xl font-bold text-white">{PRICE_MONTHLY}€</span><span className="text-gray-400 text-sm">/ {t('muaj')}</span></div>}
          sub={t('Faturohet çdo muaj — anulon kur të duash.')}
          cta={t('Abonohu')}
        />

        {/* VJETOR — me zbritje */}
        <Card
          id="yearly"
          title={t('Vjetor')}
          icon={<Crown className="w-5 h-5 text-amber-400" />}
          highlight
          badge={t('Kurse {s}€', { s: YEARLY_SAVING })}
          price={
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-bold text-white">{PRICE_YEARLY}€</span>
              <span className="text-gray-500 text-sm line-through">{PRICE_YEARLY_FULL}€</span>
              <span className="text-gray-400 text-sm">/ {t('vit')}</span>
            </div>
          }
          sub={t('Në vend të {full}€ (12 × {m}€) — kursen {s}€.', { full: PRICE_YEARLY_FULL, m: PRICE_MONTHLY, s: YEARLY_SAVING })}
          cta={t('Abonohu')}
        />
      </div>

      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
        <CreditCard className="w-3.5 h-3.5" />
        {t('Pagesat kryhen në mënyrë të sigurt me Stripe (kartë krediti/debiti). Anulimi është i mundur në çdo kohë.')}
      </p>

      {/* Gjendja aktuale — ditët e mbetura */}
      {sub && ['trialing', 'active'].includes(sub.status) && (sub.expiresAt || sub.trialEndsAt) && (
        <p className="text-xs text-gray-400">
          {sub.status === 'trialing' ? t('Prova falas') : t('Abonimi')}
          {' '}{t('skadon më')} <span className="text-white font-semibold">{new Date((sub.expiresAt || sub.trialEndsAt)!).toLocaleDateString('en-GB')}</span>
          {' · '}<span className="text-amber-400 font-semibold">{daysLeft(sub.expiresAt || sub.trialEndsAt)} {t('ditë të mbetura')}</span>
        </p>
      )}
    </div>
  );
}
