// MMTI — Faza B: Motori i Optimizimit.
// Merr statistikat REALE të trade-ve (nga lab-trades) dhe nxjerr një PLAN të optimizuar:
// sesioni/strategjia/simboli më fitimprurës + R:R i synuar (fito më shumë se roboti normal),
// të bazuar te win-rate-i real. Deterministik dhe i shpjegueshëm — pa "magji".
// VETËM llogarit & rekomandon. NUK tregton dhe NUK prek robotin aktual.

export interface TIStat {
  n: number; wins: number; losses: number; winRate: number; net: number;
  avgWin: number; avgLoss: number; expectancy: number; profitFactor: number;
}
export interface TIGroup extends TIStat { label: string }
export interface TradeIntelLite {
  total: number;
  overall: TIStat;
  bySession: TIGroup[];
  byStrategy: TIGroup[];
  bySymbol: TIGroup[];
}

export interface OptiPick { label: string; winRate: number; expectancy: number; n: number }
export interface OptimizedPlan {
  generatedAt: string;
  sample: number;
  mature: boolean;                       // ≥100 trade → besueshmëri e plotë
  reliability: 'low' | 'medium' | 'high';
  bestSession: OptiPick | null;
  bestStrategy: OptiPick | null;
  bestSymbol: OptiPick | null;
  baseWinRate: number;                   // win-rate i përdorur për projeksion (%)
  currentR: number;                      // R:R i vërejtur (avgWin/|avgLoss|)
  recommendedR: number;                  // R:R i synuar (output)
  slUsd: number;                         // SL bazë ($ lëvizje) për scalp ari
  tpUsd: number;                         // = slUsd × recommendedR
  projNewPerTrade: number;               // $ expectancy/trade i projektuar (R i ri, lot bazë)
  projOldPerTrade: number;               // $ expectancy/trade me R-në aktuale (1:2)
  improvementPct: number;                // përmirësimi % i expectancy-së
  minConfidence: number;                 // pragu i besueshmërisë i rekomanduar
  rules: string[];                       // "algoritmi" i nxjerrë, njerëzisht i lexueshëm
  caution: string;
}

// Beso vetëm grupet me mostër të mjaftueshme (mostra të vogla = rastësi).
const MIN_GROUP_N = 10;

// MMTI është ndërtuar VETËM për arin — fokusi i simbolit s'duhet të dalë kurrë te crypto/naftë.
function isGoldSymbol(label: string): boolean {
  return /XAU|GOLD/i.test((label || "").toUpperCase());
}

function pickBest(groups: TIGroup[]): OptiPick | null {
  const eligible = groups.filter((g) => g.n >= MIN_GROUP_N);
  const pool = eligible.length ? eligible : groups.slice();
  if (!pool.length) return null;
  // Më fitimprurësi sipas expectancy-së (jo vetëm net-i total, që mund të jetë nga vëllimi).
  const top = [...pool].sort((a, b) => b.expectancy - a.expectancy)[0];
  // MOS rekomando një dimension që HUMB para (përndryshe zgjedh "humbësin më të vogël").
  if (!(top.expectancy > 0)) return null;
  return { label: top.label, winRate: top.winRate, expectancy: top.expectancy, n: top.n };
}

// Zgjedh R:R-në më të madhe që win-rate-i real e mban statistikisht pozitive (me marzh sigurie).
// breakeven(R) = 1/(1+R). Kërkojmë winRate ≥ breakeven + marzh (rritet me R, sepse TP më i gjerë
// arrihet më rrallë — mbrojtje nga mbi-optimizmi).
function chooseR(winRatePct: number): number {
  const wr = Math.max(0, Math.min(1, winRatePct / 100));
  const candidates = [1.5, 2, 3, 4];
  let chosen = 2; // default = sjellja aktuale (1:2)
  for (const R of candidates) {
    const breakeven = 1 / (1 + R);
    const margin = 0.05 + 0.03 * Math.max(0, R - 2); // marzh më i madh për R të mëdha
    if (wr >= breakeven + margin) chosen = R;
  }
  return chosen;
}

export function optimizeFromIntel(ti: TradeIntelLite): OptimizedPlan {
  const sample = ti.total || 0;
  const reliability: OptimizedPlan['reliability'] = sample >= 100 ? 'high' : sample >= 40 ? 'medium' : 'low';

  const bestSession = pickBest(ti.bySession || []);
  const bestStrategy = pickBest(ti.byStrategy || []);
  // MMTI = ari: shqyrto vetëm simbolet e arit. Kurrë BTC/naftë, edhe nëse llogaria i ka tregtuar.
  const bestSymbol = pickBest((ti.bySymbol || []).filter((g) => isGoldSymbol(g.label)));

  // Win-rate bazë: i strategjisë fituese nëse e besueshme, përndryshe i përgjithshmi.
  const baseWinRate = (bestStrategy && bestStrategy.n >= MIN_GROUP_N)
    ? bestStrategy.winRate
    : ti.overall.winRate;

  const aLoss = Math.abs(ti.overall.avgLoss) || 0;
  const currentR = aLoss > 0 ? +(ti.overall.avgWin / aLoss).toFixed(2) : 2;

  const recommendedR = chooseR(baseWinRate);
  const slUsd = 2;                         // SL bazë i provuar për scalp ari ($ lëvizje)
  const tpUsd = +(slUsd * recommendedR).toFixed(2);

  const wr = Math.max(0, Math.min(1, baseWinRate / 100));
  const projNewPerTrade = +(wr * tpUsd - (1 - wr) * slUsd).toFixed(2);
  const projOldPerTrade = +(wr * (slUsd * 2) - (1 - wr) * slUsd).toFixed(2); // R aktuale 1:2
  const improvementPct = projOldPerTrade !== 0
    ? Math.round(((projNewPerTrade - projOldPerTrade) / Math.abs(projOldPerTrade)) * 100)
    : 0;

  const minConfidence = baseWinRate >= 60 ? 70 : 75; // win-rate më i ulët → prag më strikt

  const rules: string[] = [];
  if (bestSession) rules.push(`Tregto kryesisht në sesionin: ${bestSession.label} (win-rate ${bestSession.winRate}%, n=${bestSession.n}).`);
  if (bestStrategy) rules.push(`Strategjia më fitimprurëse: ${bestStrategy.label} (expectancy +$${bestStrategy.expectancy}/trade).`);
  if (bestSymbol) rules.push(`Fokus te simboli: ${bestSymbol.label}.`);
  rules.push(`R:R i synuar 1:${recommendedR} → SL $${slUsd}, TP $${tpUsd} (fito $${tpUsd} në vend të $4).`);
  rules.push(`Hyr vetëm me besueshmëri ≥ ${minConfidence}%.`);
  rules.push(`Mbaj trailing-un aktiv për të mbrojtur fitimin sapo trade-i kalon +$${(slUsd * 0.25).toFixed(2)}.`);

  const caution = sample < 100
    ? `Mostër ende e vogël (${sample}/100 trade). Ky plan është PARAPRAK — bëhet i besueshëm pas 100 trade-sh. Validoje në DEMO para çdo aplikimi.`
    : `TP më i gjerë arrihet më rrallë se TP i ngushtë — win-rate-i real mund të bjerë pak. Validoje në DEMO; ndrysho gradualisht.`;

  return {
    generatedAt: new Date().toISOString(),
    sample, mature: sample >= 100, reliability,
    bestSession, bestStrategy, bestSymbol,
    baseWinRate, currentR, recommendedR, slUsd, tpUsd,
    projNewPerTrade, projOldPerTrade, improvementPct, minConfidence,
    rules, caution,
  };
}
