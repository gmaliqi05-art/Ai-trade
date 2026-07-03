// Grafik MT5 me linja Hyrje/SL/TP — lightweight-charts.
// Vizaton qirinjtë dhe linjat horizontale të pozicionit (entry/SL/TP).
// Etiketat e tekstit (SL/TP/Hyrje/Tani) vizatohen si OVERLAY në të MAJTË (jo te boshti i djathtë),
// pa sfond dhe me shkronja ~30% më të vogla — që të mos e mbulojnë lëvizjen e çmimit.
//
// EDIT SL/TP (si MetaTrader 5): çdo pozicion ka një "pilulë" te linja e HYRJES. Vetëm kur e prek
// atë pilulë, AKTIVIZOHET editimi për ATË pozicion → shfaqen dorezat e tërheqshme SL (kuqe) & TP
// (gjelbër). Kështu zoom-i i grafikut s'lëviz kurrë SL/TP pa dashje (asgjë s'tërhiqet pa aktivizim).

import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp, type SeriesMarker, type Time,
} from 'lightweight-charts';

/** Shënjim mbi grafik (hyrje/dalje tregtimi): shigjetë/rreth me tekst te qiriri përkatës. */
export interface ChartMarkerDef {
  time: number; // sekonda UTC (rrumbullakosur te qiriri i periudhës)
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  color: string;
  text?: string;
}

export interface ChartCandle {
  time: number; // sekonda (UTC)
  open: number; high: number; low: number; close: number;
}

export interface PriceLineDef {
  price: number;
  color: string;
  title: string;
}

/** Pozicion i hapur me SL/TP të editueshëm mbi grafik (si te MetaTrader 5). */
export interface EditableSlTp {
  positionId: string;
  entry: number;
  sl: number | null;
  tp: number | null;
  isBuy: boolean;
  defStop?: number; // hapësira default ($) e SL kur s'është vendosur (pikënisje për tërheqje)
  defTake?: number; // hapësira default ($) e TP kur s'është vendosur
}

export default function Mt5Chart({
  candles, lines = [], height = 380, fitKey, maxLineExpand,
  positions = [], activeId = null, onActiveChange, onCommitSlTp, markers = [],
}: {
  candles: ChartCandle[];
  lines?: PriceLineDef[];
  /** Shënjime hyrje/dalje tregtimesh mbi qirinj (shigjeta + rrathë me tekst). */
  markers?: ChartMarkerDef[];
  height?: number;
  /** Kur ndryshon (p.sh. simboli ose periudha), grafiku ri-përshtatet; përndryshe ruan zoom-in manual. */
  fitKey?: string;
  /** Kufi për zgjerimin e shkallës nga linjat Hyrje/SL/TP: maksimumi ±(kaq × diapazoni i qirinjve).
      Pa vlerë = sjellja e vjetër (të gjitha linjat gjithmonë në pamje). Përdore kur TP/SL janë
      shumë larg (p.sh. MMT me R:R 1:4) që qirinjtë të mos shtypen në vijë. */
  maxLineExpand?: number;
  /** Pozicionet e hapura për këtë simbol (secila me pilulë te linja e hyrjes). */
  positions?: EditableSlTp[];
  /** Id-ja e pozicionit aktualisht në modë editimi (SL/TP të tërheqshëm). */
  activeId?: string | null;
  /** Prek pilulën e hyrjes → ndrysho pozicionin aktiv (toggle). */
  onActiveChange?: (id: string | null) => void;
  /** Kur lëshohet tërheqja e SL/TP (commit) — vetëm nëse vlera ndryshoi. */
  onCommitSlTp?: (positionId: string, next: { sl: number | null; tp: number | null }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null); // etiketat e majta (overlay HTML)
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const linePricesRef = useRef<number[]>([]); // çmimet e Hyrje/SL/TP për auto-scale
  const maxExpandRef = useRef<number | undefined>(maxLineExpand);
  maxExpandRef.current = maxLineExpand;
  const lastFitRef = useRef<string | null>(null); // fitKey-i i fundit për të cilin u ri-përshtat
  const labelEls = useRef<{ el: HTMLDivElement; price: number }[]>([]); // etiketat aktive + çmimi i tyre
  const rafRef = useRef<number | null>(null);

  // --- Editimi i SL/TP mbi grafik ---
  const positionsRef = useRef<EditableSlTp[]>(positions);   // të gjitha pozicionet (për pilulat e hyrjes)
  const activeRef = useRef<EditableSlTp | null>(null);      // pozicioni aktiv (i editueshëm)
  const slRef = useRef<number | null>(null);               // draft SL i pozicionit aktiv
  const tpRef = useRef<number | null>(null);               // draft TP i pozicionit aktiv
  const entryEls = useRef<Record<string, HTMLDivElement | null>>({}); // pilula e hyrjes për çdo pozicion
  const slElRef = useRef<HTMLDivElement | null>(null);
  const tpElRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<'sl' | 'tp' | null>(null);
  const movedRef = useRef(false);
  const commitCbRef = useRef(onCommitSlTp);
  useEffect(() => { commitCbRef.current = onCommitSlTp; });

  const active = positions.find(p => p.positionId === activeId) ?? null;
  positionsRef.current = positions;

  // Sinkronizo pozicionin aktiv + draft-in (jashtë tërheqjes).
  useEffect(() => {
    activeRef.current = active;
    if (draggingRef.current == null) {
      slRef.current = active?.sl ?? null;
      tpRef.current = active?.tp ?? null;
    }
  }, [activeId, active?.sl, active?.tp, active?.entry, active?.isBuy]); // eslint-disable-line react-hooks/exhaustive-deps

  const defStop = () => { const e = activeRef.current; if (!e) return null; return e.isBuy ? e.entry - (e.defStop ?? 3) : e.entry + (e.defStop ?? 3); };
  const defTake = () => { const e = activeRef.current; if (!e) return null; return e.isBuy ? e.entry + (e.defTake ?? 6) : e.entry - (e.defTake ?? 6); };

  const onDragMove = useRef((ev: PointerEvent) => {
    const which = draggingRef.current; const s = seriesRef.current; const cont = containerRef.current;
    if (!which || !s || !cont) return;
    ev.preventDefault();
    const price = s.coordinateToPrice(ev.clientY - cont.getBoundingClientRect().top);
    if (price == null) return;
    const p = Math.max(0, Number(price));
    if (which === 'sl') slRef.current = p; else tpRef.current = p;
    movedRef.current = true;
  }).current;

  const onDragUp = useRef((ev: PointerEvent) => {
    if (!draggingRef.current) return;
    ev.preventDefault();
    draggingRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);
    const e = activeRef.current;
    if (movedRef.current && e) commitCbRef.current?.(e.positionId, { sl: slRef.current, tp: tpRef.current });
  }).current;

  const startDrag = (which: 'sl' | 'tp') => (ev: React.PointerEvent) => {
    if (!activeRef.current) return;
    ev.preventDefault(); ev.stopPropagation();
    if (which === 'sl' && slRef.current == null) slRef.current = defStop();
    if (which === 'tp' && tpRef.current == null) tpRef.current = defTake();
    draggingRef.current = which; movedRef.current = false;
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragUp, { passive: false });
    window.addEventListener('pointercancel', onDragUp, { passive: false });
  };

  // Krijo grafikun një herë.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9ca3af', attributionLogo: false },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      // Shtri auto-scale-in që linjat Hyrje/SL/TP të jenë GJITHMONË brenda pamjes.
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const res = original();
        const prices = linePricesRef.current;
        if (!res || prices.length === 0) return res;
        let minValue = res.priceRange.minValue;
        let maxValue = res.priceRange.maxValue;
        for (const p of prices) { if (p < minValue) minValue = p; if (p > maxValue) maxValue = p; }
        // KUFIRI (maxLineExpand): mos i lër linjat e largëta (TP 4R etj.) ta shtypin grafikun —
        // zgjero maksimumi ±(kufi × diapazoni i qirinjve); linjat përtej dalin nga pamja.
        const lim = maxExpandRef.current;
        if (lim != null && Number.isFinite(lim)) {
          const span = (res.priceRange.maxValue - res.priceRange.minValue) || 1;
          minValue = Math.max(minValue, res.priceRange.minValue - span * lim);
          maxValue = Math.min(maxValue, res.priceRange.maxValue + span * lim);
        }
        const pad = (maxValue - minValue) * 0.12 || 1;
        return { ...res, priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const tick = () => {
      const s = seriesRef.current;
      if (s) {
        for (const { el, price } of labelEls.current) {
          const y = s.priceToCoordinate(price);
          if (y == null) { el.style.display = 'none'; } else { el.style.display = ''; el.style.top = `${y}px`; }
        }
        // Pilulat e HYRJES për çdo pozicion (tap → aktivizo editimin).
        for (const p of positionsRef.current) {
          const el = entryEls.current[p.positionId];
          if (!el) continue;
          const y = s.priceToCoordinate(p.entry);
          if (y == null) { el.style.display = 'none'; } else { el.style.display = ''; el.style.top = `${y}px`; }
        }
        // Dorezat e tërheqshme SL/TP — VETËM për pozicionin aktiv.
        const e = activeRef.current;
        const place = (el: HTMLDivElement | null, price: number | null, set: boolean) => {
          if (!el) return;
          if (!e || price == null) { el.style.display = 'none'; return; }
          const y = s.priceToCoordinate(price);
          if (y == null) { el.style.display = 'none'; return; }
          el.style.display = ''; el.style.top = `${y}px`; el.style.opacity = set ? '1' : '0.5';
          const lab = el.querySelector('[data-px]') as HTMLElement | null;
          if (lab) lab.textContent = price.toFixed(2);
        };
        place(slElRef.current, slRef.current ?? defStop(), slRef.current != null);
        place(tpElRef.current, tpRef.current ?? defTake(), tpRef.current != null);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null; seriesRef.current = null; priceLinesRef.current = []; labelEls.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Përditëso qirinjtë. PËR LIVE përdorim series.update() (vetëm qiriri i fundit) — kjo NUK e prek
  // zoom/pan-in. setData() (që rivendos pamjen) thirret VETËM kur ndryshon struktura: simboli/periudha
  // (fitKey), dritarja rrëshqet (koha e parë ndryshon) ose shtohen >1 qirinj njëherësh.
  const dataMetaRef = useRef<{ n: number; first: number; last: number }>({ n: 0, first: 0, last: 0 });
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || candles.length === 0) return;
    const n = candles.length;
    const first = candles[0].time, last = candles[n - 1].time;
    const fitK = fitKey ?? '__static__';
    const m = dataMetaRef.current;
    const structural = lastFitRef.current !== fitK || first !== m.first || n < m.n || (n - m.n) > 1;
    if (structural) {
      s.setData(candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
      if (lastFitRef.current !== fitK) {
        const k = candles.length;
        chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, k - 100), to: k + 3 });
        lastFitRef.current = fitK;
      }
    } else {
      const c = candles[n - 1];
      s.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    dataMetaRef.current = { n, first, last };
  }, [candles, fitKey]);

  // Shënjimet e tregtimeve (hyrje/dalje) — vetëm brenda dritares kohore të qirinjve.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || candles.length === 0) return;
    const t0 = candles[0].time, t1 = candles[candles.length - 1].time;
    const ms: SeriesMarker<Time>[] = markers
      .filter(m => m.time >= t0 && m.time <= t1)
      .sort((a, b) => a.time - b.time)
      .map(m => ({ time: m.time as UTCTimestamp, position: m.position, shape: m.shape, color: m.color, text: m.text, size: 1 }));
    s.setMarkers(ms);
  }, [markers, candles]);

  // Përditëso linjat Hyrje/SL/TP + etiketat e majta.
  useEffect(() => {
    const series = seriesRef.current;
    const overlay = overlayRef.current;
    if (!series || !overlay) return;
    priceLinesRef.current.forEach(pl => series.removePriceLine(pl));
    const valid = lines.filter(l => Number.isFinite(l.price) && l.price > 0);

    priceLinesRef.current = valid.map(l => series.createPriceLine({
      price: l.price, color: l.color, lineWidth: 2, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: '',
    }));

    overlay.replaceChildren();
    labelEls.current = valid.map(l => {
      const el = document.createElement('div');
      el.textContent = l.title;
      el.style.cssText = [
        'position:absolute', 'left:4px', 'transform:translateY(-50%)',
        'font-size:9px', 'font-weight:700', 'line-height:1', 'white-space:nowrap',
        'pointer-events:none', 'letter-spacing:0.1px',
        'text-shadow:0 0 3px #111827,0 0 3px #111827,0 0 4px #111827',
      ].join(';');
      el.style.color = l.color;
      overlay.appendChild(el);
      return { el, price: l.price };
    });

    linePricesRef.current = valid.map(l => l.price);
  }, [lines]);

  return (
    <div ref={containerRef} style={{ height, position: 'relative' }} className="w-full">
      {/* Overlay i etiketave të majta — nuk kap klikime, rri sipër grafikut. */}
      <div ref={overlayRef} className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }} />

      {/* Linja e HYRJES e prekshme për çdo pozicion (gjithë gjerësia) — prek për të hapur/mbyllur
          editimin e SL/TP. Pilula djathtas tregon gjendjen. Prekja kudo te linja e aktivizon. */}
      {positions.map(p => {
        const on = p.positionId === activeId;
        return (
          <div key={p.positionId}
            ref={el => { if (el) entryEls.current[p.positionId] = el; else delete entryEls.current[p.positionId]; }}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => onActiveChange?.(on ? null : p.positionId)}
            className="absolute left-0 right-0 z-30 flex items-center justify-end select-none"
            style={{ height: '26px', display: 'none', transform: 'translateY(-50%)', touchAction: 'none', cursor: 'pointer', pointerEvents: 'auto' }}
            title={on ? 'Mbyll editimin e SL/TP' : 'Prek linjën e hyrjes për të vendosur/lëvizur SL & TP'}>
            <span className={`mr-[60px] flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full shadow-md border ${on ? 'bg-blue-600 text-white border-blue-300 ring-2 ring-blue-300/50' : 'bg-blue-500 text-white border-blue-300/60'}`}>
              {on ? '✓ Mbyll' : '✎ SL/TP'}
            </span>
          </div>
        );
      })}

      {/* Dorezat e tërheqshme SL/TP — shfaqen VETËM kur ka pozicion aktiv (pas prekjes së hyrjes). */}
      {active && (
        <>
          <div ref={slElRef} onPointerDown={startDrag('sl')}
            className="absolute left-0 right-0 z-20 flex items-center select-none"
            style={{ height: '24px', display: 'none', transform: 'translateY(-50%)', touchAction: 'none', cursor: 'ns-resize', pointerEvents: 'auto' }}>
            <div className="w-full" style={{ height: '2px', background: '#ef4444' }} />
            <div className="absolute right-[56px] flex items-center gap-1 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md ring-1 ring-red-300/50">
              ⇅ SL <span data-px>—</span>
            </div>
          </div>
          <div ref={tpElRef} onPointerDown={startDrag('tp')}
            className="absolute left-0 right-0 z-20 flex items-center select-none"
            style={{ height: '24px', display: 'none', transform: 'translateY(-50%)', touchAction: 'none', cursor: 'ns-resize', pointerEvents: 'auto' }}>
            <div className="w-full" style={{ height: '2px', background: '#22c55e' }} />
            <div className="absolute right-[56px] flex items-center gap-1 bg-green-500 text-gray-900 text-[10px] font-bold px-2 py-1 rounded-full shadow-md ring-1 ring-green-300/50">
              ⇅ TP <span data-px>—</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
