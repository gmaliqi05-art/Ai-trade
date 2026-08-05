import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* PORTA E URDHRIT — KUR PYETET AI-JA
 *
 * Rregullat gjykojnë me fjalë, jo me qëllim. Prandaj "break even" është e njëjta gjë për to, si te
 * "vendose SL te breakeven" ashtu edhe te "SL-ja ime do të shkojë te breakeven". Të dhënat e vërteta
 * (30 korrik – 5 gusht) e treguan: TRI mesazhe rrëfyese u lexuan si urdhra. Nuk shkaktuan dëm vetëm
 * sepse atë çast s'kishte pozicione hapur.
 *
 * 'orderGate' vendos kur duhet pyetur Claude. Ajo çfarë mbrohet këtu janë të dyja anët:
 *   · urdhrat e shkurtër e të qartë NUK duhet ta prekin AI-në — përndryshe çdo mbyllje varet nga
 *     rrjeti dhe vonohet pikërisht kur nxitimi ka rëndësi;
 *   · rrëfimet me fjalë urdhri brenda DUHET ta prekin — atje ndodhin gabimet.
 *
 * Tekstet janë ato REALE nga baza, jo shembuj të sajuar. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');

const pFrom = src.findIndex((l) => l.startsWith('interface TpUpdate'));
const pTo = src.findIndex((l) => l.trim() === 'return { ...none, symbol };');
const gFrom = src.findIndex((l) => l.startsWith('function orderGate'));
const gTo = src.findIndex((l, i) => i > gFrom && l.trim() === '}');
if (pFrom < 0 || pTo < 0 || gFrom < 0 || gTo < 0) {
  throw new Error('Shënuesit e prerjes te index.ts kanë ndryshuar.');
}
const chunk = src.slice(pFrom, pTo + 2).join('\n') + '\n'
  + src.slice(gFrom, gTo + 1).join('\n') + '\nexport { orderGate };\n';
const js = transformSync(chunk, { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const gate = (t: string) => mod.orderGate(t) as { ruled: string; needsAi: boolean };

describe('urdhra të shkurtër — zbatohen menjëherë, pa AI', () => {
  it.each([
    'CLOSE NOW',
    'close XAUUSD',
    'BREAKEVEN',
    'MOVE SL 4050',
    'MOVE SL 4009',
    'CHANGE TP 4003',
    'Cancel BUY - no reaction',
    'Cancel SELL',
    '⚠️ CLOSE THE POSITION NOW\n\nMarket conditions changed — we exit and protect the account.',
    '❌ CANCEL ALL PENDING ORDERS\n\nWe did not reach the entry in time — the setup is no longer valid.',
    '🔒 MOVE SL TO ENTRY (BREAKEVEN)\n\nSecure your position — risk is now zero.',
    '🔒 MOVE SL TO 4150\n\nProtect your running profit.',
  ])('%s → vepron pa pritur AI-në', (t) => {
    const g = gate(t);
    expect(g.ruled === 'exit' || g.ruled === 'modify').toBe(true);
    expect(g.needsAi).toBe(false);
  });
});

describe('rrëfime me fjalë urdhri brenda — kërkojnë konfirmim', () => {
  /* Të treja janë tekste REALE që rregullat i lexuan si 'modify'. Pa këtë portë, roboti do t'u
   * kishte lëvizur SL-në përdoruesve sepse autori tregoi çfarë po bënte VETË. */
  it.each([
    'Between the 4060 and 4067 area, there are a lot of large iceberg sell orders still waiting to be filled from yesterday. That suggests there’s a high probability the price will move into that zone. If it does, my position from yesterday will reach break even, allowing me to exit without a loss',
    "Guys, we're now seeing real selling pressure now 📉, and I still think we have room to move lower. My SL setup from yesterday should soon be at break even and I am still holding.",
    'SL 4087 - That’s a crazy, manipulative day. No more trades for me today.',
  ])('rrëfim → pyetet AI-ja (dhe në dyshim nuk veprohet)', (t) => {
    const g = gate(t);
    expect(g.ruled === 'modify' || g.ruled === 'exit').toBe(true); // rregullat gabojnë…
    expect(g.needsAi).toBe(true);                                  // …ndaj kërkohet konfirmim
  });
});

describe('shpëtimi: rregullat s\'kuptuan, por teksti flet për menaxhim', () => {
  it.each([
    'guys please take everything off the table for now',
    'we are done with this one, get out',
  ])('%s → pyetet AI-ja', (t) => {
    expect(gate(t).needsAi).toBe(true);
  });
});

describe('bisedë e zakonshme — as urdhër, as thirrje AI', () => {
  it.each([
    'The market pumped on hopes of a peace deal. News is spreading everywhere',
    'Next Short Level might happen at 4115-4110',
    'Good morning traders!',
    '🥇 Great day, team!',
  ])('%s → asgjë', (t) => {
    const g = gate(t);
    expect(g.ruled).toBe('unknown');
    expect(g.needsAi).toBe(false);
  });
});
