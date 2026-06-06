// Vizualizim "matrix" live për ProTrade Lab: sfond me shi kodesh + një FEED rreshtash
// realë (sinjale me Hyrje/SL/TP/%, formula matematikore, kalkulime) që rrjedhin lart shpejt,
// plus një robot i vogël që endet me trajektore. Intensifikohet kur analiza është aktive.
import { useEffect, useRef } from 'react';

const DEFAULT_LINES = [
  'XAUUSD BLEJ │ Hyrje 4297.56 │ SL 4292.10 │ TP 4308.90 │ conf 78% │ R:R 1:2',
  'EMA = Çmim·k + EMA₋₁·(1−k)    k = 2/(n+1)',
  'RSI = 100 − 100/(1 + RS)    RS = avgGain / avgLoss',
  'MACD = EMA12 − EMA26    Signal = EMA9(MACD)    Hist = MACD − Signal',
  'ATR = max(H−L, |H−C₋₁|, |L−C₋₁|)    → volatiliteti',
  'ADX = WilderAvg(DX)    DX = 100·|+DI − −DI| / (+DI + −DI)',
  'SL = ATR × 1.5    TP = SL × 2    →    R:R = 1:2',
  'lot = rreziku / (distSL × vlerëPerÇmim)    vpp(ari)=100  vpp(naftë)=1000',
  'Confluence = Σ faktorë / max    →    besueshmëria',
  'Efficiency Ratio = |Δneto| / Σ|Δ|    (Kaufman)',
  'Supertrend = (H+L)/2 ± ATR × 3    Bollinger = SMA20 ± 2σ',
  'USOIL SHIT │ Hyrje 64.82 │ SL 65.71 │ TP 63.04 │ ADX 41 │ RSI 38',
  'EMA200 ↓  &  1h+4h pajtohen SHIT  &  ADX ≥ 25  →  sinjal i vlefshëm',
];
const DEFAULT_TOKENS = ['EMA', 'RSI', 'MACD', 'ADX', 'ATR', 'TP', 'SL', '1:2', 'BUY', 'SELL', 'σ', 'Δ', '∑', 'hit_tp'];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawRobot(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean) {
  const c = on ? '#fbbf24' : '#34d399';
  ctx.save();
  ctx.shadowColor = c; ctx.shadowBlur = on ? 14 : 8;
  ctx.strokeStyle = c; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 13); ctx.stroke();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y - 14, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(6,10,16,0.92)'; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  roundRect(ctx, x - 9, y - 8, 18, 15, 4); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(x - 3.5, y, 1.8, 0, Math.PI * 2); ctx.arc(x + 3.5, y, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function lineColor(t: string): string {
  if (t.includes('│')) return '#fcd34d';   // sinjale (Hyrje/SL/TP) → amber
  if (t.includes('=')) return '#67e8f9';    // formula → cyan
  return '#86efac';                          // kalkulime/rregulla → jeshile
}

export default function IntelligenceMatrix({ lines, tokens, active }: { lines: string[]; tokens: string[]; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const linesRef = useRef<string[]>([]);
  const tokensRef = useRef<string[]>([]);
  activeRef.current = active;
  linesRef.current = lines && lines.length ? lines : DEFAULT_LINES;
  tokensRef.current = tokens && tokens.length ? tokens : DEFAULT_TOKENS;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0, w = 0, h = 0;
    const fs = 12;   // shi
    const lh = 17;   // lartësia e rreshtit të feed-it
    interface Drop { y: number; ch: string; speed: number }
    interface Feed { text: string; y: number; color: string }
    let drops: Drop[] = [];
    let feed: Feed[] = [];
    const robot = { x: 80, y: 30, vx: 1.3, vy: 0.8, trail: [] as { x: number; y: number }[] };

    const pickLine = () => linesRef.current[(Math.random() * linesRef.current.length) | 0] || 'AI';
    const pickChar = () => {
      const t = tokensRef.current;
      const s = t[(Math.random() * t.length) | 0] || 'AI';
      return s[(Math.random() * s.length) | 0] || '0';
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height || 200;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.max(1, Math.floor(w / fs));
      drops = Array.from({ length: cols }, () => ({ y: Math.random() * h, ch: pickChar(), speed: 0.4 + Math.random() * 0.8 }));
      const rows = Math.ceil(h / lh) + 3;
      feed = Array.from({ length: rows }, (_, i) => { const text = pickLine(); return { text, y: h - i * lh, color: lineColor(text) }; });
    };

    const draw = () => {
      const on = activeRef.current;
      ctx.fillStyle = 'rgba(2,6,10,0.22)';
      ctx.fillRect(0, 0, w, h);

      // 1) Sfondi: shi kodesh (i zbehur)
      ctx.font = `${fs}px ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        ctx.fillStyle = on ? 'rgba(245,158,11,0.16)' : 'rgba(52,211,153,0.14)';
        ctx.fillText(d.ch, i * fs, d.y);
        d.y += fs * d.speed * (on ? 1.9 : 1);
        if (d.y > h) { d.y = -fs; d.ch = pickChar(); }
        else if (Math.random() < 0.06) d.ch = pickChar();
      }

      // 2) FEED: rreshta realë (sinjale + formula) që rrjedhin lart, shpejt
      const sp = on ? 2.1 : 1.05;
      ctx.font = `600 ${lh - 4}px ui-monospace, monospace`;
      let bottomY = -Infinity;
      for (const f of feed) bottomY = Math.max(bottomY, f.y);
      for (const f of feed) {
        f.y -= sp;
        // ndriçim sipas pozicionit (më e ndritshme në qendër)
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color; ctx.shadowBlur = on ? 6 : 3;
        ctx.fillText(f.text, 8, f.y);
        ctx.shadowBlur = 0;
      }
      // riciklim: rreshti që del sipër → poshtë, me përmbajtje të re
      for (const f of feed) {
        if (f.y < -lh) {
          bottomY += lh;
          f.y = bottomY;
          f.text = pickLine();
          f.color = lineColor(f.text);
        }
      }

      // 3) Robot + trajektore
      const rs = on ? 1.9 : 1;
      robot.x += robot.vx * rs; robot.y += robot.vy * rs;
      if (robot.x < 12) { robot.x = 12; robot.vx = Math.abs(robot.vx); }
      if (robot.x > w - 12) { robot.x = w - 12; robot.vx = -Math.abs(robot.vx); }
      if (robot.y < 14) { robot.y = 14; robot.vy = Math.abs(robot.vy); }
      if (robot.y > h - 12) { robot.y = h - 12; robot.vy = -Math.abs(robot.vy); }
      if (Math.random() < 0.025) { robot.vx += (Math.random() - 0.5) * 0.7; robot.vy += (Math.random() - 0.5) * 0.7; }
      robot.vx = Math.max(-2.4, Math.min(2.4, robot.vx));
      robot.vy = Math.max(-2.4, Math.min(2.4, robot.vy));
      robot.trail.push({ x: robot.x, y: robot.y });
      if (robot.trail.length > 64) robot.trail.shift();
      ctx.lineWidth = 2;
      for (let i = 1; i < robot.trail.length; i++) {
        const a = i / robot.trail.length;
        ctx.strokeStyle = on ? `rgba(251,191,36,${a * 0.55})` : `rgba(56,189,248,${a * 0.45})`;
        ctx.beginPath();
        ctx.moveTo(robot.trail[i - 1].x, robot.trail[i - 1].y);
        ctx.lineTo(robot.trail[i].x, robot.trail[i].y);
        ctx.stroke();
      }
      drawRobot(ctx, robot.x, robot.y, on);

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block rounded-xl" />;
}
