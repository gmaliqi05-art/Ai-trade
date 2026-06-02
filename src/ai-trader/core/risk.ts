// Menaxhimi i rrezikut: madhësia e pozicionit (lot) dhe mbrojtjet e detyrueshme.

export interface LotSizeInput {
  /** Bilanci i llogarisë (në valutën e llogarisë). */
  balance: number;
  /** Përqindja e bilancit që rrezikohet në një trade (p.sh. 0.01 = 1%). */
  riskPercent: number;
  /** Çmimi i hyrjes. */
  entryPrice: number;
  /** Çmimi i stop-loss. */
  stopLossPrice: number;
  /** Vlera monetare e 1 njësie lëvizjeje çmimi për 1 lot të plotë. */
  valuePerPricePerLot: number;
  /** Lot minimal i lejuar (zakonisht 0.01). */
  minLot?: number;
  /** Lot maksimal i lejuar (mbrojtje). */
  maxLot?: number;
  /** Hapi i lotit (zakonisht 0.01). */
  lotStep?: number;
}

export interface LotSizeResult {
  lot: number;
  moneyAtRisk: number;
  /** True nëse u shkurtua nga maxLot — pozicioni u kufizua për siguri. */
  cappedByMax: boolean;
}

/**
 * Llogarit madhësinë e lotit nga rreziku i pranueshëm dhe distanca e stop-loss.
 * Lot = (bilanci × rreziku%) / (distanca_e_stop × vlera_për_njësi_për_lot).
 */
export function calcLotSize(input: LotSizeInput): LotSizeResult {
  const {
    balance,
    riskPercent,
    entryPrice,
    stopLossPrice,
    valuePerPricePerLot,
    minLot = 0.01,
    maxLot = 100,
    lotStep = 0.01,
  } = input;

  if (balance <= 0) throw new Error('balance duhet > 0');
  if (riskPercent <= 0 || riskPercent > 1) throw new Error('riskPercent duhet në (0, 1]');
  if (valuePerPricePerLot <= 0) throw new Error('valuePerPricePerLot duhet > 0');

  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  if (stopDistance <= 0) throw new Error('stop-loss nuk mund të jetë i barabartë me hyrjen');

  const moneyAtRisk = balance * riskPercent;
  const lossPerLot = stopDistance * valuePerPricePerLot;
  const rawLot = moneyAtRisk / lossPerLot;

  // Rrumbullakos poshtë te hapi i lotit që të mos kalojë rrezikun.
  let lot = Math.floor(rawLot / lotStep) * lotStep;
  lot = roundToStep(lot, lotStep);

  let cappedByMax = false;
  if (lot > maxLot) {
    lot = maxLot;
    cappedByMax = true;
  }
  if (lot < minLot) lot = minLot;

  return {
    lot: roundToStep(lot, lotStep),
    moneyAtRisk: lot * lossPerLot,
    cappedByMax,
  };
}

function roundToStep(value: number, step: number): number {
  const decimals = (step.toString().split('.')[1] ?? '').length;
  return Number(value.toFixed(decimals));
}

export interface RiskGuardState {
  /** Humbja e realizuar sot (vlerë pozitive = humbje). */
  dailyLoss: number;
  /** Numri i tregtive të hapura aktualisht. */
  openTrades: number;
}

export interface RiskGuardLimits {
  /** Humbja maksimale ditore e lejuar (në valutën e llogarisë). */
  maxDailyLoss: number;
  /** Numri maksimal i tregtive të njëkohshme. */
  maxOpenTrades: number;
  /** Kill-switch global: nëse true, ndalon çdo tregti të re. */
  killSwitch?: boolean;
}

export interface RiskDecision {
  allowed: boolean;
  reason: string;
}

/** Vendos nëse lejohet hapja e një tregtie të re, sipas limiteve mbrojtëse. */
export function canOpenTrade(state: RiskGuardState, limits: RiskGuardLimits): RiskDecision {
  if (limits.killSwitch) {
    return { allowed: false, reason: 'Kill-switch aktiv — të gjitha tregtitë e bllokuara.' };
  }
  if (state.dailyLoss >= limits.maxDailyLoss) {
    return { allowed: false, reason: 'Arritur limiti i humbjes ditore.' };
  }
  if (state.openTrades >= limits.maxOpenTrades) {
    return { allowed: false, reason: 'Arritur numri maksimal i tregtive të hapura.' };
  }
  return { allowed: true, reason: 'OK' };
}
