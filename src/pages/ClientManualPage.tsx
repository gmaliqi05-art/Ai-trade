// Manuali i përdorimit (klient) — udhëzues i PLOTË nga A–Z për abonimin STANDARD:
// abonimi & verifikimi → Vantage MT5 → MetaApi (Account ID + Token) → lidhja te platforma →
// konfigurimi i robotit të sinjaleve → tregtimi manual → Journal → cilësimet → lidhje e qëndrueshme.
// Vetëm-lexim, me pamje (mockup) dhe linqe direkte për çdo hap.
//
// KUJDES: udhëzimet duhet të përmendin VETËM faqe që i ka një abonent standard
// (Tregto Live · Konfigurimi i Sinjaleve · Journal · Manuali · Cilësimet · Njoftimet).
// Faqet VIP (Lidhja & Konfigurimi, MMT, Paneli, Raporte…) NUK duhen përmendur si hapa.
import {
  BookOpen, ShieldCheck, KeyRound, Wifi, AlertTriangle, CheckCircle2, Rocket, Monitor,
  ExternalLink, Building2, Cloud, Copy, ArrowRight, SlidersHorizontal,
  CreditCard, Send, CalendarDays, Settings, Activity,
} from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import type { ClientPage } from '../App';

/* ---------- blloqe ndihmëse vizuale ---------- */
function Chip({ tone, children }: { tone: 'grn' | 'red' | 'gray' | 'amb'; children: React.ReactNode }) {
  const m = {
    grn: 'bg-green-500/15 text-green-400 border-green-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
    gray: 'bg-gray-600/20 text-gray-300 border-gray-600/40',
    amb: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  }[tone];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m}`}>{children}</span>;
}

function Callout({ tone, icon: Icon, children }: { tone: 'amb' | 'red' | 'grn' | 'blue'; icon: React.ElementType; children: React.ReactNode }) {
  const m = {
    amb: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    red: 'bg-red-500/10 border-red-500/30 text-red-300',
    grn: 'bg-green-500/10 border-green-500/30 text-green-300',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-200',
  }[tone];
  return (
    <div className={`flex items-start gap-2 text-[13px] rounded-xl border p-3 ${m}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function LinkBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors">
      <ExternalLink className="w-3.5 h-3.5" /> {children}
    </a>
  );
}

// Buton që e çon përdoruesin te faqja përkatëse brenda platformës.
function GoBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors">
      <ArrowRight className="w-4 h-4" /> {children}
    </button>
  );
}

// Fushë "mockup" si te një formular real (etiketë + kuti me vlerë + opsion Copy).
function MockField({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
      <div className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1.5">
        <span className={`text-[12px] text-gray-200 truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
        {copy && <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400 border border-amber-500/40 rounded px-1.5 py-0.5"><Copy className="w-3 h-3" /> Copy</span>}
      </div>
    </div>
  );
}

// Kornizë "ekrani" mockup me titull (si dritare e shfletuesit/aplikacionit).
function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <span className="w-2 h-2 rounded-full bg-red-400/70" /><span className="w-2 h-2 rounded-full bg-amber-400/70" /><span className="w-2 h-2 rounded-full bg-green-400/70" />
        <span className="ml-2 text-[10px] text-gray-400 font-mono truncate">{title}</span>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function Part({ n, color, icon: Icon, title, children }: { n: string; color: string; icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${color}`}>
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gray-950/40 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold">{n}</div>
          <h3 className="text-white font-bold text-sm leading-tight">{title}</h3>
        </div>
      </div>
      <div className="space-y-2.5 text-[13px] text-gray-200 leading-relaxed">{children}</div>
    </div>
  );
}

export default function ClientManualPage({ onNavigate }: { onNavigate?: (p: ClientPage) => void }) {
  const { t } = useI18n();

  // Rruga e shkurtër — e gjithë rrugëtimi në një pamje, që përdoruesi ta dijë ku ndodhet.
  const roadmap = [
    { n: 1, label: t('Abonimi & verifikimi') },
    { n: 2, label: t('Llogaria Vantage MT5') },
    { n: 3, label: t('MetaApi: Account ID + Token') },
    { n: 4, label: t('Lidhja te platforma') },
    { n: 5, label: t('Konfigurimi i robotit') },
    { n: 6, label: t('Ndiq rezultatet') },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{t('Manuali i përdorimit')}</h2>
          <p className="text-gray-400 text-sm">{t('Nga A–Z: abonimi → Vantage MT5 → MetaApi → lidhja → roboti i sinjaleve. Ndiqe me radhë, mos i ngatërro kredencialet.')}</p>
        </div>
      </div>

      {/* ===== RRUGA E SHKURTËR ===== */}
      <div className="rounded-2xl border border-gray-700 bg-gray-900 p-4 space-y-3">
        <h3 className="text-white font-bold text-sm">{t('Rruga e shkurtër — 6 hapa')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {roadmap.map((s) => (
            <div key={s.n} className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl px-2.5 py-2">
              <span className="w-5 h-5 shrink-0 rounded-full bg-amber-500 text-gray-950 text-[11px] font-black flex items-center justify-center">{s.n}</span>
              <span className="text-[11px] text-gray-200 leading-tight">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">{t('Hapat 2–4 bëhen VETËM një herë. Pastaj roboti punon 24/7 vetë.')}</p>
      </div>

      {/* ===== Si rrjedhin kredencialet (diagram) ===== */}
      <div className="rounded-2xl border border-gray-700 bg-gray-900 p-4 space-y-3">
        <h3 className="text-white font-bold text-sm">{t('Si rrjedhin kredencialet (shumë e rëndësishme)')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-gray-950 border border-blue-500/30 rounded-xl p-3 text-center">
            <Building2 className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <div className="text-white text-xs font-semibold">{t('1. Vantage MT5')}</div>
            <div className="text-gray-400 text-[11px] mt-0.5">{t('Login · Password · Server')}</div>
          </div>
          <div className="bg-gray-950 border border-violet-500/30 rounded-xl p-3 text-center">
            <Cloud className="w-5 h-5 text-violet-400 mx-auto mb-1" />
            <div className="text-white text-xs font-semibold">{t('2. MetaApi')}</div>
            <div className="text-gray-400 text-[11px] mt-0.5">{t('Të jep: Account ID · Token')}</div>
          </div>
          <div className="bg-gray-950 border border-amber-500/30 rounded-xl p-3 text-center">
            <Monitor className="w-5 h-5 text-amber-400 mx-auto mb-1" />
            <div className="text-white text-xs font-semibold">{t('3. Platforma')}</div>
            <div className="text-gray-400 text-[11px] mt-0.5">{t('Account ID · Token · Rajoni')}</div>
          </div>
        </div>
        <Callout tone="red" icon={AlertTriangle}>
          <div><b>{t('Rregulli i artë:')}</b> {t('Fjalëkalimi i Vantage shkon VETËM te MetaApi (një herë). Te platforma NUK vendos kurrë fjalëkalimin e Vantage — vetëm Account ID + Token që t\'i jep MetaApi.')}</div>
        </Callout>
      </div>

      {/* ===== PJESA 1: Abonimi & verifikimi ===== */}
      <Part n={t('PJESA 1')} color="border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 to-gray-900" icon={CreditCard}
        title={t('Abonimi dhe verifikimi i llogarisë')}>
        <p>{t('Pas regjistrimit të shfaqet tabela e planeve. Zgjedh njërin nga tre:')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-gray-950 border border-gray-700 rounded-xl p-2.5">
            <div className="text-white text-xs font-bold">{t('Provë falas')}</div>
            <div className="text-emerald-400 text-sm font-bold">0€ · 15 {t('ditë')}</div>
            <div className="text-gray-500 text-[10px] mt-0.5">{t('Pa kartë krediti')}</div>
          </div>
          <div className="bg-gray-950 border border-gray-700 rounded-xl p-2.5">
            <div className="text-white text-xs font-bold">{t('Mujor')}</div>
            <div className="text-white text-sm font-bold">69€ / {t('muaj')}</div>
            <div className="text-gray-500 text-[10px] mt-0.5">{t('Rinovim automatik')}</div>
          </div>
          <div className="bg-gray-950 border border-amber-500/40 rounded-xl p-2.5">
            <div className="text-white text-xs font-bold">{t('Vjetor')}</div>
            <div className="text-white text-sm font-bold">699€ <span className="text-gray-500 text-[11px] line-through">828€</span></div>
            <div className="text-amber-400 text-[10px] mt-0.5">{t('Kursen 129€')}</div>
          </div>
        </div>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Pagesa bëhet me kartë Debit/Kredit përmes Stripe — e sigurt dhe automatike.')}</li>
          <li>{t('Abonimin e menaxhon ose e anulon kur të duash te Cilësimet → Abonimi → «Menaxho abonimin».')}</li>
          <li>{t('Një javë para skadimit merr njoftim push si kujtesë.')}</li>
        </ul>
        <Callout tone="amb" icon={KeyRound}>
          <div><b>{t('Kodi i verifikimit:')}</b> {t('pas regjistrimit të kërkohet një kod me 6 shifra. Këtë kod ta jep Administratori — kërkoja atij dhe fute te dritarja që hapet. Pa këtë kod nuk hapen faqet e tregtimit.')}</div>
        </Callout>
      </Part>

      {/* ===== PJESA 2: Vantage ===== */}
      <Part n={t('PJESA 2')} color="border-blue-500/25 bg-gradient-to-br from-blue-500/5 to-gray-900" icon={Building2}
        title={t('Hap llogarinë Vantage (MetaTrader 5)')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Regjistrohu te Vantage → te portali zgjidh')} <b>Accounts → Open Account</b> → <b>MetaTrader 5</b> ({t('Demo për provë, ose Live për para reale')}).</li>
          <li>{t('Pas hapjes, Vantage t\'i dërgon kredencialet me email dhe i sheh edhe te portali.')}</li>
        </ul>
        <Screen title="portal.vantagemarkets.com">
          <MockField label={t('Login (numri i llogarisë)')} value="25538825" mono />
          <MockField label={t('Password (master — për tregtim)')} value="••••••••••" mono />
          <MockField label={t('Investor password (vetëm-lexim)')} value="••••••••••" mono />
          <MockField label={t('Server')} value="VantageInternational-Demo" mono />
        </Screen>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Lexo emrin e SAKTË të serverit nga emaili (p.sh. VantageInternational-Demo ose -Live). Do të duhet te MetaApi.')}</div>
        </Callout>
        <LinkBtn href="https://www.vantagemarkets.com/academy/mt5-login-guide/">{t('Udhëzuesi zyrtar Vantage MT5')}</LinkBtn>
      </Part>

      {/* ===== PJESA 3: MetaApi — shto llogarinë ===== */}
      <Part n={t('PJESA 3')} color="border-violet-500/25 bg-gradient-to-br from-violet-500/5 to-gray-900" icon={Cloud}
        title={t('Hap MetaApi & shto llogarinë MT5 → merr Account ID')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Krijo një llogari falas te')} <b>app.metaapi.cloud</b>.</li>
          <li>{t('Shko te faqja Accounts →')} <b>Add account</b> → {t('zgjidh')} <b>MT5</b>.</li>
          <li>{t('Fut kredencialet e Vantage (nga Pjesa 2):')} <b>{t('Login + Password (master) + Server')}</b>, {t('zgjidh rajonin, kliko Create.')}</li>
        </ul>
        <Screen title="app.metaapi.cloud/accounts → Add account">
          <MockField label={t('Login')} value="25538825" mono />
          <MockField label={t('Password (master i Vantage)')} value="••••••••••" mono />
          <MockField label={t('Server')} value="VantageInternational-Demo" mono />
          <div className="grid grid-cols-2 gap-2">
            <MockField label={t('Platform')} value="MT5" />
            <MockField label={t('Region')} value="london" />
          </div>
          <div className="pt-1 flex justify-end"><span className="text-[11px] font-bold bg-violet-500 text-white rounded px-3 py-1">Create</span></div>
        </Screen>
        <Callout tone="grn" icon={CheckCircle2}>
          <div>{t('Pas krijimit, MetaApi e lidh në cloud dhe të jep një')} <b>Account ID</b> ({t('si kod i gjatë')}). {t('Kopjoje — do të duhet te platforma.')}</div>
        </Callout>
        <Screen title={t('Account i krijuar')}>
          <MockField label={t('Account ID (kopjoje)')} value="0a1b2c3d-4e5f-6789-abcd-ef0123456789" mono copy />
          <div className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-gray-300">25538825 · london</span>
            <Chip tone="grn">CONNECTED</Chip>
          </div>
        </Screen>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Mbaje mend rajonin që zgjodhe (p.sh. london) — të njëjtin duhet ta zgjedhësh edhe te platforma.')}</div>
        </Callout>
        <LinkBtn href="https://app.metaapi.cloud/accounts">app.metaapi.cloud/accounts</LinkBtn>
      </Part>

      {/* ===== PJESA 4: MetaApi token ===== */}
      <Part n={t('PJESA 4')} color="border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/5 to-gray-900" icon={KeyRound}
        title={t('Merr API Token nga MetaApi')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Hap faqen e token-it te')} <b>app.metaapi.cloud/token</b>.</li>
          <li>{t('Krijo një')} <b>API Token</b> {t('dhe kopjoje të gjithë (është shumë i gjatë).')}</li>
        </ul>
        <Screen title="app.metaapi.cloud/token">
          <MockField label={t('API Token (kopjoje të plotë)')} value={t('eyJhbGciOiJSUzI1NiІ9.eyJfaWQ...një kod shumë i gjatë...')} mono copy />
        </Screen>
        <Callout tone="red" icon={ShieldCheck}>
          <div>{t('Token-i është si çelës — mos ia jep askujt dhe mos e publiko. Platforma e ruan të sigurt.')}</div>
        </Callout>
        <LinkBtn href="https://app.metaapi.cloud/token">app.metaapi.cloud/token</LinkBtn>
      </Part>

      {/* ===== PJESA 5: Lidhe te platforma ===== */}
      <Part n={t('PJESA 5')} color="border-amber-500/25 bg-gradient-to-br from-amber-500/5 to-gray-900" icon={Monitor}
        title={t('Lidhe llogarinë te platforma')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Te menyja hap')} <b>{t('Konfigurimi i Sinjaleve')}</b>.</li>
          <li>{t('Zbrit poshtë dhe hap kartën')} <b>{t('Lidhja me MT5 (MetaApi)')}</b>.</li>
          <li>{t('Plotëso 3 fushat me ato që MORE nga MetaApi:')}</li>
        </ul>
        <Screen title={t('Konfigurimi i Sinjaleve → Lidhja me MT5 (MetaApi)')}>
          <MockField label={t('MetaApi Account ID')} value="0a1b2c3d-4e5f-6789-abcd-ef0123456789" mono />
          <MockField label={t('Rajoni (i njëjti si te MetaApi)')} value="london" />
          <MockField label={t('MetaApi Token')} value="eyJhbGciOiJSUzI1NiI9..." mono />
          <div className="pt-1 flex justify-end gap-2">
            <span className="text-[11px] font-bold bg-gray-700 text-white rounded px-3 py-1">{t('Ruaj cilësimet')}</span>
            <span className="text-[11px] font-bold bg-amber-500 text-gray-950 rounded px-3 py-1">{t('Testo lidhjen')}</span>
          </div>
        </Screen>
        <Callout tone="blue" icon={AlertTriangle}>
          <div>{t('Rajoni duhet të jetë SAKTË i njëjti që zgjodhe te MetaApi (p.sh. london). Ndryshe del 502 / "Could not reach MetaApi".')}</div>
        </Callout>
        <Callout tone="grn" icon={CheckCircle2}>
          <div>{t('Kur «Testo lidhjen» kthen sukses, lart te faqja shfaqet Balanca, Equity dhe Marzhi i lirë i llogarisë tënde. Kjo do të thotë se lidhja punon.')}</div>
        </Callout>
        {onNavigate && <GoBtn onClick={() => onNavigate('telegram_sin')}>{t('Hap Konfigurimin e Sinjaleve')}</GoBtn>}
      </Part>

      {/* ===== PJESA 6: Konfigurimi i robotit të sinjaleve ===== */}
      <Part n={t('PJESA 6')} color="border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 to-gray-900" icon={SlidersHorizontal}
        title={t('Konfiguro robotin e sinjaleve (GoldSniperFX)')}>
        <p>{t('Te po e njëjta faqe gjendet karta «GoldSniperFX Algorithm». Aty rregullon si do të tregtojë roboti sinjalet që vijnë:')}</p>
        <Screen title={t('Karta GoldSniperFX Algorithm')}>
          <div className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-gray-300">GoldSniperFX Algorithm</span>
            <Chip tone="grn">ON</Chip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MockField label={t('Lot (për çdo TP)')} value="0.01" />
            <MockField label={t('Mënyra e TP-ve')} value="Multi (1/TP)" />
            <MockField label={t('SL rezervë ($)')} value="30" />
            <MockField label={t('Max pozicione')} value="4" />
          </div>
        </Screen>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>{t('Çelësi ON/OFF')}</b> — {t('ndez ose ndal marrjen e sinjaleve nga ky kanal. Ky është çelësi yt kryesor.')}</li>
          <li><b>{t('Lot (për çdo TP)')}</b> — {t('sasia për çdo pozicion. Fillo me lot të vogël (p.sh. 0.01) derisa të njihesh me sistemin.')}</li>
          <li><b>{t('Mënyra e TP-ve')}</b> — {t('Multi (1/TP): hap një pozicion për çdo TP · TP1: vetëm i pari · TP më i larti: vetëm i fundit · Ndaj lotin: e ndan lotin mes TP-ve.')}</li>
          <li><b>{t('SL rezervë ($)')}</b> — {t('kur sinjali vjen pa Stop Loss, roboti vendos vetë një SL në këtë vlerë humbjeje, që pozicioni të mos mbetet i pambrojtur.')}</li>
          <li><b>{t('Max pozicione')}</b> — {t('sa pozicione mund të jenë të hapura njëkohësisht nga ky kanal.')}</li>
          <li><b>{t('Mbrojtja shkallë-shkallë e TP-ve')}</b> — {t('kur preket TP1, SL-ja lëviz te hyrja (breakeven) dhe ngrihet me çdo TP tjetër — mbron fitimin e arritur.')}</li>
        </ul>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Fillo me lot 0.01 dhe max 1–2 pozicione, sidomos në llogari demo. Rrite vetëm pasi të kesh parë disa sinjale të mbyllura.')}</div>
        </Callout>
      </Part>

      {/* ===== PJESA 7: Tregto Live ===== */}
      <Part n={t('PJESA 7')} color="border-orange-500/25 bg-gradient-to-br from-orange-500/5 to-gray-900" icon={Activity}
        title={t('Tregto Live — grafiku dhe tregtimi manual')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Grafiku i drejtpërdrejtë i arit (XAUUSD) me çmimin real. Butoni i zmadhimit e hap grafikun në ekran të plotë.')}</li>
          <li>{t('Butoni «Nivelet» shfaq nivelet kryesore të mbështetjes dhe rezistencës mbi grafik.')}</li>
          <li>{t('Për të hapur një pozicion me dorë: zgjidh BLEJ ose SHIT, cakto lotin me butonat +/−, vendos SL dhe TP nëse do, pastaj kliko «Open Order».')}</li>
          <li>{t('Poshtë gjenden tabelat e ditës: sinjalet e GoldSniperFX dhe hyrjet manuale. TP-të e prekura ndriçohen me ngjyrë të verdhë.')}</li>
        </ul>
        <Callout tone="blue" icon={CalendarDays}>
          <div>{t('Këto tabela tregojnë vetëm ditën e sotme (një trade i hapur mbetet aty derisa të mbyllet). Historiku i plotë gjendet te Journal.')}</div>
        </Callout>
        {onNavigate && <GoBtn onClick={() => onNavigate('market_prices')}>{t('Hap Tregto Live')}</GoBtn>}
      </Part>

      {/* ===== PJESA 8: Journal ===== */}
      <Part n={t('PJESA 8')} color="border-indigo-500/25 bg-gradient-to-br from-indigo-500/5 to-gray-900" icon={CalendarDays}
        title={t('Journal — ditari i tregtimit')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Kalendar mujor ku çdo ditë tregon fitimin ose humbjen e asaj dite.')}</li>
          <li>{t('Kliko një ditë → hapen tabelat e ndara: tregtitë e robotit dhe ato manuale, me orën e hyrjes, orën e mbylljes dhe TP1–TP4.')}</li>
          <li>{t('Paneli lart tregon depozitat, tërheqjet, bilancin aktual dhe rezultatin neto nga tregtimi.')}</li>
          <li>{t('Grafiku i bilancit e ndjek llogarinë me kalimin e kohës; mund ta filtrosh sipas datave dhe sipas modelit (GoldSniperFX ose manual).')}</li>
          <li>{t('Në fund të faqes mund të shkruash shënime për çdo ditë — ruhen dhe shfaqen në tabelën e shënimeve.')}</li>
        </ul>
        {onNavigate && <GoBtn onClick={() => onNavigate('journal')}>{t('Hap Journal')}</GoBtn>}
      </Part>

      {/* ===== PJESA 9: Cilësimet ===== */}
      <Part n={t('PJESA 9')} color="border-slate-500/25 bg-gradient-to-br from-slate-500/5 to-gray-900" icon={Settings}
        title={t('Cilësimet — profili, njoftimet, abonimi')}>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>{t('Profili')}</b> — {t('emri, mbiemri, datëlindja, telefoni dhe adresa. Kliko mbi foton për të ngarkuar një foto profili.')}</li>
          <li><b>{t('Njoftimet')}</b> — {t('ndez njoftimet push për këtë pajisje: merr mesazhet e platformës dhe kujtesën një javë para skadimit të abonimit.')}</li>
          <li><b>{t('Abonimi')}</b> — {t('shiko planin aktual dhe ditët e mbetura; ndrysho kartën ose anulo abonimin te «Menaxho abonimin».')}</li>
          <li><b>{t('Gjuha')}</b> — {t('ndryshohet nga butoni lart djathtas: English · Deutsch · Français · Italiano · Shqip.')}</li>
        </ul>
        <Callout tone="red" icon={AlertTriangle}>
          <div><b>{t('Fshirja e llogarisë:')}</b> {t('gjendet te Cilësimet → Abonimi. Kërkon fjalëkalimin tënd dhe është e pakthyeshme — të gjitha të dhënat, tregtitë dhe shënimet fshihen përgjithmonë.')}</div>
        </Callout>
        <Callout tone="blue" icon={ShieldCheck}>
          <div>{t('Në iPhone/iPad njoftimet punojnë vetëm nëse e shton platformën në Home Screen si aplikacion (jo nga shfletuesi).')}</div>
        </Callout>
        {onNavigate && <GoBtn onClick={() => onNavigate('settings')}>{t('Hap Cilësimet')}</GoBtn>}
      </Part>

      {/* ===== PJESA 10: Lidhje e qëndrueshme ===== */}
      <Part n={t('PJESA 10')} color="border-green-500/25 bg-gradient-to-br from-green-500/5 to-gray-900" icon={Wifi}
        title={t('Mbaje lidhjen të qëndrueshme (mos u shkëput)')}>
        <Callout tone="red" icon={AlertTriangle}>
          <div><b>{t('Nëse del "rejected too many times" / "Could not reach MetaApi":')}</b> {t('MetaApi e bllokon validimin për ~1 orë. MOS kliko Deploy/Retry vazhdimisht — çdo përpjekje e rinis orën. Prit 1 orë, pastaj vazhdo.')}</div>
        </Callout>
        <div className="space-y-1.5">
          <div className="flex gap-2"><ShieldCheck className="w-4 h-4 text-green-400 shrink-0 mt-0.5" /><span><b>{t('High Reliability:')}</b> {t('te MetaApi vendos Reliability = High → 2 servera rezervë, uptime ~99.96%. Zgjidhja kryesore kundër shkëputjeve (me pagesë).')}</span></div>
          <div className="flex gap-2"><KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /><span><b>{t('Fjalëkalim Investor në telefon:')}</b> {t('mbaj master-in vetëm te MetaApi; në telefon logohu me investor (vetëm-lexim) që të mos ia zësh sesionin.')}</span></div>
          <div className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /><span><b>{t('Mos spam Deploy:')}</b> {t('një Deploy i vetëm, pastaj prit 2–5 min derisa të bëhet jeshile (Connected + Synchronized).')}</span></div>
          <div className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" /><span><b>{t('Për stabilitet maksimal:')}</b> {t('llogari REALE (demo-t rinisen shpesh) ose replikë në rajon tjetër.')}</span></div>
        </div>
      </Part>

      {/* ===== Si punon roboti i sinjaleve ===== */}
      <div className="rounded-2xl border border-gray-700 bg-gray-900 p-4 space-y-2">
        <div className="flex items-center gap-2.5">
          <Rocket className="w-5 h-5 text-amber-400" />
          <h3 className="text-white font-bold text-sm">{t('Si punon roboti i sinjaleve')}</h3>
        </div>
        <ul className="text-gray-300 text-[13px] leading-relaxed space-y-1 list-disc pl-5">
          <li>{t('Sinjali gjenerohet nga algoritmi GoldSniperFX dhe mbërrin te platforma.')}</li>
          <li>{t('Roboti hap pozicionin te llogaria jote MT5 sipas parametrave që ke vendosur (lot, mënyra e TP-ve, max pozicione).')}</li>
          <li>{t('Nëse sinjali nuk ka SL, vendoset SL-ja rezervë që ke caktuar.')}</li>
          <li>{t('Me çdo TP të prekur, mbrojtja shkallë-shkallë e ngre SL-në dhe siguron fitimin.')}</li>
          <li>{t('Merr njoftim push për çdo hapje dhe mbyllje, nëse i ke ndezur njoftimet.')}</li>
        </ul>
        <Callout tone="amb" icon={Send}>
          <div>{t('Për të marrë sinjalet, llogaria jote MT5 duhet të jetë e lidhur (Pjesa 5) dhe çelësi i kanalit ON (Pjesa 6). Pa këto të dyja, roboti nuk hap asnjë pozicion.')}</div>
        </Callout>
      </div>

      <Callout tone="grn" icon={ShieldCheck}>
        <div>{t('Trade-t e hapura mbrohen nga SL/TP te broker-i edhe nëse lidhja API shkëputet përkohësisht — pozicioni nuk mbyllet, thjesht s\'po e sheh.')}</div>
      </Callout>

      <p className="text-gray-600 text-[11px] text-center">{t('Përmbledhje: 1) Abonimi + kodi i verifikimit → 2) Vantage MT5 → 3) MetaApi (Account ID + Token) → 4) Konfigurimi i Sinjaleve → Lidhja me MT5 → 5) Karta GoldSniperFX ON.')}</p>
    </div>
  );
}
