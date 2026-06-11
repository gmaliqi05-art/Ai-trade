// Manuali i përdorimit (klient) — udhëzues vetëm-lexim. Fokus: lidhje e QËNDRUESHME MT5↔MetaApi
// (si të shmangësh shkëputjet), plus bazat e robotit. I integruar te menyja "Llogaria".
import { BookOpen, ShieldCheck, KeyRound, Wifi, AlertTriangle, CheckCircle2, Rocket, Monitor } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import type { ClientPage } from '../App';

function Chip({ tone, children }: { tone: 'grn' | 'red' | 'gray' | 'amb'; children: React.ReactNode }) {
  const m = {
    grn: 'bg-green-500/15 text-green-400 border-green-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
    gray: 'bg-gray-600/20 text-gray-300 border-gray-600/40',
    amb: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  }[tone];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m}`}>{children}</span>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-gray-950 font-black flex items-center justify-center flex-shrink-0">{n}</div>
        <h3 className="text-white font-semibold text-sm">{title}</h3>
      </div>
      <div className="text-gray-300 text-[13px] leading-relaxed space-y-2 pl-11">{children}</div>
    </div>
  );
}

function Callout({ tone, icon: Icon, children }: { tone: 'amb' | 'red' | 'grn'; icon: React.ElementType; children: React.ReactNode }) {
  const m = {
    amb: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    red: 'bg-red-500/10 border-red-500/30 text-red-300',
    grn: 'bg-green-500/10 border-green-500/30 text-green-300',
  }[tone];
  return (
    <div className={`flex items-start gap-2 text-[13px] rounded-xl border p-3 ${m}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default function ClientManualPage({ onNavigate }: { onNavigate?: (p: ClientPage) => void }) {
  const { t } = useI18n();
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{t('Manuali i përdorimit')}</h2>
          <p className="text-gray-400 text-sm">{t('Si ta mbash lidhjen MT5 të qëndrueshme dhe robotin aktiv.')}</p>
        </div>
      </div>

      {/* ============ SEKSIONI 1: Lidhje e qëndrueshme ============ */}
      <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 to-gray-900 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Wifi className="w-5 h-5 text-amber-400" />
          <h3 className="text-white font-bold">{t('Lidhje e qëndrueshme me MT5 (MetaApi)')}</h3>
        </div>
        <p className="text-gray-300 text-[13px] leading-relaxed">
          {t('Roboti lidhet me llogarinë tënde MT5 përmes MetaApi. Nëse lidhja shkëputet, aplikacioni nuk i sheh dot pozicionet dhe roboti ndalon së tregtuari. Ndiq këto hapa që lidhja të mbetet e qëndrueshme.')}
        </p>
      </div>

      <Callout tone="red" icon={AlertTriangle}>
        <div><b>{t('Nëse sheh "rejected too many times" / "Could not reach MetaApi":')}</b></div>
        <div>{t('MetaApi e bllokon validimin për ~1 orë pas shumë përpjekjeve të dështuara. MOS kliko Deploy/Retry vazhdimisht — çdo përpjekje e rinis orën. Prit 1 orë, pastaj ndiq hapat. Trade-i yt mbetet i mbrojtur me SL/TP te broker-i.')}</div>
      </Callout>

      <Step n={1} title={t('Hyr te paneli i MetaApi')}>
        <p>{t('Hap shfletuesin → shko te')} <b>app.metaapi.cloud</b> {t('dhe logohu. Hap')} <b>MT5 Accounts</b>.</p>
        <div className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg p-2.5">
          <span className="text-gray-300 text-xs">{t('Llogaria jote MT5')}</span>
          <Chip tone="red">DISCONNECTED</Chip>
        </div>
      </Step>

      <Step n={2} title={t('Kontrollo gjendjen & bëj një Deploy (vetëm një herë)')}>
        <ul className="list-disc pl-4 space-y-1">
          <li>{t('Kliko llogarinë → menyja')} <b>⋮</b></li>
          <li>{t('Nëse është')} <b>Undeployed</b> → <b>Deploy</b></li>
          <li>{t('Nëse është Deployed por e kuqe')} → <b>Redeploy</b> ({t('një herë')})</li>
        </ul>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Deploy-i zgjat 2–5 minuta. Mos e rifresko apo riklikon vazhdimisht.')}</div>
        </Callout>
      </Step>

      <Step n={3} title={t('Ngrije në "High Reliability" — zgjidhja kryesore')}>
        <p>{t('Modaliteti High e vendos llogarinë mbi 2 servera rezervë — kur njëri bie, tjetri e mban lidhjen. Uptime ~99.96% kundrejt ~99.5%.')}</p>
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-xs flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Reliability</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg border border-green-500/40 bg-green-500/10 text-green-400">High ▾</span>
          </div>
        </div>
        <p className="text-gray-400 text-xs">{t('Te llogaria → Edit (ose ⋮ → Increase reliability) → Reliability = High → Update.')}</p>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Është me pagesë dhe e ndal llogarinë përkohësisht kur e ndryshon (pak minuta). Bëje kur s\'ke trade kritik në çast.')}</div>
        </Callout>
      </Step>

      <Step n={4} title={t('Përdor fjalëkalimin "Investor" në telefon')}>
        <div className="flex items-start gap-2"><KeyRound className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p><b className="text-amber-300">Master</b> {t('— lejon tregtim. Mbaje VETËM te MetaApi.')}</p>
            <p><b className="text-amber-300">Investor</b> {t('— vetëm-lexim. Përdore te telefoni/PC-ja jote.')}</p>
          </div>
        </div>
        <p>{t('Te MT5 → llogaria → Change password → skeda Investor (read only). Logohu në telefon me investor, jo me master.')}</p>
        <Callout tone="grn" icon={CheckCircle2}>
          <div>{t('Kështu kur ti shikon llogarinë në telefon, NUK ia zë sesionin MetaApi-t → s\'ka më shkëputje nga konflikti.')}</div>
        </Callout>
      </Step>

      <Step n={5} title={t('Konfirmo që u lidh (jeshile)')}>
        <p>{t('Prit derisa llogaria të tregojë Deployed + Connected + Synchronized. Kthehu te aplikacioni — gabimi zhduket vetë.')}</p>
        <div className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg p-2.5">
          <span className="text-gray-300 text-xs">{t('Llogaria jote MT5')} · High reliability</span>
          <Chip tone="grn">CONNECTED ✓</Chip>
        </div>
      </Step>

      <Step n={6} title={t('Për stabilitet maksimal (opsionale)')}>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>{t('Llogari REALE')}</b> {t('në vend të demo — serverat demo rinisen shpesh; reale = shumë më e qëndrueshme.')}</li>
          <li><b>{t('Replikë në rajon tjetër')}</b> {t('— redundancë gjeografike për uptime edhe më të lartë.')}</li>
        </ul>
      </Step>

      <Callout tone="amb" icon={Rocket}>
        <div><b>{t('Përmbledhje:')}</b> {t('① prit 1 orë nëse je bllokuar · ② Deploy një herë · ③ vendos High Reliability · ④ përdor fjalëkalim investor në telefon · ⑤ prit jeshilen.')}</div>
      </Callout>

      {/* ============ SEKSIONI 2: Si fillon roboti ============ */}
      <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 to-gray-900 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Rocket className="w-5 h-5 text-cyan-400" />
          <h3 className="text-white font-bold">{t('Si fillon roboti të tregtojë')}</h3>
        </div>
        <ul className="text-gray-300 text-[13px] leading-relaxed space-y-1.5 list-disc pl-5">
          <li>{t('Çelësi kryesor "Auto-trade" duhet të jetë ON (përndryshe roboti s\'hyn fare në trade).')}</li>
          <li>{t('Lidhja me MT5 duhet të jetë jeshile (Connected).')}</li>
          <li>{t('Roboti pret një sinjal të freskët me besueshmëri ≥ pragun tënd (p.sh. 70%) — brenda dritares 15 minuta.')}</li>
          <li>{t('Respekton kufijtë e tu: humbja ditore, max trade hapur, dhe ndalimet e sigurisë (porta e Claude për swing).')}</li>
        </ul>
        {onNavigate && (
          <button onClick={() => onNavigate('metatrader')}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 transition-colors">
            <Monitor className="w-4 h-4" /> {t('Shko te Lidhja & Konfigurimi')}
          </button>
        )}
      </div>

      <p className="text-gray-600 text-[11px] text-center">{t('Trade-t e hapura mbrohen nga SL/TP te broker-i edhe nëse lidhja API shkëputet përkohësisht.')}</p>
    </div>
  );
}
