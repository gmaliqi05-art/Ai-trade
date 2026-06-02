import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Image as ImageIcon, Brain, Zap, TrendingUp, TrendingDown, Minus, Clock, Target, Shield, ChevronDown, RefreshCw, CheckCircle, AlertCircle, Loader2, X, Camera } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  model: string;
  is_active: boolean;
  is_default: boolean;
}

interface ChartAnalysis {
  id: string;
  source: string;
  ai_provider: string;
  chart_image_url: string | null;
  chart_type: string;
  timeframe: string;
  signal: string | null;
  confidence: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  analysis_text: string | null;
  reasoning: string | null;
  status: string;
  created_at: string;
  assets: { symbol: string; name: string } | null;
}

interface Asset {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
}

const TIMEFRAMES = ['1M', '5M', '15M', '30M', '1H', '4H', '1D', '1W'];
const CHART_TYPES = ['candlestick', 'line', 'bar', 'heikin_ashi'];

export default function ChartAnalysisPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [analyses, setAnalyses] = useState<ChartAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [current, setCurrent] = useState<ChartAnalysis | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [selectedAsset, setSelectedAsset] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1H');
  const [selectedChartType, setSelectedChartType] = useState('candlestick');
  const [uploadError, setUploadError] = useState('');

  const fetchData = useCallback(async () => {
    const [ar, pr, anr] = await Promise.all([
      supabase.from('assets').select('id, symbol, name, current_price').order('symbol'),
      supabase.from('ai_providers').select('id, name, slug, model, is_active, is_default').eq('is_active', true).order('priority'),
      user ? supabase.from('chart_analyses').select('*, assets(symbol, name)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    ]);
    if (ar.data) { setAssets(ar.data); if (ar.data.length > 0) setSelectedAsset(ar.data.find(a => a.symbol === 'XAUUSD')?.id || ar.data[0].id); }
    if (pr.data && pr.data.length > 0) {
      setProviders(pr.data as AIProvider[]);
      const def = pr.data.find(p => p.is_default) || pr.data[0];
      setSelectedProvider(def.slug);
    }
    if (anr.data) setAnalyses(anr.data as ChartAnalysis[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileSelect = (file: File) => {
    if (!file.type.match(/^image\/(png|jpe?g|webp|tiff?)$/i)) {
      setUploadError('Formate të mbështetura: PNG, JPG, WebP, TIFF');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Madhësia maksimale: 10MB');
      return;
    }
    setUploadError('');
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleAnalyze = async () => {
    if (!user || !imageFile || !selectedAsset) return;
    setAnalyzing(true);
    setCurrent(null);
    setUploadError('');

    try {
      setAnalysisStep('Po ngarkohet imazhi i grafikut...');
      const ext = imageFile.name.split('.').pop();
      const path = `chart_analyses/${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('charts').upload(path, imageFile, { contentType: imageFile.type });

      let chartImageUrl: string | null = null;
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('charts').getPublicUrl(path);
        chartImageUrl = urlData.publicUrl;
      }

      setAnalysisStep('Po krijohet regjistri i analizës...');
      const { data: record, error: recErr } = await supabase.from('chart_analyses').insert({
        user_id: user.id,
        asset_id: selectedAsset || null,
        source: 'manual',
        ai_provider: selectedProvider,
        chart_image_url: chartImageUrl,
        chart_type: selectedChartType,
        timeframe: selectedTimeframe,
        status: 'processing',
      }).select('*, assets(symbol, name)').maybeSingle();

      if (recErr || !record) throw new Error('Krijimi i regjistrit dështoi');

      setAnalysisStep('Po dërgohet te AI për analizë...');
      const base64 = imagePreview!.split(',')[1];
      const asset = assets.find(a => a.id === selectedAsset);

      const { data: result, error: fnErr } = await supabase.functions.invoke('analyze-chart', {
        body: {
          imageBase64: base64,
          imageType: imageFile.type,
          provider: selectedProvider,
          assetSymbol: asset?.symbol || 'XAUUSD',
          timeframe: selectedTimeframe,
          chartType: selectedChartType,
          currentPrice: asset?.current_price,
        },
      });

      setAnalysisStep('Po përpunohen rezultatet...');

      if (fnErr || !result) {
        await supabase.from('chart_analyses').update({
          status: 'failed',
          analysis_text: 'Analiza dështoi. Sigurohu që një provider AI është konfiguruar te paneli Admin.',
        }).eq('id', record.id);

        const failed = { ...record, status: 'failed', analysis_text: 'Analiza dështoi. Konfiguro një çelës API te Admin → AI Providers.' } as ChartAnalysis;
        setCurrent(failed);
        setAnalyses(p => [failed, ...p.slice(0, 19)]);
        return;
      }

      const updated = await supabase.from('chart_analyses').update({
        signal: result.signal,
        confidence: result.confidence,
        entry_price: result.entry_price,
        target_price: result.target_price,
        stop_loss: result.stop_loss,
        analysis_text: result.analysis_text,
        reasoning: result.reasoning,
        raw_response: result.raw_response,
        status: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', record.id).select('*, assets(symbol, name)').maybeSingle();

      if (updated.data) {
        setCurrent(updated.data as ChartAnalysis);
        setAnalyses(p => [updated.data as ChartAnalysis, ...p.slice(0, 19)]);

        if (user) {
          await supabase.from('notifications').insert({
            user_id: user.id,
            type: 'analysis_complete',
            title: `Analiza përfundoi — ${asset?.symbol || 'Grafik'}`,
            body: `Sinjal ${result.signal} me ${result.confidence}% besueshmëri. Hyrje: ${result.entry_price}`,
            data: { analysis_id: record.id, signal: result.signal },
          });
        }
      }
    } catch {
      setUploadError('Analiza dështoi. Provo përsëri.');
    } finally {
      setAnalyzing(false);
      setAnalysisStep('');
    }
  };

  const signalColor = (s: string | null) => {
    if (!s) return 'text-gray-400';
    if (s === 'BUY') return 'text-green-400';
    if (s === 'SELL') return 'text-red-400';
    return 'text-amber-400';
  };

  const signalBg = (s: string | null) => {
    if (!s) return 'bg-gray-700/50 border-gray-600';
    if (s === 'BUY') return 'bg-green-500/15 border-green-500/40';
    if (s === 'SELL') return 'bg-red-500/15 border-red-500/40';
    return 'bg-amber-500/15 border-amber-500/40';
  };

  const SignalIcon = ({ s }: { s: string | null }) => {
    if (s === 'BUY') return <TrendingUp className="w-5 h-5 text-green-400" />;
    if (s === 'SELL') return <TrendingDown className="w-5 h-5 text-red-400" />;
    return <Minus className="w-5 h-5 text-amber-400" />;
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-amber-400" />Analizë grafiku me AI
        </h2>
        <p className="text-gray-400 text-sm mt-1">Ngarko një foto grafiku për analizë teknike të menjëhershme me AI</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !imagePreview && fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
              dragOver ? 'border-amber-400 bg-amber-500/5' :
              imagePreview ? 'border-gray-700 cursor-default' :
              'border-gray-700 hover:border-gray-600 hover:bg-gray-800/20'
            }`}
          >
            {imagePreview ? (
              <div className="relative">
                <img src={imagePreview} alt="Chart preview" className="w-full rounded-2xl max-h-64 object-contain bg-gray-900" />
                <button
                  onClick={(e) => { e.stopPropagation(); setImagePreview(null); setImageFile(null); setCurrent(null); }}
                  className="absolute top-2 right-2 p-1.5 bg-gray-900/80 rounded-lg text-gray-400 hover:text-white border border-gray-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-3">
                  <Upload className="w-7 h-7 text-amber-400" />
                </div>
                <p className="text-white font-medium mb-1">Lësho grafikun këtu ose kliko për të ngarkuar</p>
                <p className="text-gray-500 text-xs">PNG, JPG, WebP, TIFF — maks 10MB</p>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/tiff" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />

          {uploadError && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{uploadError}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">Cilësimet e analizës</h3>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Aktivi / Simboli</label>
              <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                {assets.map(a => <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Periudha</label>
                <div className="relative">
                  <select value={selectedTimeframe} onChange={e => setSelectedTimeframe(e.target.value)} className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 pr-8">
                    {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Lloji i grafikut</label>
                <div className="relative">
                  <select value={selectedChartType} onChange={e => setSelectedChartType(e.target.value)} className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 pr-8 capitalize">
                    {CHART_TYPES.map(ct => <option key={ct} value={ct} className="capitalize">{ct.replace('_', ' ')}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                </div>
              </div>
            </div>

            {providers.length > 0 && (
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Provider AI</label>
                <div className="grid gap-2">
                  {providers.map(p => (
                    <button key={p.slug} onClick={() => setSelectedProvider(p.slug)} className={`flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition-all ${selectedProvider === p.slug ? 'bg-amber-500/10 border-amber-500/40 text-amber-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {(p.slug === 'groq' || p.slug === 'gemini') && (
                          <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-md font-semibold">FREE</span>
                        )}
                      </div>
                      <span className="text-xs opacity-60 truncate max-w-[100px]">{p.model}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {providers.length === 0 && !loading && (
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                Asnjë provider AI aktiv. Shko te Admin → AI Providers dhe aktivizo Anthropic (ose tjetër) duke shtuar një çelës API.
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!imageFile || analyzing || !selectedAsset}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-bold py-3 rounded-xl text-sm transition-all"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              {analyzing ? analysisStep || 'Po analizohet...' : 'Analizo grafikun'}
            </button>

            <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl text-sm transition-all border border-gray-700">
              <Camera className="w-4 h-4" />Ngarko grafik tjetër
            </button>
          </div>

          {analyses.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4 text-amber-400" />Analizat e fundit</h3>
                <button onClick={fetchData} className="p-1 text-gray-500 hover:text-white transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              <div className="space-y-2">
                {analyses.map(a => (
                  <button key={a.id} onClick={() => setCurrent(a)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${current?.id === a.id ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-1.5 h-6 rounded-full ${a.signal === 'BUY' ? 'bg-green-400' : a.signal === 'SELL' ? 'bg-red-400' : 'bg-amber-400'}`} />
                      <div>
                        <div className="text-white text-xs font-medium">{a.assets?.symbol || 'Grafik'} — {a.timeframe}</div>
                        <div className="text-gray-500 text-xs">{new Date(a.created_at).toLocaleDateString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {a.status === 'completed' ? (
                        <>
                          <div className={`text-xs font-bold ${signalColor(a.signal)}`}>{a.signal || '—'}</div>
                          <div className="text-amber-400 text-xs">{a.confidence?.toFixed(0)}%</div>
                        </>
                      ) : a.status === 'processing' ? (
                        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                      ) : a.status === 'failed' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          {analyzing ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl h-full flex flex-col items-center justify-center py-20 gap-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-4 border-amber-500/20 flex items-center justify-center">
                  <Brain className="w-10 h-10 text-amber-400" />
                </div>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-amber-500 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-lg">Analiza AI në vazhdim</p>
                <p className="text-amber-400 text-sm mt-2 animate-pulse">{analysisStep || 'Po përpunohet grafiku...'}</p>
              </div>
              <div className="flex gap-2">
                {['Po dallon modelet', 'Po identifikon nivelet', 'Po gjeneron sinjalin'].map((s, i) => (
                  <div key={s} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${i === 0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                    {i === 0 && <CheckCircle className="w-3 h-3" />}
                    {s}
                  </div>
                ))}
              </div>
            </div>
          ) : current ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {current.chart_image_url && (
                <div className="border-b border-gray-800">
                  <img src={current.chart_image_url} alt="Analyzed chart" className="w-full max-h-56 object-contain bg-gray-950" />
                </div>
              )}
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-bold text-xl">{current.assets?.symbol || 'Chart Analysis'}</h3>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-lg">{current.timeframe}</span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-lg capitalize">{current.chart_type}</span>
                    </div>
                    <div className="text-gray-500 text-xs mt-1">{new Date(current.created_at).toLocaleString()} via {current.ai_provider}</div>
                  </div>
                  {current.status === 'completed' && (
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${signalBg(current.signal)}`}>
                        <SignalIcon s={current.signal} />
                        <span className={`text-lg font-black ${signalColor(current.signal)}`}>{current.signal || '—'}</span>
                      </div>
                      {current.confidence !== null && (
                        <div className="text-center bg-gray-800 rounded-xl px-3 py-2 border border-gray-700">
                          <div className="text-amber-400 text-xl font-black">{current.confidence.toFixed(0)}%</div>
                          <div className="text-gray-500 text-xs">besueshmëri</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {current.status === 'failed' ? (
                  <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-400 font-medium text-sm">Analiza dështoi</p>
                      <p className="text-red-400/70 text-xs mt-1">{current.analysis_text}</p>
                    </div>
                  </div>
                ) : current.status === 'completed' && (
                  <>
                    {(current.entry_price || current.target_price || current.stop_loss) && (
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Hyrje', value: current.entry_price, icon: Zap, cls: 'bg-gray-800/50 border-gray-700', vCls: 'text-white' },
                          { label: 'Objektiv', value: current.target_price, icon: Target, cls: 'bg-green-500/10 border-green-500/20', vCls: 'text-green-400' },
                          { label: 'Stop Loss', value: current.stop_loss, icon: Shield, cls: 'bg-red-500/10 border-red-500/20', vCls: 'text-red-400' },
                        ].map(item => {
                          const Icon = item.icon;
                          return (
                            <div key={item.label} className={`${item.cls} border rounded-xl p-3 text-center`}>
                              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1.5">
                                <Icon className="w-3 h-3" />{item.label}
                              </div>
                              <div className={`${item.vCls} font-bold text-sm`}>
                                {item.value ? item.value.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {current.analysis_text && (
                      <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4">
                        <h4 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                          <Brain className="w-4 h-4 text-amber-400" />Analiza teknike
                        </h4>
                        <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{current.analysis_text}</p>
                      </div>
                    )}

                    {current.reasoning && (
                      <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
                        <h4 className="text-amber-400 font-semibold text-sm mb-2 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />Arsyetimi i sinjalit
                        </h4>
                        <p className="text-gray-300 text-sm leading-relaxed">{current.reasoning}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-center gap-3 text-xs text-gray-500 pt-1 border-t border-gray-800">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Analizuar më {new Date(current.created_at).toLocaleString('sq-AL')}</span>
                  <span className="ml-auto capitalize bg-gray-800 px-2 py-0.5 rounded-lg">ngarkim {current.source}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl h-full flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-20 h-20 bg-amber-500/10 rounded-2xl flex items-center justify-center">
                <Brain className="w-10 h-10 text-amber-400/60" />
              </div>
              <div className="text-center">
                <h3 className="text-white font-semibold text-lg">Ngarko një grafik për analizë</h3>
                <p className="text-gray-500 text-sm mt-2 max-w-xs">Bëj një foto të grafikut nga MT4/MT5 ose çdo platformë tjetër dhe ngarkoje për analizë të menjëhershme me AI</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-2">
                {['Njohje modelesh', 'Mbështetje & Rezistencë', 'Gjenerim sinjali'].map(f => (
                  <div key={f} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
                    <CheckCircle className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                    <p className="text-gray-400 text-xs">{f}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
