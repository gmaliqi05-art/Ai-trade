// Grafik MT5 me linja Hyrje/SL/TP — lightweight-charts.
// Vizaton qirinjtë dhe linjat horizontale të pozicionit (entry/SL/TP).
// Etiketat e tekstit (SL/TP/Hyrje/Tani) vizatohen si OVERLAY në të MAJTË (jo te boshti i djathtë),
// pa sfond dhe me shkronja ~30% më të vogla — që të mos e mbulojnë lëvizjen e çmimit.

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

/** Pozicioni i hapur që mund t'i tërhiqen SL/TP-të direkt mbi grafik (si te MetaTrader 5). */
export interface EditableSlTp {
  positionId: string;
  entry: number;
  sl: number | null;
  tp: number | null;
  isBuy: boolean;
  defStop?: number; // hapësira default ($) e SL kur s'është vendosur (pikënisje për tërheqje)
  defTake?: number; // hapësira default ($) e TP kur s'është vendosur
}

export default function Mt5Chart({ candles, lines = [], height = 380, fitKey, editable = null, onDragSlTp, onCommitSlTp }: {
  candles: ChartCandle[];
  lines?: PriceLineDef[];
  height?: number;
  /** Kur ndryshon (p.sh. simboli ose periudha), grafiku ri-përshtatet; përndryshe ruan zoom-in manual. */
  fitKey?: string;
  /** Pozicioni i përzgjedhur me SL/TP të tërheqshëm mbi grafik. */
  editable?: EditableSlTp | null;
  /** Thirret gjatë tërheqjes (live) me vlerat e reja SL/TP. */
  onDragSlTp?: (next: { sl: number | null; tp: number | null }) => void;
  /** Thirret kur lëshohet tërheqja (commit) — vetëm nëse vlera ndryshoi. */
  onCommitSlTp?: (next: { sl: number | null; tp: number | null }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null); // etiketat e majta (overlay HTML)
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const linePricesRef = useRef<number[]>([]); // çmimet e Hyrje/SL/TP për auto-scale
  const lastFitRef = useRef<string | null>(null); // fitKey-i i fundit për të cilin u ri-përshtat
  const labelEls = useRef<{ el: HTMLDivElement; price: number }[]>([]); // etiketat aktive + çmimi i tyre
  const rafRef = useRef<number | null>(null);

  // --- Tërheqja e SL/TP mbi grafik (si MetaTrader 5) ---
  const editRef = useRef<EditableSlTp | null>(null);   // pozicioni aktual i editueshëm
  const slRef = useRef<number | null>(null);           // draft SL (null = pa SL)
  const tpRef = useRef<number | null>(null);           // draft TP
  const slElRef = useRef<HTMLDivElement | null>(null); // doreza/linja e SL
  const tpElRef = useRef<HTMLDivElement | null>(null); // doreza/linja e TP
  const draggingRef = useRef<'sl' | 'tp' | null>(null);
  const movedRef = useRef(false);
  const dragCbRef = useRef(onDragSlTp);
  const commitCbRef = useRef(onCommitSlTp);
  useEffect(() => { dragCbRef.current = onDragSlTp; commitCbRef.current = onCommitSlTp; });

  // Sinkronizo draft-in kur ndryshon pozicioni i editueshëm (jashtë tërheqjes).
  useEffect(() => {
    editRef.current = editable;
    if (draggingRef.current == null) {
      slRef.current = editable?.sl ?? null;
      tpRef.current = editable?.tp ?? null;
    }
  }, [editable?.positionId, editable?.sl, editable?.tp, editable?.isBuy, editable?.entry]); // eslint-disable-line react-hooks/exhaustive-deps

  const defStop = () => { const e = editRef.current; if (!e) return null; return e.isBuy ? e.entry - (e.defStop ?? 3) : e.entry + (e.defStop ?? 3); };
  const defTake = () => { const e = editRef.current; if (!e) return null; return e.isBuy ? e.entry + (e.defTake ?? 6) : e.entry - (e.defTake ?? 6); };

  const onDragMove = useRef((ev: PointerEvent) => {
    const which = draggingRef.current; const s = seriesRef.current; const cont = containerRef.current;
    if (!which || !s || !cont) return;
    ev.preventDefault();
    const rect = cont.getBoundingClientRect();
    const price = s.coordinateToPrice(ev.clientY - rect.top);
    if (price == null) return;
    const p = Math.max(0, Number(price));
    if (which === 'sl') slRef.current = p; else tpRef.current = p;
    movedRef.current = true;
    dragCbRef.current?.({ sl: slRef.current, tp: tpRef.current });
  }).current;

  const onDragUp = useRef((ev: PointerEvent) => {
    if (!draggingRef.current) return;
    ev.preventDefault();
    draggingRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);
    if (movedRef.current) commitCbRef.current?.({ sl: slRef.current, tp: tpRef.current });
  }).current;

  const startDrag = (which: 'sl' | 'tp') => (ev: React.PointerEvent) => {
    if (!editRef.current) return;
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
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
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

    // Riposiziono etiketat e majta në çdo kuadër (ndjek lëvizjen vertikale të shkallës/pan-it).
    const tick = () => {
      const s = seriesRef.current;
      if (s) {
        for (const { el, price } of labelEls.current) {
          const y = s.priceToCoordinate(price);
          if (y == null) { el.style.display = 'none'; }
          else { el.style.display = ''; el.style.top = `${y}px`; }
        }
        // Doreza të tërheqshme SL/TP (si MetaTrader). Vlera aktive = draft; përndryshe vendi default.
        const e = editRef.current;
        const place = (el: HTMLDivElement | null, price: number | null, active: boolean) => {
          if (!el) return;
          if (!e || price == null) { el.style.display = 'none'; return; }
          const y = s.priceToCoordinate(price);
          if (y == null) { el.style.display = 'none'; return; }
          el.style.display = ''; el.style.top = `${y}px`; el.style.opacity = active ? '1' : '0.45';
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

  // Përditëso linjat Hyrje/SL/TP + etiketat e majta.
  useEffect(() => {
    const series = seriesRef.current;
    const overlay = overlayRef.current;
    if (!series || !overlay) return;
    priceLinesRef.current.forEach(pl => series.removePriceLine(pl));
    const valid = lines.filter(l => Number.isFinite(l.price) && l.price > 0);

    // Linjat: vetëm vija me ndërprerje + çmimi te boshti i djathtë (PA tekst titulli te djathta).
    priceLinesRef.current = valid.map(l => series.createPriceLine({
      price: l.price,
      color: l.color,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '', // teksti shkon te overlay-i i majtë, jo te boshti i djathtë
    }));

    // Etiketat: tekst i lirë në të MAJTË, pa sfond, ~30% më i vogël se më parë.
    overlay.replaceChildren();
    labelEls.current = valid.map(l => {
      const el = document.createElement('div');
      el.textContent = l.title;
      el.style.cssText = [
        'position:absolute', 'left:4px', 'transform:translateY(-50%)',
        'font-size:9px', 'font-weight:700', 'line-height:1', 'white-space:nowrap',
        'pointer-events:none', 'letter-spacing:0.1px',
        // pa kuti sfondi — vetëm hije e hollë teksti për lexueshmëri mbi qirinj
        'text-shadow:0 0 3px #111827,0 0 3px #111827,0 0 4px #111827',
      ].join(';');
      el.style.color = l.color;
      overlay.appendChild(el);
      return { el, price: l.price };
    });

    // Ruaj çmimet e linjave për autoscaleInfoProvider (i mban Hyrje/SL/TP brenda pamjes DERISA
    // shkalla është në auto). NUK e rifoçojmë autoScale=true këtu: kjo do ta anulonte zoom-in
    // manual të përdoruesit në çdo përditësim çmimi (≈200ms me streaming) → grafiku "kërcen" mbrapsht.
    linePricesRef.current = valid.map(l => l.price);
  }, [lines]);

  return (
    <div ref={containerRef} style={{ height, position: 'relative' }} className="w-full">
      {/* Overlay i etiketave të majta — nuk kap klikime, rri sipër grafikut. */}
      <div ref={overlayRef} className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }} />

      {/* Doreza të tërheqshme SL/TP (si MetaTrader 5): tërhiqe pilulën lart-poshtë për ta vendosur. */}
      {editable && (
        <>
          <div ref={slElRef} onPointerDown={startDrag('sl')}
            className="absolute left-0 right-0 z-20 flex items-center select-none"
            style={{ height: '22px', display: 'none', transform: 'translateY(-50%)', touchAction: 'none', cursor: 'ns-resize', pointerEvents: 'auto' }}>
            <div className="w-full" style={{ height: '2px', background: '#ef4444' }} />
            <div className="absolute right-1 flex items-center gap-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md">
              SL <span data-px>—</span>
            </div>
          </div>
          <div ref={tpElRef} onPointerDown={startDrag('tp')}
            className="absolute left-0 right-0 z-20 flex items-center select-none"
            style={{ height: '22px', display: 'none', transform: 'translateY(-50%)', touchAction: 'none', cursor: 'ns-resize', pointerEvents: 'auto' }}>
            <div className="w-full" style={{ height: '2px', background: '#22c55e' }} />
            <div className="absolute right-1 flex items-center gap-1 bg-green-500 text-gray-900 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md">
              TP <span data-px>—</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
