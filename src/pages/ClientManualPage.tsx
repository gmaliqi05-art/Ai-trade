// Manuali i përdorimit (klient) — udhëzues i PLOTË nga A–Z: hapja e llogarisë Vantage MT5,
// hapja e MetaApi + marrja e Account ID/Token, vendosja te platforma, konfigurimi dhe lidhja e
// qëndrueshme. Vetëm-lexim, me pamje (mockup) dhe linqe direkte për çdo hap.
import {
  BookOpen, ShieldCheck, KeyRound, Wifi, AlertTriangle, CheckCircle2, Rocket, Monitor,
  ExternalLink, Building2, Cloud, Copy, ArrowRight, SlidersHorizontal,
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
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{t('Manuali i përdorimit')}</h2>
          <p className="text-gray-400 text-sm">{t('Lidhja nga A–Z: Vantage MT5 → MetaApi → Platforma. Ndiqe me radhë, mos i ngatërro kredencialet.')}</p>
        </div>
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

      {/* ===== PJESA 1: Vantage ===== */}
      <Part n={t('PJESA 1')} color="border-blue-500/25 bg-gradient-to-br from-blue-500/5 to-gray-900" icon={Building2}
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

      {/* ===== PJESA 2: MetaApi — shto llogarinë ===== */}
      <Part n={t('PJESA 2')} color="border-violet-500/25 bg-gradient-to-br from-violet-500/5 to-gray-900" icon={Cloud}
        title={t('Hap MetaApi & shto llogarinë MT5 → merr Account ID')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Krijo një llogari falas te')} <b>app.metaapi.cloud</b>.</li>
          <li>{t('Shko te faqja Accounts →')} <b>Add account</b> → {t('zgjidh')} <b>MT5</b>.</li>
          <li>{t('Fut kredencialet e Vantage (nga Pjesa 1):')} <b>{t('Login + Password (master) + Server')}</b>, {t('zgjidh rajonin, kliko Create.')}</li>
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
        <LinkBtn href="https://app.metaapi.cloud/accounts">app.metaapi.cloud/accounts</LinkBtn>
      </Part>

      {/* ===== PJESA 3: MetaApi token ===== */}
      <Part n={t('PJESA 3')} color="border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/5 to-gray-900" icon={KeyRound}
        title={t('Merr API Token nga MetaApi')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Hap faqen e token-it te')} <b>app.metaapi.cloud/token</b>.</li>
          <li>{t('Krijo një')} <b>API Token</b> {t('dhe kopjoje të gjithë (është shumë i gjatë).')}</li>
        </ul>
        <Screen title="app.metaapi.cloud/token">
          <MockField label={t('API Token (kopjoje të plotë)')} value="eyJhbGciOiJSUzI1NiІ9.eyJfaWQ...një kod shumë i gjatë..." mono copy />
        </Screen>
        <Callout tone="red" icon={ShieldCheck}>
          <div>{t('Token-i është si çelës — mos ia jep askujt dhe mos e publiko. Platforma e ruan të sigurt.')}</div>
        </Callout>
        <LinkBtn href="https://app.metaapi.cloud/token">app.metaapi.cloud/token</LinkBtn>
      </Part>

      {/* ===== PJESA 4: Vendos te platforma ===== */}
      <Part n={t('PJESA 4')} color="border-amber-500/25 bg-gradient-to-br from-amber-500/5 to-gray-900" icon={Monitor}
        title={t('Vendos në platformë (Lidhja & Konfigurimi)')}>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Te aplikacioni hap')} <b>{t('Lidhja & Konfigurimi')}</b>.</li>
          <li>{t('Plotëso 3 fushat me ato që MORE nga MetaApi:')}</li>
        </ul>
        <Screen title={t('Platforma → Lidhja & Konfigurimi')}>
          <MockField label={t('MetaApi Account ID')} value="0a1b2c3d-4e5f-6789-abcd-ef0123456789" mono />
          <MockField label={t('Rajoni (i njëjti si te MetaApi)')} value="london" />
          <MockField label={t('MetaApi Token')} value="eyJhbGciOiJSUzI1NiI9..." mono />
          <div className="pt-1 flex justify-end gap-2">
            <span className="text-[11px] font-bold bg-gray-700 text-white rounded px-3 py-1">{t('Ruaj')}</span>
            <span className="text-[11px] font-bold bg-amber-500 text-gray-950 rounded px-3 py-1">{t('Testo lidhjen')}</span>
          </div>
        </Screen>
        <Callout tone="blue" icon={AlertTriangle}>
          <div>{t('Rajoni duhet të jetë SAKTË i njëjti që zgjodhe te MetaApi (p.sh. london). Ndryshe del 502 / "Could not reach MetaApi".')}</div>
        </Callout>
        {onNavigate && (
          <button onClick={() => onNavigate('metatrader')}
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors">
            <ArrowRight className="w-4 h-4" /> {t('Hap Lidhja & Konfigurimi te platforma')}
          </button>
        )}
      </Part>

      {/* ===== PJESA 5: Konfigurimi i tregtimit ===== */}
      <Part n={t('PJESA 5')} color="border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 to-gray-900" icon={SlidersHorizontal}
        title={t('Konfiguro tregtimin sipas kapitalit')}>
        <p>{t('Te po e njëjta faqe, zgjidh një PRESET sipas balancës tënde — ai vendos vetë rrezikun, humbjen ditore, lotet dhe SL/TP të scalp-it:')}</p>
        <div className="flex flex-wrap gap-1.5">
          {['€100', '€500', '€1,000', '€5,000', '€50,000', '€100k'].map((p, i) => (
            <span key={p} className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${i === 1 ? 'bg-cyan-500 text-gray-950 border-cyan-400' : 'bg-gray-950 text-gray-300 border-gray-700'}`}>{p}</span>
          ))}
        </div>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('Pas presetit, mund t\'i përshtatësh manualisht: humbja maks. ditore, pozicione maks., besueshmëria minimale (p.sh. 70%).')}</li>
          <li>{t('Në fund, ndiz çelësin kryesor')} <b className="text-cyan-300">{t('Auto-trade → ON')}</b> {t('që roboti të fillojë.')}</li>
        </ul>
        <Callout tone="amb" icon={AlertTriangle}>
          <div>{t('Fillo me një preset të vogël (p.sh. €500) për të provuar, sidomos në llogari demo.')}</div>
        </Callout>
      </Part>

      {/* ===== PJESA 6: Lidhje e qëndrueshme ===== */}
      <Part n={t('PJESA 6')} color="border-green-500/25 bg-gradient-to-br from-green-500/5 to-gray-900" icon={Wifi}
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

      {/* ===== Si fillon roboti ===== */}
      <div className="rounded-2xl border border-gray-700 bg-gray-900 p-4 space-y-2">
        <div className="flex items-center gap-2.5">
          <Rocket className="w-5 h-5 text-amber-400" />
          <h3 className="text-white font-bold text-sm">{t('Si fillon roboti të tregtojë')}</h3>
        </div>
        <ul className="text-gray-300 text-[13px] leading-relaxed space-y-1 list-disc pl-5">
          <li>{t('Çelësi "Auto-trade" ON + lidhja jeshile (Connected).')}</li>
          <li>{t('Roboti pret një sinjal të freskët me besueshmëri ≥ pragun tënd (p.sh. 70%) brenda 15 minutave.')}</li>
          <li>{t('Respekton kufijtë: humbja ditore, max trade hapur, dhe portat e sigurisë (Claude për swing).')}</li>
        </ul>
      </div>

      <Callout tone="grn" icon={ShieldCheck}>
        <div>{t('Trade-t e hapura mbrohen nga SL/TP te broker-i edhe nëse lidhja API shkëputet përkohësisht — pozicioni nuk mbyllet, thjesht s\'po e sheh.')}</div>
      </Callout>

      <p className="text-gray-600 text-[11px] text-center">{t('Përmbledhje: 1) Vantage MT5 → 2) MetaApi (Account ID + Token) → 3) Platforma (Account ID + Token + Rajoni) → 4) Preset + Auto-trade ON.')}</p>
    </div>
  );
}
