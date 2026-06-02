import { describe, expect, it } from 'vitest';
import { suggestLot } from './lot';

describe('suggestLot', () => {
  it('llogarit lot nga rreziku 1% (ar/commodity)', () => {
    // balancë 10000, rrezik 1% = $100; distanca 10, vlera 100/lot → 1000 humbje/lot → 0.1 lot
    const r = suggestLot('commodity', 10000, 2000, 1990, 0.01);
    expect(r).not.toBeNull();
    expect(r!.lot).toBeCloseTo(0.1, 2);
  });

  it('kthen null kur balanca është 0', () => {
    expect(suggestLot('crypto', 0, 100, 90)).toBeNull();
  });

  it('kthen null kur stop = hyrje', () => {
    expect(suggestLot('crypto', 1000, 100, 100)).toBeNull();
  });
});
