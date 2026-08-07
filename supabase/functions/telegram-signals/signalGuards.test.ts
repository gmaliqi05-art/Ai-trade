import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* MBROJTJET E CILËSISË SË SINJALIT
 *
 * Rasti real (7 gusht 2026, 03:10 UTC): platforma emetoi sinjale automatike (source="GoldSniperFX
 * Algorithm") me hyrje absurde dhe TP në anën e gabuar. Roboti i ekzekutoi te 5 llogari sepse hyrja
 * shumë-larg tregut kthehej në porosi tregu. Këto teste fiksojnë refuzimin, me tekstet e vërteta. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');
const f1 = src.findIndex((l) => l.startsWith('function signalRejectReason'));
const t1 = src.findIndex((l, i) => i > f1 && l.trim() === '}' && src[i - 1].trim() === 'return null;');
const f2 = src.findIndex((l) => l.startsWith('function isSourceAllowed'));
const t2 = src.findIndex((l, i) => i > f2 && l.trim() === '}');
if (f1 < 0 || t1 < 0 || f2 < 0 || t2 < 0) throw new Error('funksionet e mbrojtjes nuk u gjetën');
const chunk = src.slice(f1, t1 + 1).join('\n') + '\n' + src.slice(f2, t2 + 1).join('\n')
  + '\nexport { signalRejectReason, isSourceAllowed };\n';
const js = transformSync(chunk, { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const reason = (p: Record<string, unknown>, live: number) => mod.signalRejectReason(p, live) as string | null;
const sig = (o: Partial<{ direction: string; entryType: string; entryPrice: number | null; stopLoss: number | null; tps: number[] }>) =>
  ({ direction: 'sell', entryType: 'limit', entryPrice: null, stopLoss: null, tps: [], ...o });

const MKT = 4257; // çmimi live i arit atë mëngjes

describe('1) hyrje shumë larg çmimit live → refuzo', () => {
  it.each([
    ['SELL Entry 4070 (4.4% larg)', sig({ direction: 'sell', entryPrice: 4070, stopLoss: 4090, tps: [4060] })],
    ['SELL Entry 4094.88 (3.8% larg)', sig({ direction: 'sell', entryPrice: 4094.88, stopLoss: 4114.88, tps: [4054.88] })],
    ['SELL Entry 4014 (5.7% larg)', sig({ direction: 'sell', entryPrice: 4014, stopLoss: 4120, tps: [4090] })],
  ])('%s', (_l, p) => {
    expect(reason(p, MKT)).toMatch(/larg çmimit live/);
  });
});

describe('2) SL në anën e gabuar → refuzo', () => {
  it('SELL me SL poshtë hyrjes', () => {
    expect(reason(sig({ direction: 'sell', entryPrice: 4257, stopLoss: 4240, tps: [4250] }), MKT)).toMatch(/SL .* anën e gabuar/);
  });
  it('BUY me SL sipër hyrjes', () => {
    expect(reason(sig({ direction: 'buy', entryPrice: 4257, stopLoss: 4270, tps: [4265] }), MKT)).toMatch(/SL .* anën e gabuar/);
  });
});

describe('3) të gjithë TP në anën e gabuar → refuzo', () => {
  it('SELL me TP mbi hyrjen (rasti real 4014/4090)', () => {
    // pa kontrollin e hyrjes-larg: kontrollojmë vetëm TP-në, me hyrje afër tregut
    expect(reason(sig({ direction: 'sell', entryPrice: 4257, stopLoss: 4270, tps: [4270, 4280] }), MKT)).toBeTruthy();
  });
  it('BUY me TP poshtë hyrjes', () => {
    expect(reason(sig({ direction: 'buy', entryPrice: 4257, stopLoss: 4240, tps: [4250, 4245] }), MKT)).toMatch(/TP.*anën e gabuar/);
  });
});

describe('sinjalet e shëndosha → kalojnë (null)', () => {
  it.each([
    ['SELL i saktë afër tregut', sig({ direction: 'sell', entryPrice: 4261, stopLoss: 4272, tps: [4257, 4252, 4246, 4233] })],
    ['BUY i saktë', sig({ direction: 'buy', entryPrice: 4255, stopLoss: 4240, tps: [4265, 4275] })],
    ['SELL market (pa entry) SL sipër tregut', sig({ direction: 'sell', entryType: 'market', entryPrice: null, stopLoss: 4275, tps: [4245] })],
    ['njëri TP i saktë mjafton', sig({ direction: 'sell', entryPrice: 4257, stopLoss: 4270, tps: [4270, 4245] })],
  ])('%s', (_l, p) => {
    expect(reason(p, MKT)).toBeNull();
  });
});

describe('isSourceAllowed', () => {
  it('listë bosh → lejo të gjithë', () => {
    expect(mod.isSourceAllowed('GoldSniperFX Algorithm', '')).toBe(true);
  });
  it('vetëm burimet në listë kalojnë', () => {
    expect(mod.isSourceAllowed('Experts', 'experts, admin')).toBe(true);
    expect(mod.isSourceAllowed('GoldSniperFX Algorithm', 'experts, admin')).toBe(false);
  });
});
