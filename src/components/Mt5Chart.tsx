// Grafik MT5 me linja Hyrje/SL/TP — lightweight-charts.
// Vizaton qirinjtë dhe linjat horizontale të pozicionit (entry/SL/TP).

import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartCandle {
  time: number; // sekonda (UTC)
  open: number; high: number; low: number; close: number;
}

export interface PriceLineDef {
  price: number;
  color: string;
  title: string;
}

export default function Mt5Chart({ candles, lines = [], height = 380, fitKey }: {
  candles: ChartCandle[];
  lines?: PriceLineDef[];
  height?: number;
  /** Kur ndryshon (p.sh. simboli ose periudha), grafiku ri-përshtatet; përndryshe ruan zoom-in manual. */
  fitKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const linePricesRef = useRef<number[]>([]); // çmimet e Hyrje/SL/TP për auto-scale
  const lastFitRef = useRef<string | null>(null); // fitKey-i i fundit për të cilin u ri-përshtat

  // Krijo grafikun një herë.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9ca3af', attributionLogo: false },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      rightPriceScale: { borderColor: '#374151' },
      // rightOffset: lë hapësirë mes qiririt të fundit dhe boshtit të çmimit (qiriri NUK futet nën etiketat).
      // lockVisibleTimeRangeOnResize: ruan pamjen kur ndryshon madhësia.
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      // Shtri auto-scale-in që linjat Hyrje/SL/TP të jenë GJITHMONË brenda pamjes
      // (me pak hapësirë sipër/poshtë) — që mos të dalin jashtë gjatë lëvizjes së çmimit.
      autoscaleInfoProvider: (original) => {
        const res = original();
        const prices = linePricesRef.current;
        if (!res || prices.length === 0) return res;
        let minValue = res.priceRange.minValue;
        let maxValue = res.priceRange.maxValue;
        for (const p of prices) {
          if (p < minValue) minValue = p;
          if (p > maxValue) maxValue = p;
        }
        const pad = (maxValue - minValue) * 0.12 || 1; // ~12% hapësirë → linjat rrinë drejt mesit
        return { ...res, priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; priceLinesRef.current = []; };
  }, []);

  // Përditëso të dhënat e qirinjve.
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;
    seriesRef.current.setData(
      candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    // Ri-përshtat VETËM kur ndryshon simboli/periudha (fitKey). Përndryshe ruaj zoom/pan-in manual
    // të përdoruesit — grafiku nuk kërcen vetë te çdo përditësim çmimi.
    const key = fitKey ?? '__static__';
    if (lastFitRef.current !== key) {
      // Trego një dritare të lexueshme të qirinjve të fundit me një hapësirë të vogël në të djathtë
      // (qiriri i fundit NUK ngjitet te boshti) dhe çmimi i fundit mbetet i dukshëm.
      const n = candles.length;
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 100), to: n + 3 });
      lastFitRef.current = key;
    }
  }, [candles, fitKey]);

  // Përditëso linjat Hyrje/SL/TP.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach(pl => series.removePriceLine(pl));
    const valid = lines.filter(l => Number.isFinite(l.price) && l.price > 0);
    priceLinesRef.current = valid.map(l => series.createPriceLine({
      price: l.price,
      color: l.color,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: l.title,
    }));
    // Ruaj çmimet dhe forco rillogaritjen e shkallës që linjat të jenë brenda pamjes.
    linePricesRef.current = valid.map(l => l.price);
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
  }, [lines]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
