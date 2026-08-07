import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* SINJAL BOSH — VETËM DREJTIM, PA NIVELE
 *
 * Rasti real (6 gusht 2026): platforma e sinjaleve nxori dy "sinjale" (#30 sell, #31 buy) nga një
 * koment analize NFP që përmendte "(BUY)" dhe "(Sell)" si etiketa skenarësh. Erdhën te roboti me
 * drejtim + XAUUSD por PA Entry/SL/TP. Roboti nuk hapi tregti (mirë), por i shfaqi si "BUY XAUUSD" /
 * "SELL XAUUSD" te Trade View — zhurmë. 'isBareSignal' i kap para regjistrimit dhe i heq.
 *
 * Të dyja anët mbrohen: sinjalet bosh hiqen, kurse sinjalet e vërteta dhe urdhrat e menaxhimit
 * (close/modify/message) kalojnë. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');
const from = src.findIndex((l) => l.startsWith('function isBareSignal'));
const to = src.findIndex((l, i) => i > from && l.trim() === '}');
if (from < 0 || to < 0) throw new Error('isBareSignal nuk u gjet te index.ts');
const chunk = src.slice(from, to + 1).join('\n') + '\nexport { isBareSignal };\n';
const js = transformSync(chunk, { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const isBare = (ps: unknown) => mod.isBareSignal(ps) as boolean;

describe('isBareSignal — hiq sinjalet bosh', () => {
  it.each([
    [{ direction: 'buy', symbol: 'XAUUSD' }],                          // rasti #31 real
    [{ direction: 'sell', symbol: 'XAUUSD' }],                         // rasti #30 real
    [{ side: 'buy', symbol: 'XAUUSD' }],
    [{ action: 'signal', direction: 'buy', symbol: 'XAUUSD', entry: null, sl: null, tps: [] }],
  ])('bosh → hiqet: %o', (ps) => {
    expect(isBare(ps)).toBe(true);
  });

  it.each([
    [{ direction: 'buy', symbol: 'XAUUSD', entry: 4153 }],             // ka Entry
    [{ direction: 'sell', symbol: 'XAUUSD', sl: 4272 }],              // ka SL
    [{ direction: 'buy', symbol: 'XAUUSD', tps: [4160, 4165] }],      // ka TP
    [{ direction: 'sell', symbol: 'XAUUSD', entry_price: 4261, stop_loss: 4272, tps: [4257] }], // sinjal i plotë
    [{ action: 'close', symbol: 'XAUUSD' }],                          // urdhër mbylljeje
    [{ action: 'modify', symbol: 'XAUUSD', breakeven: true }],        // urdhër breakeven
    [{ action: 'message', message: 'Moving BE now' }],               // mesazh teksti
  ])('jo bosh → kalon: %o', (ps) => {
    expect(isBare(ps)).toBe(false);
  });

  it('null/undefined → jo bosh (nuk prek rrugën jo-strukturore)', () => {
    expect(isBare(null)).toBe(false);
    expect(isBare(undefined)).toBe(false);
  });
});
