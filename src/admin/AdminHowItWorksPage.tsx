// Super-Admin → "Si funksionon": dokumentim i plotë i kalkulimeve për sinjale & auto-trade.
// Faqe vetëm-lexim që shpjegon matematikën, logjikën, burimet e të dhënave dhe çdo portë sigurie,
// që super-admin-i të jetë gjithmonë në dijeni se si vendos sistemi.
import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, Database, Sigma, Zap, ShieldCheck, Crosshair, Clock, Droplet, RefreshCw, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function Section({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-white font-semibold">{title}</h3>
          {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-3 text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 font-mono text-[12px] text-amber-200/90 overflow-x-auto">{children}</div>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-amber-500 text-gray-950 text-xs font-black flex items-center justify-center flex-shrink-0">{n}</div>
      <div className="flex-1">
        <div className="text-white font-medium text-[13px]">{title}</div>
        <div className="text-gray-400 text-[13px] mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function Gate({ name, rule, why }: { name: string; rule: string; why: string }) {
  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-950/40">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
        <span className="text-white text-[13px] font-semibold">{name}</span>
      </div>
      <div className="text-amber-200/80 font-mono text-[11px] mt-1">{rule}</div>
      <div className="text-gray-500 text-[12px] mt-1">{why}</div>
    </div>
  );
}

export default function AdminHowItWorksPage() {
  const [live, setLive] = useState<{ engine?: string; lastSignal?: string; lastTrade?: string; exec48?: number; rej48?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLive = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const [{ data: sig }, { data: exe }, { count: execN }, { count: rejN }] = await Promise.all([
        supabase.from('signals').select('symbol, created_at').eq('source', 'engine').order('created_at', { ascending: false }).limit(1),
        supabase.from('trade_executions').select('symbol, created_at').eq('status', 'executed').order('created_at', { ascending: false }).limit(1),
        supabase.from('trade_executions').select('id', { count: 'exact', head: true }).eq('status', 'executed').gte('created_at', since),
        supabase.from('trade_executions').select('id', { count: 'exact', head: true }).eq('status', 'rejected').gte('created_at', since),
      ]);
      setLive({
        lastSignal: sig?.[0] ? `${sig[0].symbol} · ${new Date(sig[0].created_at).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '—',
        lastTrade: exe?.[0] ? `${exe[0].symbol} · ${new Date(exe[0].created_at).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '—',
        exec48: execN ?? 0, rej48: rejN ?? 0,
      });
    } catch { /* injoro */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {/* Titulli */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-amber-400" />
          <div>
            <h2 className="text-2xl font-bold text-white">Si funksionon sistemi</h2>
            <p className="text-gray-400 text-sm">Dokumentim i plotë i kalkulimeve për sinjale & auto-trade — burimet, matematika, logjika dhe portat e sigurisë.</p>
          </div>
        </div>
        <button onClick={loadLive} disabled={loading} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Statusi live */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { k: 'Sinjali i fundit', v: live?.lastSignal ?? '…' },
          { k: 'Trade i fundit', v: live?.lastTrade ?? '…' },
          { k: 'Ekzekutuar (48h)', v: String(live?.exec48 ?? '…') },
          { k: 'Refuzuar (48h)', v: String(live?.rej48 ?? '…') },
        ].map((c) => (
          <div key={c.k} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">{c.k}</div>
            <div className="text-white text-sm font-semibold mt-0.5 truncate">{c.v}</div>
          </div>
        ))}
      </div>

      {/* 1. Burimet e të dhënave */}
      <Section icon={Database} title="1. Burimet e të dhënave (nga ku merren çmimet)" subtitle="Çdo kalkulim bazohet në qirinj REALË — asgjë nuk shpiket.">
        <ul className="space-y-2">
          <li>🥇 <span className="text-white font-medium">Ari (XAUUSD):</span> qirinj realë nga <span className="text-amber-300">Binance — PAXGUSDT</span> (PAX Gold, token i mbështetur fizikisht me ar që ndjek spot-in). Intervale: 15m / 1h / 4h / 1d, deri në 300 qirinj.</li>
          <li>🛢️ <span className="text-white font-medium">Nafta (USOIL/UKOIL):</span> qirinj realë nga <span className="text-amber-300">MetaApi — llogaria jote MT5</span> (të njëjtat çmime që do tregtosh). Emri i simbolit zgjidhet automatik (USOIL↔XTIUSD/WTI/CL).</li>
          <li>💵 <span className="text-white font-medium">Dollari (DXY proxy):</span> <span className="text-amber-300">EURUSD</span> nga MT5 — për konfirmim ar↔dollar (korrelacion negativ).</li>
        </ul>
        <p className="text-gray-500 text-xs">Të gjitha kërkesat kanë timeout (8–12s). Nëse një burim s'përgjigjet, sinjali nuk gjenerohet (jo të dhëna të rreme).</p>
      </Section>

      {/* 2. Indikatorët */}
      <Section icon={Sigma} title="2. Indikatorët matematikorë (formula standarde)" subtitle="Të gjithë janë formula klasike, të verifikuara me teste njësi.">
        <div className="space-y-2.5">
          <div><span className="text-white font-medium">EMA (Exponential Moving Average):</span> mesatare që i jep peshë më të madhe çmimeve të fundit.
            <Formula>k = 2/(periudha+1) · EMA_sot = Çmim·k + EMA_dje·(1−k)</Formula></div>
          <div><span className="text-white font-medium">RSI (Wilder, 14):</span> momentum 0–100; &gt;70 mbiblerë, &lt;30 mbishitur.
            <Formula>RS = mesatareFitime/mesatareHumbje · RSI = 100 − 100/(1+RS)</Formula></div>
          <div><span className="text-white font-medium">MACD (12,26,9):</span> ndryshimi i dy EMA-ve + linja sinjal.
            <Formula>MACD = EMA12 − EMA26 · Sinjal = EMA9(MACD) · Hist = MACD − Sinjal</Formula></div>
          <div><span className="text-white font-medium">Bollinger (20, 2σ):</span> mesatare ± 2 devijime standarde (zona e çmimit).</div>
          <div><span className="text-white font-medium">ATR (Wilder, 14):</span> diapazoni mesatar real — mat volatilitetin (përdoret për SL/TP).
            <Formula>TR = max(H−L, |H−Cdje|, |L−Cdje|) · ATR = mesatare Wilder e TR</Formula></div>
          <div><span className="text-white font-medium">ADX (Wilder, 14):</span> forca e trendit 0–100; &gt;25 = trend i fortë, &lt;20 = treg pa drejtim.</div>
          <div className="text-gray-500 text-xs pt-1">Opsionale (Tier-1, default JOAKTIV): Efficiency Ratio (Kaufman), Supertrend (ATR), Funding rate — filtra shtesë që super-admin/përdoruesi mund t'i ndezë.</div>
        </div>
      </Section>

      {/* 3. Gjenerimi i sinjalit */}
      <Section icon={Zap} title="3. Si gjenerohet një sinjal (hap pas hapi)" subtitle="Motori refuzon shumicën e situatave — sinjal vetëm kur TË GJITHA kushtet kryesore plotësohen.">
        <div className="space-y-3">
          <Step n={1} title="Merr qirinjtë në 4 periudha">15m, 1h, 4h, 1d (paralelisht). Nëse mungojnë, ndalon.</Step>
          <Step n={2} title="Analizon çdo periudhë">Llogarit EMA9/21/200, RSI, MACD, Bollinger, ATR, ADX → drejtim (BLEJ/SHIT/PRIT) + besueshmëri për secilën.</Step>
          <Step n={3} title="Konfirmim shumë-periudhash">1h DHE 4h duhet të japin TË NJËJTIN drejtim. Përndryshe → asnjë sinjal.</Step>
          <Step n={4} title="Filtri i trendit (EMA200)">Për BLEJ: çmimi mbi EMA200. Për SHIT: çmimi nën EMA200. Tregto ME trendin.</Step>
          <Step n={5} title="Filtri i forcës (ADX ≥ 18)">Vetëm trende të forta; treg i çrregullt → refuzohet.</Step>
          <Step n={6} title="Filtri i volatilitetit (ATR)">Refuzon tregun e ngrirë (ATR&lt;0.5× mesatares) dhe spike-t ekstreme (&gt;3.5×).</Step>
          <Step n={7} title="Trendi ditor (D1, EMA50)">Sinjali duhet në harmoni me trendin ditor; kundër tij → refuzohet.</Step>
          <Step n={8} title="Confluence + besueshmëri">Numëron faktorët mbështetës (ADX≥25, RSI me hapësirë, MACD në harmoni, sesion, nivele). Sa më shumë → aq më e lartë besueshmëria.</Step>
          <Step n={9} title="Llogarit Entry / SL / TP">Çmimi aktual = Entry; SL/TP nga ATR (shih më poshtë). Ruan sinjalin me arsyetimin e plotë.</Step>
        </div>
        <p className="text-gray-500 text-xs">Ari ka 4 analiza shtesë specifike: sesionet (London/NY), nivelet psikologjike ($10/$50/$100), volatiliteti dhe trendi ditor.</p>
      </Section>

      {/* 4. SL/TP + madhësia */}
      <Section icon={Crosshair} title="4. SL / TP & madhësia e pozicionit (matematika e rrezikut)" subtitle="Çdo trade ka rrezik të llogaritur saktë para hapjes.">
        <div className="space-y-2.5">
          <div><span className="text-white font-medium">Stop-Loss & Take-Profit (nga ATR):</span>
            <Formula>distSL = ATR(1h) × 1.5  (naftë: × 2.0, më volatile)
TP = distSL × 2   →   Risk:Reward = 1:2</Formula>
            Pra rrezikon 1 për të fituar 2. SL mbron, TP merr fitimin.</div>
          <div><span className="text-white font-medium">Madhësia e lotit (fixed-fractional):</span>
            <Formula>rrezikuPerTrade = min(kapital × rrezik%, kufiriDitor)
lot = rrezikuPerTrade / (distSL × vleraPerÇmim)</Formula>
            Lot-i del nga rreziku REAL — jo numër fiks. <span className="text-gray-500">vleraPerÇmim: ar=100, naftë=1000 (1000 fuçi/lot), forex=100000.</span></div>
          <div><span className="text-white font-medium">Ankorim te çmimi REAL i MT5:</span> SL/TP rillogariten nga qirinjtë e freskët MT5 para hapjes (jo nga PAXG) — që nivelet të jenë saktësisht ato të brokerit.</div>
        </div>
      </Section>

      {/* 5. Vendimi auto-trade + portat */}
      <Section icon={ShieldCheck} title="5. Vendimi për auto-trade — 9 portat e sigurisë" subtitle="Çdo cron (1 min): sinjali kalon nëpër çdo portë. Mjafton një 'JO' → trade-i refuzohet.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Gate name="0 · Tregu i hapur" rule="commodityMarketOpen()" why="Ar/naftë: vetëm e hënë–e premte (mbyllur fundjavën)." />
          <Gate name="1 · Sesioni" rule="goldSessionOpen() · 09–23 Frankfurt" why="Ari tregtohet në orë aktive; naftë & krijon jashtë sesionit (~23h)." />
          <Gate name="2 · Blackout EIA" rule="e mërkurë 10–11 ET" why="Naftë: pauzë rreth raportit javor (lëkundje fallco)." />
          <Gate name="3 · Besueshmëria" rule="conf ≥ min_confidence" why="Vetëm sinjale mbi pragun e përdoruesit (p.sh. 70%)." />
          <Gate name="4 · R:R neto" rule="(TP−kosto)/(SL+kosto) ≥ 1.5" why="Refuzon raport të dobët pas spread/slippage." />
          <Gate name="5 · Konfirmim dollari" rule="DXY (EURUSD vs EMA50)" why="Refuzon kur dollari shkon qartë kundër arit." />
          <Gate name="6 · Max pozicione" rule="openTrades < max_open_trades" why="Kufizon numrin e trade-ve njëkohëshe." />
          <Gate name="7 · Portfolio heat" rule="rreziku total ≤ MAX_HEAT%" why="S'lejon që rreziku i hapur të kalojë % të kapitalit." />
          <Gate name="8 · Limit humbjeje ditore" rule="humbja sot < max_daily_loss" why="Ndalon tregtimin kur arrihet kufiri ditor (mbrojtje)." />
          <Gate name="9 · Claude (porta AI)" rule="Claude pajtohet = po" why="Claude analizon kontekstin e grafikut MT5 dhe konfirmon/refuzon. Fail-open: nëse s'përgjigjet, lejon (që mos bllokojë)." />
        </div>
        <p className="text-gray-500 text-xs">Pas kalimit të të gjitha portave → urdhri dërgohet te MetaApi (MARKET nëse çmimi te hyrja; PENDING nëse jo, hyn automatik kur arrihet).</p>
      </Section>

      {/* 6. Menaxhimi pas hapjes */}
      <Section icon={Clock} title="6. Pas hapjes — trailing & mbrojtja e fitimit" subtitle="Roboti menaxhon pozicionin 24/7 derisa mbyllet.">
        <ul className="space-y-1.5 list-disc list-inside text-gray-300">
          <li><span className="text-white">Trailing SL:</span> sapo trade-i shkon në fitim, SL ngrihet drejt hyrjes (mban % të fitimit, default 50%).</li>
          <li><span className="text-white">Break-even:</span> kur profiti kalon një prag, SL kalon te hyrja (rrezik zero).</li>
          <li><span className="text-white">Dalje scalp:</span> nëse momentumi kthehet kundër pozicionit scalp, mbyllet që të mbahet fitimi.</li>
          <li><span className="text-white">Vlerësim TP/SL:</span> një cron i veçantë (signal-eval, çdo 2 min) shënon sinjalet hit_TP / hit_SL / skaduar.</li>
        </ul>
      </Section>

      {/* 7. Nafta dhe ari */}
      <Section icon={Droplet} title="7. A ndikon nafta te tregu i arit?" subtitle="Pyetje e rëndësishme — përgjigjja e shkurtër: jo si input direkt.">
        <p>Nafta dhe ari janë <span className="text-white">të dyja mall të çmuara në USD</span>, prandaj ndajnë një shtytës të përbashkët: <span className="text-amber-300">dollarin (DXY)</span>. Kur dollari dobësohet, që të dyja priren të ngrihen — por kjo vjen nga <span className="text-white">dollari</span>, jo nga nafta vetë.</p>
        <p>Korrelacioni <span className="text-white">direkt naftë↔ar është i dobët dhe i paqëndrueshëm</span>. Nafta ndikon te inflacioni, që mund të prekë arin si mbrojtje ndaj inflacionit — por është lidhje indirekte dhe me shumë zhurmë.</p>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <p className="text-amber-200 text-[13px]"><span className="font-semibold">Vendimi i sistemit:</span> nafta NUK përdoret si input për sinjalet e arit. Përdorim <span className="font-semibold">DXY (EURUSD)</span> si konfirmim për arin — sepse dollari është shkaku i vërtetë i përbashkët, jo nafta. Ta shtonim naftën si input do shtonte më shumë zhurmë sesa sinjal.</p>
        </div>
        <p className="text-gray-500 text-xs">Ari dhe nafta tregtohen secili mbi teknikën e vet (qirinjtë + indikatorët e vet). Çmimi i naftës ndiqet vetëm për të tregtuar NAFTËN, jo për të ndikuar te ari.</p>
      </Section>

      <p className="text-center text-gray-600 text-xs pt-2">Ky dokument pasqyron logjikën reale të kodit live (engine-scan, auto-trade-runner, signal-eval). Përditësohet me ndryshimet e sistemit.</p>
    </div>
  );
}
