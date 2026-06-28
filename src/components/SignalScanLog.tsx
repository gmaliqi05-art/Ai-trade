import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/i18n';

// ============================================================================
// SignalScanLog — tabelë DIAGNOSTIKE për robotin e sinjaleve.
// Tregon, për çdo skanim (çdo 5 min), PSE hyri ose s'hyri një sinjal.
// I njëjti komponent përdoret te "Tregto Live" dhe te "Tregto Demo".
//
// VETËM lexim/diagnostikë — nuk prek fare logjikën e robotit dhe indikatorët.
// Burimi: tabela `signal_scan_log` që e mbush engine-scan në fund të çdo cikli.
// ============================================================================

type ScanRow = {
  id: string;
  scanned_at: string;
  symbol: string;
  reject_reason: string | null;
  gold_action: string | null;
  gold_conf: number | null;
  src_1h: string | null;
  src_4h: string | null;
  created_signal: boolean;
};

// Përkthen kodin teknik të refuzimit në shqip të kuptueshëm (pa prekur motorin).
function explainReject(code: string | null, t: (s: string) => string): string {
  if (!code) return t('Sinjal i pranuar');
  const m = code.match(/^([a-z0-9_]+)/i);
  const key = (m ? m[1] : code).toLowerCase();
  const map: Record<string, string> = {
    no_candles: t('S\'ka të dhëna qirinjsh (burimi jashtë)'),
    analyzetf_null: t('Të dhëna të pamjaftueshme për analizë'),
    '1h_hold': t('1h asnjanës (pa drejtim të qartë)'),
    '4h_disagree': t('Periudhat 1h e 4h s\'pajtohen (treg pa trend)'),
    price_below_ema200_for_buy: t('Çmimi nën EMA200 — s\'blihet kundër trendit'),
    price_above_ema200_for_sell: t('Çmimi mbi EMA200 — s\'shitet kundër trendit'),
    adx_no_trend: t('ADX i ulët — pa trend (treg anësor)'),
    adx_exhausted: t('ADX shumë i lartë — trend i rraskapitur (rrezik kthimi)'),
    chop_er: t('Lëvizje jo-efikase (treg choppy)'),
    vol_frozen: t('Volatilitet shumë i ulët (treg i ngrirë)'),
    vol_spike: t('Spike volatiliteti (lajme) — shmangie sigurie'),
    d1_down_vs_buy: t('Trendi ditor rënës — s\'blihet'),
    d1_up_vs_sell: t('Trendi ditor rritës — s\'shitet'),
    near_resistance: t('Përballë rezistencës së fortë ($50/$100)'),
    near_support: t('Përballë mbështetjes së fortë ($50/$100)'),
    rsi_extreme: t('RSI ekstrem — rrezik kthimi'),
    supertrend_against: t('Supertrend qartë kundër drejtimit'),
  };
  return map[key] || code;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function SignalScanLog({ title }: { title?: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('signal_scan_log')
      .select('id, scanned_at, symbol, reject_reason, gold_action, gold_conf, src_1h, src_4h, created_signal')
      .order('scanned_at', { ascending: false })
      .limit(30);
    setRows((data as ScanRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // freskim çdo 60s
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white">
          {title || t('Historiku i Skanimeve — pse hyn ose s\'hyn sinjali')}
        </span>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white transition-colors"
          title={t('Fresko')}
          aria-label={t('Fresko')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-4 py-2 text-[11px] text-gray-500 border-b border-gray-800/70">
        {t('Roboti i sinjaleve skanon arin çdo 5 min. Këtu shihet vendimi i çdo skanimi — diagnostikë, s\'prek logjikën e robotit.')}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-500">
          {t('Ende pa skanime të regjistruara (tregu mund të jetë i mbyllur).')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                {[t('Koha'), t('Rezultati'), t('Vendimi'), t('Burimi')].map((h) => (
                  <th key={h} className="text-left font-normal px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const passed = r.created_signal || !r.reject_reason;
                const buy = (r.gold_action || '').toUpperCase() === 'BUY';
                return (
                  <tr key={r.id} className="border-t border-gray-800">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmtTime(r.scanned_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {passed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={13} /> {t('Sinjal')}
                          {r.gold_conf != null && (
                            <span className="text-amber-400 font-semibold ml-1">{r.gold_conf}%</span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <ShieldAlert size={13} className="text-rose-400/80" /> {t('Pa hyrje')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-300 max-w-[320px]">
                      {passed ? (
                        <span className={buy ? 'text-emerald-400' : 'text-rose-400'}>
                          {buy ? t('BLEJ') : t('SHIT')} — {t('kushtet u plotësuan')}
                        </span>
                      ) : (
                        explainReject(r.reject_reason, t)
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {r.src_1h || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
