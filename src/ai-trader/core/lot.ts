// Sugjerim i madhësisë së lotit nga rreziku — përdor motorin e testuar calcLotSize.
// Vlerat valuePerPricePerLot janë përafrime sipas kategorisë (supozime të dokumentuara);
// brokeri real (Vantage) mund të ndryshojë lehtë. Synimi: një sugjerim i ndershëm, jo i rremë.

import { calcLotSize, type LotSizeResult } from './risk';

// Vlera monetare e 1 njësie lëvizjeje çmimi për 1 lot të plotë, sipas kategorisë.
const VALUE_PER_PRICE_PER_LOT: Record<string, number> = {
  commodity: 100,    // ari: 1 lot = 100 ons → $1 lëvizje = $100
  crypto: 1,         // 1 lot ≈ 1 njësi → $1 lëvizje = $1
  forex: 100000,     // 1 lot standard = 100,000 njësi
  stock: 1,          // aksione/indekse (përafrim)
};

/**
 * Sugjeron lotin për një tregti nga balanca + distanca e stop-it.
 * Kthen null nëse të dhënat s'mjaftojnë.
 */
export function suggestLot(
  category: string | undefined,
  balance: number,
  entry: number,
  stopLoss: number,
  riskPercent = 0.01,
): LotSizeResult | null {
  if (!balance || balance <= 0) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || entry === stopLoss) return null;
  const valuePerPricePerLot = VALUE_PER_PRICE_PER_LOT[category ?? ''] ?? 1;
  try {
    return calcLotSize({
      balance,
      riskPercent,
      entryPrice: entry,
      stopLossPrice: stopLoss,
      valuePerPricePerLot,
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
    });
  } catch {
    return null;
  }
}
