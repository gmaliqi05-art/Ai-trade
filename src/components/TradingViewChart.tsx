// Grafik real i TradingView (widget zyrtar, falas) për një simbol të platformës.
// Hartëzon simbolet tona te simbolet e TradingView (p.sh. XAUUSD → OANDA:XAUUSD).

import { useEffect, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { TradingView?: any } }

// Simboli i platformës → simboli i TradingView.
const TV_SYMBOLS: Record<string, string> = {
  XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD',
  USOIL: 'TVC:USOIL', WTIUSD: 'TVC:USOIL', UKOIL: 'TVC:UKOIL',
  EURUSD: 'OANDA:EURUSD', GBPUSD: 'OANDA:GBPUSD', USDJPY: 'OANDA:USDJPY',
  USDCHF: 'OANDA:USDCHF', AUDUSD: 'OANDA:AUDUSD', USDCAD: 'OANDA:USDCAD', NZDUSD: 'OANDA:NZDUSD',
  BTCUSD: 'BINANCE:BTCUSDT', ETHUSD: 'BINANCE:ETHUSDT', SOLUSD: 'BINANCE:SOLUSDT',
  BNBUSD: 'BINANCE:BNBUSDT', XRPUSD: 'BINANCE:XRPUSDT',
  US30: 'OANDA:US30USD', NAS100: 'OANDA:NAS100USD', SPX500: 'OANDA:SPX500USD', GER40: 'OANDA:DE30EUR',
  AAPL: 'NASDAQ:AAPL', MSFT: 'NASDAQ:MSFT', TSLA: 'NASDAQ:TSLA',
};

/** Përkthen periudhat tona te intervalet e TradingView. */
const TV_INTERVAL: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D',
};

export function tvSymbolFor(symbol: string): string {
  const s = symbol.toUpperCase();
  if (TV_SYMBOLS[s]) return TV_SYMBOLS[s];
  // Fallback: crypto → Binance USDT; tjetër → OANDA.
  if (s.endsWith('USD')) return `OANDA:${s}`;
  return s;
}

let scriptPromise: Promise<void> | null = null;
function loadTv(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = 'https://s3.tradingview.com/tv.js';
      sc.async = true;
      sc.onload = () => resolve();
      document.head.appendChild(sc);
    });
  }
  return scriptPromise;
}

export default function TradingViewChart({ symbol, timeframe = '1h' }: { symbol: string; timeframe?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef(`tv_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    loadTv().then(() => {
      if (cancelled || !window.TradingView || !ref.current) return;
      ref.current.innerHTML = `<div id="${idRef.current}" style="height:100%;width:100%"></div>`;
      new window.TradingView.widget({
        autosize: true,
        symbol: tvSymbolFor(symbol),
        interval: TV_INTERVAL[timeframe] || '60',
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1',
        locale: 'en',
        backgroundColor: 'rgba(17,24,39,1)',
        hide_side_toolbar: true,
        allow_symbol_change: false,
        container_id: idRef.current,
      });
    });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  return <div ref={ref} className="w-full h-full min-h-[300px]" />;
}
