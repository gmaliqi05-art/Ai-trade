// MMTI — animacioni i super-robotit të ri: një robot para PC-së duke "shkruar"
// algoritme që rrjedhin në ekran. Vetëm vizuale (s'prek asnjë logjikë tregtimi).
const ALGO_LINES = [
  'expectancy = winRate·avgWin − lossRate·|avgLoss|',
  'profitFactor = Σ wins / |Σ losses|',
  'session[LDN+NY].winRate = 0.90  → boost weight',
  'if conf ≥ 0.80 and ADX ≥ 25 → widen TP ×1.8',
  'kelly* = (winRate·b − lossRate) / b',
  'maximize  E[R]   s.t.  drawdown ≤ k',
  'scalp.expectancy = +$45.50 / trade',
  'sharpe = μ(returns) / σ(returns)',
  'pattern[NY].confidence ↑ → size ×1.25',
  'learn(): w ← w + η · ∇ expectancy',
  'TP* = argmax Σ P(hit) · reward',
  'drop conditions where winRate < 0.45',
];

export default function MmtiRobot({ active = true }: { active?: boolean }) {
  return (
    <div className={`relative h-60 sm:h-64 overflow-hidden ${active ? '' : 'mmti-paused opacity-60'}`}>
      <style>{`
        @keyframes mmtiScroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes mmtiBlink { 0%,90%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
        @keyframes mmtiAntenna { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        @keyframes mmtiFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes mmtiTypeL { 0%,100% { transform: translateY(0); } 50% { transform: translateY(2.5px); } }
        @keyframes mmtiTypeR { 0%,100% { transform: translateY(2.5px); } 50% { transform: translateY(0); } }
        @keyframes mmtiScan { 0% { top: 0; opacity:0; } 50% { opacity:0.5; } 100% { top: 100%; opacity:0; } }
        .mmti-scroll { animation: mmtiScroll 16s linear infinite; }
        .mmti-eye { transform-box: fill-box; transform-origin: center; animation: mmtiBlink 4.5s ease-in-out infinite; }
        .mmti-ant { animation: mmtiAntenna 1.4s ease-in-out infinite; }
        .mmti-bot { animation: mmtiFloat 4s ease-in-out infinite; transform-box: fill-box; }
        .mmti-armL { transform-box: fill-box; transform-origin: top; animation: mmtiTypeL 0.55s ease-in-out infinite; }
        .mmti-armR { transform-box: fill-box; transform-origin: top; animation: mmtiTypeR 0.55s ease-in-out infinite; }
        .mmti-paused * { animation-play-state: paused !important; }
      `}</style>

      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 28%, rgba(245,158,11,0.14), transparent 62%)' }} />

      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[80%] max-w-md">
        <div className="relative rounded-lg border border-amber-500/35 bg-black/85 overflow-hidden shadow-lg shadow-amber-500/10" style={{ height: 116 }}>
          <div className="px-2 py-1 text-[8px] font-mono text-green-400/95 mmti-scroll">
            {[...ALGO_LINES, ...ALGO_LINES].map((l, i) => (
              <div key={i} className="whitespace-nowrap leading-[14px]">{`> ${l}`}</div>
            ))}
          </div>
          <div className="absolute left-0 right-0 h-6 bg-gradient-to-b from-green-400/10 to-transparent" style={{ animation: 'mmtiScan 3.2s linear infinite' }} />
        </div>
        <div className="mx-auto w-9 h-2.5 bg-gray-700/70" />
        <div className="mx-auto w-24 h-1.5 bg-gray-700/70 rounded" />
      </div>

      <svg viewBox="0 0 220 132" className="absolute bottom-1 left-1/2 -translate-x-1/2 w-56 h-32">
        <defs>
          <linearGradient id="mmtiBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a4453" /><stop offset="1" stopColor="#222a36" /></linearGradient>
          <linearGradient id="mmtiHead" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#434d5c" /><stop offset="1" stopColor="#2a323e" /></linearGradient>
        </defs>
        <g className="mmti-bot">
          <path className="mmti-armL" d="M82 74 Q70 92 88 100" stroke="#9aa3b2" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path className="mmti-armR" d="M138 74 Q150 92 132 100" stroke="#9aa3b2" strokeWidth="7" fill="none" strokeLinecap="round" />
          <rect x="76" y="52" width="68" height="48" rx="12" fill="url(#mmtiBody)" stroke="#f59e0b" strokeOpacity="0.4" />
          <rect x="92" y="64" width="36" height="22" rx="4" fill="#0a0e16" />
          <text x="110" y="79" fontSize="10" fill="#f59e0b" textAnchor="middle" fontWeight="bold" fontFamily="monospace">MMTI</text>
          <rect x="103" y="46" width="14" height="8" fill="#6b7280" />
          <rect x="83" y="14" width="54" height="34" rx="11" fill="url(#mmtiHead)" stroke="#f59e0b" strokeOpacity="0.4" />
          <circle className="mmti-eye" cx="99" cy="31" r="5.2" fill="#22d3ee" />
          <circle className="mmti-eye" cx="121" cy="31" r="5.2" fill="#22d3ee" />
          <rect x="100" y="40" width="20" height="3" rx="1.5" fill="#3a4453" />
          <line x1="110" y1="14" x2="110" y2="6" stroke="#6b7280" strokeWidth="2" />
          <circle className="mmti-ant" cx="110" cy="5" r="3" fill="#f59e0b" />
        </g>
        <rect x="64" y="100" width="92" height="12" rx="2.5" fill="#2b3442" stroke="#3a4453" />
        <g fill="#404a59">
          <rect x="69" y="103" width="10" height="2.6" rx="1" /><rect x="83" y="103" width="10" height="2.6" rx="1" />
          <rect x="97" y="103" width="10" height="2.6" rx="1" /><rect x="111" y="103" width="10" height="2.6" rx="1" />
          <rect x="125" y="103" width="10" height="2.6" rx="1" /><rect x="139" y="103" width="10" height="2.6" rx="1" />
          <rect x="84" y="107.5" width="52" height="2.6" rx="1" />
        </g>
      </svg>
    </div>
  );
}
