import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Plus, RefreshCw, Brain, Zap, BarChart2, Clock, CheckCircle, Loader2, AlertCircle, TrendingUp, TrendingDown, Minus, Monitor } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface Report {
  id: string;
  title: string;
  type: string;
  period_start: string | null;
  period_end: string | null;
  data: Record<string, unknown>;
  format: string;
  status: string;
  created_at: string;
}

interface AIAnalysis {
  id: string;
  created_at: string;
  sentiment: string;
  confidence: number;
  prediction: string;
  analysis_text: string;
  assets?: { symbol: string; name: string } | null;
}

interface ChartAnalysis {
  id: string;
  created_at: string;
  signal: string | null;
  confidence: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  timeframe: string;
  ai_provider: string;
  status: string;
  assets?: { symbol: string } | null;
}

interface Signal {
  id: string;
  created_at: string;
  type: string;
  symbol: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  timeframe: string;
  status: string;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genType, setGenType] = useState('signals');
  const [period, setPeriod] = useState('30d');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [stats, setStats] = useState<{
    totalAnalyses: number;
    totalSignals: number;
    buySignals: number;
    sellSignals: number;
    avgConfidence: number;
    mtConnections: number;
  } | null>(null);

  const fetchReports = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setReports(data as Report[]);
    setLoading(false);
  }, [user]);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    const [aiRes, chartRes, signalsRes, mtRes] = await Promise.all([
      supabase.from('ai_analyses').select('id, confidence, sentiment').eq('user_id', user.id),
      supabase.from('chart_analyses').select('id, signal, confidence').eq('user_id', user.id).eq('status', 'completed'),
      supabase.from('signals').select('id, type, confidence').eq('status', 'active'),
      supabase.from('metatrader_connections').select('id').eq('user_id', user.id).eq('is_active', true),
    ]);

    const analyses = [...(aiRes.data || []), ...(chartRes.data || [])];
    const signals = signalsRes.data || [];
    const confidenceValues = analyses.map(a => Number(a.confidence)).filter(n => n > 0);

    setStats({
      totalAnalyses: analyses.length,
      totalSignals: signals.length,
      buySignals: signals.filter(s => s.type === 'buy').length,
      sellSignals: signals.filter(s => s.type === 'sell').length,
      avgConfidence: confidenceValues.length > 0
        ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
        : 0,
      mtConnections: (mtRes.data || []).length,
    });
  }, [user]);

  useEffect(() => {
    fetchReports();
    fetchStats();
  }, [fetchReports, fetchStats]);

  const getDateRange = () => {
    const end = new Date();
    const start = new Date();
    if (period === '7d') start.setDate(start.getDate() - 7);
    else if (period === '30d') start.setDate(start.getDate() - 30);
    else if (period === '90d') start.setDate(start.getDate() - 90);
    else if (period === '1y') start.setFullYear(start.getFullYear() - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  };

  const generateReport = async () => {
    if (!user) return;
    setGenerating(true);
    setMsg(null);

    try {
      const { start, end } = getDateRange();
      let reportData: Record<string, unknown> = {};
      let title = '';

      if (genType === 'signals') {
        const { data: signals } = await supabase
          .from('signals')
          .select('id, type, symbol, entry_price, target_price, stop_loss, confidence, timeframe, status, source, created_at')
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false });

        const rows = (signals || []) as Signal[];
        const buy = rows.filter(s => s.type === 'buy');
        const sell = rows.filter(s => s.type === 'sell');
        const avgConf = rows.length > 0
          ? Math.round(rows.reduce((a, s) => a + s.confidence, 0) / rows.length)
          : 0;

        title = `AI Signals Report — ${period}`;
        reportData = {
          summary: {
            total_signals: rows.length,
            buy_signals: buy.length,
            sell_signals: sell.length,
            avg_confidence: avgConf,
            period_start: start,
            period_end: end,
          },
          signals: rows.map(s => ({
            date: s.created_at,
            type: s.type.toUpperCase(),
            symbol: s.symbol,
            entry: s.entry_price,
            target: s.target_price,
            stop_loss: s.stop_loss,
            confidence: s.confidence,
            timeframe: s.timeframe,
            status: s.status,
          })),
        };
      } else if (genType === 'ai_analyses') {
        const [aiRes, chartRes] = await Promise.all([
          supabase.from('ai_analyses')
            .select('id, created_at, sentiment, confidence, prediction, assets(symbol)')
            .eq('user_id', user.id)
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: false }),
          supabase.from('chart_analyses')
            .select('id, created_at, signal, confidence, entry_price, target_price, stop_loss, timeframe, ai_provider, status, assets(symbol)')
            .eq('user_id', user.id)
            .eq('status', 'completed')
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: false }),
        ]);

        const aiRows = (aiRes.data || []) as AIAnalysis[];
        const chartRows = (chartRes.data || []) as ChartAnalysis[];

        title = `AI Analysis Report — ${period}`;
        reportData = {
          summary: {
            total_ai_analyses: aiRows.length,
            total_chart_analyses: chartRows.length,
            bullish: aiRows.filter(a => a.sentiment === 'bullish').length,
            bearish: aiRows.filter(a => a.sentiment === 'bearish').length,
            neutral: aiRows.filter(a => a.sentiment === 'neutral').length,
            period_start: start,
            period_end: end,
          },
          ai_analyses: aiRows.map(a => ({
            date: a.created_at,
            symbol: (a.assets as { symbol: string } | null)?.symbol || '—',
            sentiment: a.sentiment,
            confidence: a.confidence,
            prediction: a.prediction,
          })),
          chart_analyses: chartRows.map(a => ({
            date: a.created_at,
            symbol: (a.assets as { symbol: string } | null)?.symbol || '—',
            signal: a.signal || '—',
            confidence: a.confidence || 0,
            entry_price: a.entry_price || 0,
            target_price: a.target_price || 0,
            stop_loss: a.stop_loss || 0,
            timeframe: a.timeframe,
            provider: a.ai_provider,
          })),
        };
      } else {
        const [aiRes, signalsRes, mtRes] = await Promise.all([
          supabase.from('ai_analyses').select('id').eq('user_id', user.id).gte('created_at', start).lte('created_at', end),
          supabase.from('signals').select('id, type, confidence').gte('created_at', start).lte('created_at', end),
          supabase.from('metatrader_connections').select('id, platform, symbol, is_active, last_ping_at, last_data_at').eq('user_id', user.id),
        ]);

        title = `Platform Overview — ${period}`;
        const allSignals = (signalsRes.data || []) as Signal[];
        reportData = {
          summary: {
            ai_analyses_run: (aiRes.data || []).length,
            total_signals: allSignals.length,
            buy_signals: allSignals.filter(s => s.type === 'buy').length,
            sell_signals: allSignals.filter(s => s.type === 'sell').length,
            avg_confidence: allSignals.length > 0
              ? Math.round(allSignals.reduce((a, s) => a + s.confidence, 0) / allSignals.length)
              : 0,
            period_start: start,
            period_end: end,
          },
          mt_connections: (mtRes.data || []).map(c => ({
            platform: (c as Record<string, unknown>).platform,
            symbol: (c as Record<string, unknown>).symbol,
            status: (c as Record<string, unknown>).is_active ? 'active' : 'paused',
            last_data: (c as Record<string, unknown>).last_data_at || 'Never',
          })),
        };
      }

      const { data: report, error } = await supabase
        .from('reports')
        .insert({
          user_id: user.id,
          title,
          type: genType,
          period_start: getDateRange().start,
          period_end: getDateRange().end,
          data: reportData,
          format: 'csv',
          status: 'completed',
        })
        .select()
        .maybeSingle();

      if (!error && report) {
        setReports(p => [report as Report, ...p]);
        setMsg({ type: 'success', text: 'Report generated successfully.' });
        downloadCSV(report as Report, reportData, genType);
      } else {
        setMsg({ type: 'error', text: 'Failed to save report.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Failed to generate report.' });
    } finally {
      setGenerating(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const downloadCSV = (report: Report, data: Record<string, unknown>, type: string) => {
    const lines: string[] = [];
    lines.push(`GOLDTRADE AI — ${report.title}`);
    lines.push(`Generated: ${new Date(report.created_at).toLocaleString()}`);
    lines.push('');

    const summary = data.summary as Record<string, unknown>;
    if (summary) {
      lines.push('SUMMARY');
      Object.entries(summary).forEach(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`${label},${v}`);
      });
      lines.push('');
    }

    if (type === 'signals' && Array.isArray(data.signals)) {
      lines.push('SIGNALS');
      lines.push('Date,Type,Symbol,Entry,Target,Stop Loss,Confidence,Timeframe,Status');
      (data.signals as Record<string, unknown>[]).forEach(s => {
        lines.push(`${new Date(s.date as string).toLocaleDateString()},${s.type},${s.symbol},${s.entry},${s.target},${s.stop_loss},${s.confidence}%,${s.timeframe},${s.status}`);
      });
    } else if (type === 'ai_analyses') {
      if (Array.isArray(data.ai_analyses)) {
        lines.push('AI ANALYSES');
        lines.push('Date,Symbol,Sentiment,Confidence,Prediction');
        (data.ai_analyses as Record<string, unknown>[]).forEach(a => {
          lines.push(`${new Date(a.date as string).toLocaleDateString()},${a.symbol},${a.sentiment},${a.confidence}%,"${String(a.prediction).replace(/"/g, '')}"`);
        });
        lines.push('');
      }
      if (Array.isArray(data.chart_analyses)) {
        lines.push('CHART ANALYSES');
        lines.push('Date,Symbol,Signal,Confidence,Entry,Target,Stop Loss,Timeframe,Provider');
        (data.chart_analyses as Record<string, unknown>[]).forEach(a => {
          lines.push(`${new Date(a.date as string).toLocaleDateString()},${a.symbol},${a.signal},${a.confidence}%,${a.entry_price},${a.target_price},${a.stop_loss},${a.timeframe},${a.provider}`);
        });
      }
    } else if (type === 'overview' && Array.isArray(data.mt_connections)) {
      lines.push('METATRADER CONNECTIONS');
      lines.push('Platform,Symbol,Status,Last Data');
      (data.mt_connections as Record<string, unknown>[]).forEach(c => {
        lines.push(`${c.platform},${c.symbol},${c.status},${c.last_data}`);
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goldtrade_${report.type}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadReport = (r: Report) => {
    if (r.data) downloadCSV(r, r.data, r.type);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-amber-400" />Reports
        </h2>
        <p className="text-gray-400 text-sm mt-1">Export real data from your AI analyses and signals</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Analyses Run', value: stats.totalAnalyses, icon: Brain, color: 'text-amber-400' },
            { label: 'Active Signals', value: stats.totalSignals, icon: Zap, color: 'text-amber-400' },
            { label: 'Buy Signals', value: stats.buySignals, icon: TrendingUp, color: 'text-green-400' },
            { label: 'Sell Signals', value: stats.sellSignals, icon: TrendingDown, color: 'text-red-400' },
            { label: 'Avg Confidence', value: stats.avgConfidence > 0 ? `${stats.avgConfidence}%` : '—', icon: Minus, color: 'text-blue-400' },
            { label: 'MT Connections', value: stats.mtConnections, icon: Monitor, color: 'text-green-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <Icon className={`w-4 h-4 ${color} mb-2`} />
              <div className="text-white font-bold text-xl">{value}</div>
              <div className="text-gray-500 text-xs mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-4">Generate Report</h3>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Report Type</label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { value: 'signals', label: 'AI Signals Report', desc: 'All buy/sell signals with entry, target and stop loss', icon: Zap },
                { value: 'ai_analyses', label: 'AI Analysis Report', desc: 'All AI and chart analyses with sentiment and confidence', icon: Brain },
                { value: 'overview', label: 'Platform Overview', desc: 'Summary of all activity and MetaTrader connections', icon: BarChart2 },
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => setGenType(t.value)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    genType === t.value
                      ? 'bg-amber-500/10 border-amber-500/40 text-white'
                      : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:text-white'
                  }`}
                >
                  <t.icon className={`w-4 h-4 flex-shrink-0 ${genType === t.value ? 'text-amber-400' : 'text-gray-500'}`} />
                  <div>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-gray-500">{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Period</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: '7d', label: 'Last 7 Days' },
                { value: '30d', label: 'Last 30 Days' },
                { value: '90d', label: 'Last 90 Days' },
                { value: '1y', label: 'Last Year' },
              ].map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    period === p.value
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-4 bg-gray-800/30 border border-gray-700/30 rounded-xl p-3">
              <p className="text-gray-500 text-xs">
                Reports contain only <span className="text-white font-medium">real data</span> from your actual AI analyses,
                chart uploads, and signals — no sample or placeholder values.
              </p>
            </div>
          </div>
        </div>

        {msg && (
          <div className={`flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl text-sm ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {msg.text}
          </div>
        )}

        <button
          onClick={generateReport}
          disabled={generating}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {generating ? 'Generating...' : 'Generate & Download CSV'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Report History</h3>
          <button
            onClick={() => { fetchReports(); fetchStats(); }}
            className="p-2 text-gray-500 hover:text-white bg-gray-900 border border-gray-700 rounded-xl transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl animate-pulse" />)}
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-white font-medium">No reports yet</p>
            <p className="text-gray-500 text-sm mt-1">Generate your first report above — data comes from your real AI analyses</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 font-medium px-4 py-3">Report</th>
                  <th className="text-left text-gray-500 font-medium px-4 py-3 hidden sm:table-cell">Period</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">Status</th>
                  <th className="text-center text-gray-500 font-medium px-4 py-3">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {reports.map(r => (
                  <tr key={r.id} className="hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <div>
                          <div className="text-white text-xs font-medium">{r.title}</div>
                          <div className="text-gray-500 text-xs flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(r.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">
                      {r.period_start && r.period_end
                        ? `${new Date(r.period_start).toLocaleDateString()} — ${new Date(r.period_end).toLocaleDateString()}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === 'completed' && (
                        <button
                          onClick={() => downloadReport(r)}
                          className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors mx-auto"
                        >
                          <Download className="w-3.5 h-3.5" />CSV
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
