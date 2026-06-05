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

export default function Mt5Chart({ candles, lines = [], height = 380 }: {
  candles: ChartCandle[];
  lines?: PriceLineDef[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const linePricesRef = useRef<number[]>([]); // çmimet e Hyrje/SL/TP për auto-scale

  // Krijo grafikun një herë.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9ca3af', attributionLogo: false },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
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
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

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
