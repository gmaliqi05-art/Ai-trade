// Vizualizim "matrix" live për ProTrade Lab — kodet/numrat REALË të analizës bien si shi,
// dhe një robot i vogël endet duke lënë trajektore. Intensifikohet kur analiza është aktive.
import { useEffect, useRef } from 'react';

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
  // antenë
  ctx.strokeStyle = c; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 13); ctx.stroke();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y - 14, 2, 0, Math.PI * 2); ctx.fill();
  // koka
  ctx.fillStyle = 'rgba(6,10,16,0.92)'; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  roundRect(ctx, x - 9, y - 8, 18, 15, 4); ctx.fill(); ctx.stroke();
  // sytë
  ctx.shadowBlur = 0; ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(x - 3.5, y, 1.8, 0, Math.PI * 2); ctx.arc(x + 3.5, y, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export default function IntelligenceMatrix({ tokens, active }: { tokens: string[]; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const tokensRef = useRef<string[]>([]);
  activeRef.current = active;
  tokensRef.current = tokens && tokens.length
    ? tokens
    : ['EMA200', 'RSI', 'MACD', 'ADX', 'ATR', 'Supertrend', 'BUY', 'SELL', 'confluence', 'EMA9>EMA21', 'D1', 'hit_tp'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0, h = 0;
    const fontSize = 13;
    interface Drop { y: number; token: string; ci: number; speed: number }
    let drops: Drop[] = [];
    const robot = { x: 60, y: 40, vx: 1.3, vy: 0.9, trail: [] as { x: number; y: number }[] };

    const pick = () => { const t = tokensRef.current; return t[(Math.random() * t.length) | 0] || 'AI'; };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height || 200;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.max(1, Math.floor(w / fontSize));
      drops = Array.from({ length: cols }, () => ({ y: Math.random() * h, token: pick(), ci: 0, speed: 0.45 + Math.random() * 0.9 }));
    };

    const draw = () => {
      const on = activeRef.current;
      // fade për gjurmën (efekt matrix)
      ctx.fillStyle = 'rgba(2,6,10,0.14)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize}px ui-monospace, monospace`;
      ctx.textBaseline = 'top';

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const ch = d.token[d.ci] || ' ';
        const x = i * fontSize;
        // koka e rrymës ndriçon; pjesa tjetër jeshile e zbehur
        ctx.fillStyle = on ? 'rgba(251,191,36,0.95)' : 'rgba(190,255,210,0.92)';
        ctx.fillText(ch, x, d.y);
        ctx.fillStyle = on ? 'rgba(245,158,11,0.35)' : 'rgba(52,211,153,0.30)';
        ctx.fillText(d.token[(d.ci + 2) % d.token.length] || ' ', x, d.y - fontSize * 2);

        d.ci++;
        if (d.ci >= d.token.length) { d.ci = 0; d.token = pick(); }
        d.y += fontSize * d.speed * (on ? 1.9 : 1);
        if (d.y > h) { d.y = -fontSize; d.token = pick(); }
      }

      // robot + trajektore
      const sp = on ? 1.9 : 1;
      robot.x += robot.vx * sp; robot.y += robot.vy * sp;
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
        ctx.strokeStyle = on ? `rgba(251,191,36,${a * 0.6})` : `rgba(56,189,248,${a * 0.5})`;
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
