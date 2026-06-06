// "Matrix" live visualization for ProTrade Lab: dim code-rain background + a FEED of real
// rows (signals with Entry/SL/TP/conf, math formulas, computations) scrolling up fast, a small
// roaming robot with a trajectory, AND occasional mini-diagrams (line chart / node-network / bars)
// that draw themselves — as if the AI is making connections and analyzing. Text in English.
import { useEffect, useRef } from 'react';

const DEFAULT_LINES = [
  'XAUUSD BUY │ Entry 4297.56 │ SL 4292.10 │ TP 4308.90 │ conf 78% │ R:R 1:2',
  'EMA = Price·k + EMA₋₁·(1−k)    k = 2/(n+1)',
  'RSI = 100 − 100/(1 + RS)    RS = avgGain / avgLoss',
  'MACD = EMA12 − EMA26    Signal = EMA9(MACD)    Hist = MACD − Signal',
  'ATR = max(H−L, |H−C₋₁|, |L−C₋₁|)    → volatility',
  'ADX = WilderAvg(DX)    DX = 100·|+DI − −DI| / (+DI + −DI)',
  'SL = ATR × 1.5  (oil ×2)    TP = SL × 2    →    R:R = 1:2',
  'lot = risk / (slDist × valuePerPrice)',
  'Confluence = Σ factors / max    →    confidence',
  'Efficiency Ratio = |Δnet| / Σ|Δ|    Supertrend = (H+L)/2 ± ATR×3',
  'EMA200 ↓  &  1h+4h agree  &  ADX ≥ 25  →  valid signal',
  'USOIL SELL │ Entry 64.82 │ SL 65.71 │ TP 63.04 │ ADX 41 │ RSI 38',
  'Bollinger = SMA20 ± 2σ    win-rate(ADX≥40) = 72%',
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
  if (t.includes('│')) return '#fcd34d';  // signals (Entry/SL/TP) → amber
  if (t.includes('=')) return '#67e8f9';   // formulas → cyan
  return '#86efac';                          // rules/computations → green
}

type DType = 'line' | 'net' | 'bars';
interface Diagram { type: DType; x: number; y: number; w: number; h: number; age: number; life: number; label: string; pts: number[]; nodes: { x: number; y: number }[]; edges: [number, number][] }

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
    const fs = 12, lh = 17;
    interface Drop { y: number; ch: string; speed: number }
    interface Feed { text: string; y: number; color: string }
    let drops: Drop[] = [];
    let feed: Feed[] = [];
    let diagrams: Diagram[] = [];
    let spawnCD = 90;
    const robot = { x: 80, y: 30, vx: 1.3, vy: 0.8, trail: [] as { x: number; y: number }[] };

    const pickLine = () => linesRef.current[(Math.random() * linesRef.current.length) | 0] || 'AI';
    const pickChar = () => { const t = tokensRef.current; const s = t[(Math.random() * t.length) | 0] || 'AI'; return s[(Math.random() * s.length) | 0] || '0'; };

    const spawnDiagram = () => {
      const types: DType[] = ['line', 'net', 'bars', 'net', 'line'];
      const type = types[(Math.random() * types.length) | 0];
      const dw = 118 + Math.random() * 64, dh = 66 + Math.random() * 26;
      const x = 8 + Math.random() * Math.max(1, w - dw - 16);
      const y = 22 + Math.random() * Math.max(1, h - dh - 30);
      const nodes = Array.from({ length: 6 }, () => ({ x: Math.random(), y: Math.random() }));
      const edges: [number, number][] = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (Math.random() < 0.45) edges.push([i, j]);
      diagrams.push({
        type, x, y, w: dw, h: dh, age: 0, life: 320,
        label: type === 'line' ? 'price scan' : type === 'bars' ? 'win-rate' : 'linking…',
        pts: Array.from({ length: type === 'bars' ? 5 : 12 }, () => 0.15 + Math.random() * 0.8),
        nodes, edges,
      });
    };

    const drawDiagram = (d: Diagram, on: boolean) => {
      const inA = Math.min(1, d.age / 28), outA = Math.min(1, (d.life - d.age) / 45);
      const alpha = Math.max(0, Math.min(inA, outA));
      const prog = Math.min(1, d.age / 80);
      const col = on ? '251,191,36' : '56,189,248';
      const pad = 8;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(2,10,16,0.55)';
      ctx.strokeStyle = `rgba(${col},0.30)`; ctx.lineWidth = 1;
      roundRect(ctx, d.x, d.y, d.w, d.h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(${col},0.85)`; ctx.font = '8px ui-monospace, monospace'; ctx.textBaseline = 'top';
      ctx.fillText(d.label, d.x + pad, d.y + 3);

      if (d.type === 'line') {
        const n = d.pts.length;
        const ix = (i: number) => d.x + pad + (i / (n - 1)) * (d.w - 2 * pad);
        const iy = (v: number) => d.y + d.h - pad - v * (d.h - 2 * pad - 6);
        const dn = Math.max(1, Math.floor(n * prog));
        ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.5;
        ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = on ? 8 : 5;
        ctx.beginPath();
        for (let i = 0; i < dn; i++) { const x = ix(i), y = iy(d.pts[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(${col},0.95)`;
        for (let i = 0; i < dn; i++) { ctx.beginPath(); ctx.arc(ix(i), iy(d.pts[i]), 1.6, 0, Math.PI * 2); ctx.fill(); }
      } else if (d.type === 'bars') {
        const n = d.pts.length, slot = (d.w - 2 * pad) / n;
        for (let i = 0; i < n; i++) {
          const bh = d.pts[i] * (d.h - 2 * pad - 6) * Math.min(1, prog * 1.3);
          ctx.fillStyle = `rgba(${col},${0.55 + d.pts[i] * 0.35})`;
          ctx.fillRect(d.x + pad + i * slot + 1, d.y + d.h - pad - bh, slot - 3, bh);
        }
      } else {
        const nx = (p: { x: number; y: number }) => d.x + pad + p.x * (d.w - 2 * pad);
        const ny = (p: { x: number; y: number }) => d.y + pad + 6 + p.y * (d.h - 2 * pad - 6);
        const de = Math.floor(d.edges.length * prog);
        ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${col},0.5)`;
        for (let e = 0; e < de; e++) { const [a, b] = d.edges[e]; ctx.beginPath(); ctx.moveTo(nx(d.nodes[a]), ny(d.nodes[a])); ctx.lineTo(nx(d.nodes[b]), ny(d.nodes[b])); ctx.stroke(); }
        ctx.fillStyle = `rgba(${col},0.95)`; ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = on ? 6 : 4;
        for (const p of d.nodes) { ctx.beginPath(); ctx.arc(nx(p), ny(p), 2.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.shadowBlur = 0;
      }
      ctx.restore();
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

      // 1) code rain (dim)
      ctx.font = `${fs}px ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        ctx.fillStyle = on ? 'rgba(245,158,11,0.15)' : 'rgba(52,211,153,0.13)';
        ctx.fillText(d.ch, i * fs, d.y);
        d.y += fs * d.speed * (on ? 1.9 : 1);
        if (d.y > h) { d.y = -fs; d.ch = pickChar(); }
        else if (Math.random() < 0.06) d.ch = pickChar();
      }

      // 2) FEED rows (signals + formulas) scrolling up
      const sp = on ? 2.1 : 1.05;
      ctx.font = `600 ${lh - 4}px ui-monospace, monospace`;
      let bottomY = -Infinity;
      for (const f of feed) bottomY = Math.max(bottomY, f.y);
      for (const f of feed) {
        f.y -= sp;
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color; ctx.shadowBlur = on ? 6 : 3;
        ctx.fillText(f.text, 8, f.y);
        ctx.shadowBlur = 0;
      }
      for (const f of feed) {
        if (f.y < -lh) { bottomY += lh; f.y = bottomY; f.text = pickLine(); f.color = lineColor(f.text); }
      }

      // 3) occasional diagrams (drawing connections / analysis)
      spawnCD--;
      if (spawnCD <= 0 && diagrams.length < 2) { spawnDiagram(); spawnCD = (on ? 150 : 260) + Math.random() * 300; }
      for (const d of diagrams) { d.age++; drawDiagram(d, on); }
      diagrams = diagrams.filter((d) => d.age < d.life);

      // 4) robot + trajectory
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
        ctx.beginPath(); ctx.moveTo(robot.trail[i - 1].x, robot.trail[i - 1].y); ctx.lineTo(robot.trail[i].x, robot.trail[i].y); ctx.stroke();
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
