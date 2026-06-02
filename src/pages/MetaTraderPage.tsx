import { useState, useEffect, useCallback } from 'react';
import { Monitor, Copy, Check, Loader2, AlertCircle, CheckCircle, Clock, Wifi, WifiOff, Download, Eye, EyeOff, RefreshCw, Trash2, ChevronRight, Terminal, Zap, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import MetaApiPanel from '../components/MetaApiPanel';

interface MTConnection {
  id: string;
  platform: string;
  server: string;
  login: string;
  symbol: string;
  interval_minutes: number;
  is_active: boolean;
  last_ping_at: string | null;
  last_data_at: string | null;
  api_key: string;
  created_at: string;
}

// URL-ja e webhook-ut merret nga projekti i lidhur (env), jo e fiksuar — që EA-ja
// e gjeneruar të dërgojë gjithmonë te databaza e duhur.
const SUPABASE_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mt-webhook`;

function buildEACode(platform: 'mt4' | 'mt5', apiKey: string, symbol: string, intervalMin: number) {
  if (platform === 'mt4') {
    return `//+------------------------------------------------------------------+
//|  GOLDTRADE AI — Expert Advisor MT4                               |
//+------------------------------------------------------------------+
#property copyright "GOLDTRADE AI"
#property version   "1.00"
#property strict

string API_KEY      = "${apiKey}";
string WEBHOOK_URL  = "${SUPABASE_WEBHOOK_URL}";
string SYMBOL_NAME  = "${symbol}";
int    INTERVAL_MIN = ${intervalMin};

datetime g_last_send = 0;

int OnInit() {
   Print("GOLDTRADE AI EA started — ", SYMBOL_NAME, " every ", INTERVAL_MIN, "min");
   return(INIT_SUCCEEDED);
}

void OnTick() {
   if (TimeCurrent() - g_last_send < INTERVAL_MIN * 60) return;
   SendData();
   g_last_send = TimeCurrent();
}

void SendData() {
   string ohlcv = "";
   for (int i = 4; i >= 0; i--) {
      if (i < 4) ohlcv += ",";
      ohlcv += "{";
      ohlcv += "\\"time\\":\\"" + TimeToString(Time[i]) + "\\",";
      ohlcv += "\\"open\\":" + DoubleToStr(Open[i], Digits) + ",";
      ohlcv += "\\"high\\":" + DoubleToStr(High[i], Digits) + ",";
      ohlcv += "\\"low\\":" + DoubleToStr(Low[i], Digits) + ",";
      ohlcv += "\\"close\\":" + DoubleToStr(Close[i], Digits) + ",";
      ohlcv += "\\"volume\\":" + DoubleToStr(Volume[i], 0);
      ohlcv += "}";
   }
   double ma20 = iMA(NULL,0,20,0,MODE_SMA,PRICE_CLOSE,0);
   double ma50 = iMA(NULL,0,50,0,MODE_SMA,PRICE_CLOSE,0);
   double rsi  = iRSI(NULL,0,14,PRICE_CLOSE,0);
   double atr  = iATR(NULL,0,14,0);

   string json = "{";
   json += "\\"symbol\\":\\"" + Symbol() + "\\",";
   json += "\\"timeframe\\":\\"" + IntegerToString(Period()) + "\\",";
   json += "\\"current_price\\":" + DoubleToStr(Close[0],Digits) + ",";
   json += "\\"bid\\":" + DoubleToStr(Bid,Digits) + ",";
   json += "\\"ask\\":" + DoubleToStr(Ask,Digits) + ",";
   json += "\\"ohlcv\\":[" + ohlcv + "],";
   json += "\\"indicators\\":{";
   json += "\\"ma20\\":" + DoubleToStr(ma20,Digits) + ",";
   json += "\\"ma50\\":" + DoubleToStr(ma50,Digits) + ",";
   json += "\\"rsi14\\":" + DoubleToStr(rsi,2) + ",";
   json += "\\"atr14\\":" + DoubleToStr(atr,Digits);
   json += "}}";

   string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + API_KEY + "\\r\\n";
   char post[], result[];
   string result_headers;
   StringToCharArray(json, post);
   int res = WebRequest("POST", WEBHOOK_URL, headers, 5000, post, result, result_headers);
   Print(res == 200 ? "GOLDTRADE AI: Data sent OK" : "GOLDTRADE AI: Error " + IntegerToString(res));
}`;
  }

  return `//+------------------------------------------------------------------+
//|  GOLDTRADE AI — Expert Advisor MT5                               |
//+------------------------------------------------------------------+
#property copyright "GOLDTRADE AI"
#property version   "1.00"

string API_KEY      = "${apiKey}";
string WEBHOOK_URL  = "${SUPABASE_WEBHOOK_URL}";
string SYMBOL_NAME  = "${symbol}";
int    INTERVAL_MIN = ${intervalMin};

datetime g_last_send = 0;

int OnInit() {
   Print("GOLDTRADE AI EA started — ", SYMBOL_NAME, " every ", INTERVAL_MIN, "min");
   return(INIT_SUCCEEDED);
}

void OnTick() {
   if (TimeCurrent() - g_last_send < INTERVAL_MIN * 60) return;
   SendData();
   g_last_send = TimeCurrent();
}

void SendData() {
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(Symbol(), PERIOD_CURRENT, 0, 5, rates);
   if (copied <= 0) return;

   string ohlcv = "";
   for (int i = copied-1; i >= 0; i--) {
      if (i < copied-1) ohlcv += ",";
      ohlcv += "{";
      ohlcv += "\\"time\\":\\"" + TimeToString(rates[i].time) + "\\",";
      ohlcv += "\\"open\\":" + DoubleToString(rates[i].open,_Digits) + ",";
      ohlcv += "\\"high\\":" + DoubleToString(rates[i].high,_Digits) + ",";
      ohlcv += "\\"low\\":" + DoubleToString(rates[i].low,_Digits) + ",";
      ohlcv += "\\"close\\":" + DoubleToString(rates[i].close,_Digits) + ",";
      ohlcv += "\\"volume\\":" + IntegerToString(rates[i].tick_volume);
      ohlcv += "}";
   }

   double ma20 = iMA(Symbol(),PERIOD_CURRENT,20,0,MODE_SMA,PRICE_CLOSE);
   double ma50 = iMA(Symbol(),PERIOD_CURRENT,50,0,MODE_SMA,PRICE_CLOSE);
   double rsi  = iRSI(Symbol(),PERIOD_CURRENT,14,PRICE_CLOSE);
   double atr  = iATR(Symbol(),PERIOD_CURRENT,14);

   string json = "{";
   json += "\\"symbol\\":\\"" + Symbol() + "\\",";
   json += "\\"timeframe\\":\\"" + IntegerToString(Period()) + "\\",";
   json += "\\"current_price\\":" + DoubleToString(SymbolInfoDouble(Symbol(),SYMBOL_BID),_Digits) + ",";
   json += "\\"bid\\":" + DoubleToString(SymbolInfoDouble(Symbol(),SYMBOL_BID),_Digits) + ",";
   json += "\\"ask\\":" + DoubleToString(SymbolInfoDouble(Symbol(),SYMBOL_ASK),_Digits) + ",";
   json += "\\"ohlcv\\":[" + ohlcv + "],";
   json += "\\"indicators\\":{";
   json += "\\"ma20\\":" + DoubleToString(ma20,_Digits) + ",";
   json += "\\"ma50\\":" + DoubleToString(ma50,_Digits) + ",";
   json += "\\"rsi14\\":" + DoubleToString(rsi,2) + ",";
   json += "\\"atr14\\":" + DoubleToString(atr,_Digits);
   json += "}}";

   string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + API_KEY;
   char post[], result[];
   string result_headers;
   StringToCharArray(json, post, 0, StringLen(json));
   int res = WebRequest("POST", WEBHOOK_URL, headers, 5000, post, result, result_headers);
   Print(res == 200 ? "GOLDTRADE AI: Data sent OK" : "GOLDTRADE AI: Error " + IntegerToString(res));
}`;
}

const SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'BTCUSD', 'ETHUSD'];
const INTERVALS = [
  { label: '5 Minutes', value: 5 },
  { label: '15 Minutes', value: 15 },
  { label: '30 Minutes', value: 30 },
  { label: '1 Hour', value: 60 },
  { label: '4 Hours', value: 240 },
  { label: 'Daily', value: 1440 },
];

export default function MetaTraderPage() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<MTConnection[]>([]);
  const [, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [platform, setPlatform] = useState<'MT4' | 'MT5'>('MT4');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [intervalMin, setIntervalMin] = useState(60);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newConnection, setNewConnection] = useState<MTConnection | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('metatrader_connections')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setConnections(data as MTConnection[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const generateApiKey = () =>
    `gt_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}_${Date.now().toString(36)}`;

  const createConnection = async () => {
    if (!user) return;
    setSaving(true);
    const api_key = generateApiKey();
    const { data, error } = await supabase
      .from('metatrader_connections')
      .insert({
        user_id: user.id,
        platform,
        server: `${platform}-auto`,
        login: user.id.slice(0, 8),
        symbol,
        interval_minutes: intervalMin,
        is_active: true,
        api_key,
      })
      .select()
      .maybeSingle();

    if (!error && data) {
      setNewConnection(data as MTConnection);
      await fetchConnections();
      setStep(2);
    } else {
      setMsg({ type: 'error', text: 'Failed to create connection. Please try again.' });
    }
    setSaving(false);
  };

  const toggleConnection = async (c: MTConnection) => {
    await supabase
      .from('metatrader_connections')
      .update({ is_active: !c.is_active })
      .eq('id', c.id);
    setConnections(p => p.map(x => x.id === c.id ? { ...x, is_active: !x.is_active } : x));
  };

  const deleteConnection = async (id: string) => {
    if (!window.confirm('Delete this MetaTrader connection? This cannot be undone.')) return;
    await supabase.from('metatrader_connections').delete().eq('id', id);
    setConnections(p => p.filter(c => c.id !== id));
    if (newConnection?.id === id) setNewConnection(null);
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2500);
  };

  const downloadEA = (conn: MTConnection) => {
    const code = buildEACode(
      conn.platform.toLowerCase() as 'mt4' | 'mt5',
      conn.api_key,
      conn.symbol,
      conn.interval_minutes
    );
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GOLDTRADE_AI_${conn.platform}_${conn.symbol}.mq${conn.platform === 'MT4' ? '4' : '5'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isOnline = (c: MTConnection) => {
    if (!c.last_ping_at || !c.is_active) return false;
    return (Date.now() - new Date(c.last_ping_at).getTime()) < 10 * 60 * 1000;
  };

  const hasConnections = connections.length > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Monitor className="w-6 h-6 text-amber-400" />MetaTrader Connection
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Connect your MT4/MT5 to receive automatic AI trading signals in 3 simple steps
        </p>
      </div>

      {/* Faza 5: auto-trade në cloud via MetaApi (punon edhe me celular) */}
      <MetaApiPanel />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs text-gray-600 uppercase tracking-wide">ose: Expert Advisor (MT5 desktop)</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {!hasConnections || step !== 1 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="flex border-b border-gray-800">
            {[
              { n: 1 as const, label: 'Configure', icon: Zap },
              { n: 2 as const, label: 'Install EA', icon: Download },
              { n: 3 as const, label: 'Connected', icon: CheckCircle },
            ].map(({ n, label, icon: Icon }) => (
              <div
                key={n}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors ${
                  step === n
                    ? 'bg-amber-500/10 text-amber-400 border-b-2 border-amber-500'
                    : step > n
                    ? 'text-green-400'
                    : 'text-gray-500'
                }`}
              >
                {step > n ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{n}</span>
              </div>
            ))}
          </div>

          <div className="p-6">
            {step === 1 && (
              <div className="space-y-5 max-w-lg mx-auto">
                <div>
                  <h3 className="text-white font-semibold text-lg mb-1">Step 1 — Configure your connection</h3>
                  <p className="text-gray-400 text-sm">Choose your MetaTrader version and trading symbol</p>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-2">Platform Version</label>
                  <div className="flex gap-3">
                    {(['MT4', 'MT5'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setPlatform(p)}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border ${
                          platform === p
                            ? 'bg-amber-500 text-gray-950 border-amber-500'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                        }`}
                      >
                        MetaTrader {p.slice(2)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-2">Trading Symbol</label>
                  <div className="grid grid-cols-5 gap-2">
                    {SYMBOLS.map(s => (
                      <button
                        key={s}
                        onClick={() => setSymbol(s)}
                        className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                          symbol === s
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                        }`}
                      >
                        {s.slice(0, 6)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-2">Analysis Interval</label>
                  <div className="grid grid-cols-3 gap-2">
                    {INTERVALS.map(i => (
                      <button
                        key={i.value}
                        onClick={() => setIntervalMin(i.value)}
                        className={`py-2 rounded-xl text-xs font-medium transition-all border ${
                          intervalMin === i.value
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                        }`}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={createConnection}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-bold py-3.5 rounded-xl text-sm transition-all"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  {saving ? 'Creating connection...' : 'Continue — Get API Key'}
                </button>
              </div>
            )}

            {step === 2 && newConnection && (
              <div className="space-y-5 max-w-lg mx-auto">
                <div>
                  <h3 className="text-white font-semibold text-lg mb-1">Step 2 — Install the EA in MetaTrader</h3>
                  <p className="text-gray-400 text-sm">Download and install the Expert Advisor file — it already has your API key pre-configured</p>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-amber-400 text-xs font-semibold">YOUR API KEY</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowKey(showKey === newConnection.id ? null : newConnection.id)}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        {showKey === newConnection.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => copyText(newConnection.api_key, 'key')}
                        className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {copied === 'key' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied === 'key' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="font-mono text-xs text-amber-300 break-all">
                    {showKey === newConnection.id
                      ? newConnection.api_key
                      : newConnection.api_key.slice(0, 10) + '••••••••••••••••••••'}
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => downloadEA(newConnection)}
                    className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold py-3.5 rounded-xl text-sm transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Download {newConnection.platform} EA (.mq{newConnection.platform === 'MT4' ? '4' : '5'}) — Pre-configured
                  </button>

                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
                    <p className="text-white text-xs font-semibold">Installation steps:</p>
                    {[
                      `Open MetaTrader ${newConnection.platform.slice(2)} on your computer`,
                      'Go to: File → Open Data Folder → MQL4 (or MQL5) → Experts',
                      `Copy the downloaded .mq${newConnection.platform === 'MT4' ? '4' : '5'} file into that folder`,
                      'In MetaTrader: press F5 to refresh the Navigator panel',
                      `Drag the EA onto your ${newConnection.symbol} chart`,
                      'In EA settings: tick "Allow live trading" and "Allow DLL imports"',
                      `Go to: Tools → Options → Expert Advisors → Add URL: ${SUPABASE_WEBHOOK_URL}`,
                    ].map((s, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="w-5 h-5 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                        <span className="text-gray-300 text-xs">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(3)}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 font-semibold py-3 rounded-xl text-sm transition-all"
                  >
                    <CheckCircle className="w-4 h-4" />Done — EA is installed
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5 max-w-lg mx-auto text-center">
                <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-xl mb-2">Connection Active</h3>
                  <p className="text-gray-400 text-sm">
                    The EA will send real market data to GOLDTRADE AI every{' '}
                    <span className="text-amber-400 font-medium">{INTERVALS.find(i => i.value === (newConnection?.interval_minutes || intervalMin))?.label?.toLowerCase()}</span>.
                    AI signals will appear automatically in your Signals feed.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'Real OHLCV data', icon: Terminal },
                    { label: 'AI auto-analysis', icon: Zap },
                    { label: 'Live signals', icon: Shield },
                  ].map(({ label, icon: Icon }) => (
                    <div key={label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
                      <Icon className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                      <p className="text-gray-300 text-xs">{label}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setStep(1); setNewConnection(null); }}
                  className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
                >
                  Add another symbol
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-8 text-center">
          <Monitor className="w-14 h-14 text-gray-700 mx-auto mb-4" />
          <h3 className="text-white font-semibold mb-2">No MetaTrader Connections</h3>
          <p className="text-gray-400 text-sm mb-5">Connect your MT4 or MT5 in 3 easy steps to receive automatic AI trading signals</p>
          <button
            onClick={() => setStep(1)}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold px-6 py-3 rounded-xl text-sm transition-all"
          >
            <Zap className="w-4 h-4" />Connect MetaTrader
          </button>
        </div>
      )}

      {hasConnections && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Your Connections</h3>
            <button onClick={fetchConnections} className="p-2 text-gray-500 hover:text-white bg-gray-900 border border-gray-700 rounded-xl transition-all">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            {connections.map(c => {
              const online = isOnline(c);
              const expanded = expandedConnection === c.id;
              return (
                <div key={c.id} className={`bg-gray-900 border rounded-2xl overflow-hidden transition-all ${online ? 'border-green-500/20' : 'border-gray-800'}`}>
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/20 transition-colors"
                    onClick={() => setExpandedConnection(expanded ? null : c.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${online ? 'bg-green-500/10' : 'bg-gray-800'}`}>
                        {online ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-gray-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold text-sm">{c.platform}</span>
                          <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-lg font-medium">{c.symbol}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${online ? 'bg-green-500/15 text-green-400' : 'bg-gray-700/80 text-gray-500'}`}>
                            {online ? 'Live' : c.last_ping_at ? 'Offline' : 'Waiting'}
                          </span>
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          {c.last_ping_at
                            ? `Last ping: ${new Date(c.last_ping_at).toLocaleTimeString()}`
                            : 'No data received yet — install the EA to start'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${expanded ? 'rotate-90' : ''} transition-transform text-gray-500`}>▼</span>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-gray-800 p-4 space-y-4">
                      <div className="grid sm:grid-cols-3 gap-3 text-xs">
                        <div className="bg-gray-800/50 rounded-xl p-3">
                          <div className="text-gray-500 mb-1">Interval</div>
                          <div className="text-white font-medium">{INTERVALS.find(i => i.value === c.interval_minutes)?.label || `${c.interval_minutes}min`}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-xl p-3">
                          <div className="text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Last Data</div>
                          <div className="text-white font-medium">{c.last_data_at ? new Date(c.last_data_at).toLocaleTimeString() : 'No data yet'}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-xl p-3">
                          <div className="text-gray-500 mb-1">Status</div>
                          <div className={`font-medium ${c.is_active ? 'text-green-400' : 'text-gray-400'}`}>{c.is_active ? 'Active' : 'Paused'}</div>
                        </div>
                      </div>

                      <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-400">API Key</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setShowKey(showKey === c.id ? null : c.id)} className="text-gray-500 hover:text-white transition-colors">
                              {showKey === c.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => copyText(c.api_key, c.id)} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                              {copied === c.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {copied === c.id ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        </div>
                        <div className="font-mono text-xs text-gray-300 break-all">
                          {showKey === c.id ? c.api_key : c.api_key.slice(0, 10) + '••••••••••••••••••••'}
                        </div>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => downloadEA(c)}
                          className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                        >
                          <Download className="w-3.5 h-3.5" />Re-download EA
                        </button>
                        <button
                          onClick={() => toggleConnection(c)}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                            c.is_active
                              ? 'bg-gray-800 text-gray-400 hover:text-red-400 border-gray-700'
                              : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/30'
                          }`}
                        >
                          {c.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => deleteConnection(c.id)}
                          className="flex items-center gap-1.5 bg-red-500/5 hover:bg-red-500/10 text-red-400/70 hover:text-red-400 border border-red-500/20 px-3 py-2 rounded-xl text-xs font-medium transition-all ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {step === 1 && (
            <button
              onClick={() => setStep(1)}
              className="mt-3 w-full py-3 rounded-xl border border-dashed border-gray-700 text-gray-500 hover:text-white hover:border-gray-600 text-sm transition-all"
            >
              + Add another symbol
            </button>
          )}
        </div>
      )}
    </div>
  );
}
