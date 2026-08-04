import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* PROVAT E PARSERIT TË MESAZHEVE
 *
 * Rasti që i lindi (4 gusht 2026): kanali dërgoi "Cancel BUY - no reaction" dhe roboti e la si
 * koment — në bazë kind='unknown', status='ignored' për të 7 përdoruesit, ndërsa porositë në pritje
 * të sinjalit BUY mbetën te brokeri. Shkaku ishte se lista e objekteve pas foljes së mbylljes nuk
 * përmbante drejtimin: "cancel all" punonte, "cancel BUY" jo.
 *
 * Këto rregulla nuk kanë tipa që t'i mbrojnë — janë shprehje të rregullta mbi tekst të lirë. I vetmi
 * mbrojtës i mundshëm është një listë rastesh reale. Prandaj testi lexon parserin E VËRTETË nga
 * 'index.ts' (jo një kopje që vjetrohet), duke prerë vetëm pjesën e tij dhe duke e përkthyer me
 * esbuild — funksioni mbetet i paprekur për deploy-in në Deno.
 *
 * Gjysma e dytë e listës është po aq e rëndësishme sa e para: mesazhe që NUK duhet të prekin asgjë.
 * Një parser që mbyll pozicione kur dikush shkruan "gold closed above 4100" është më i rrezikshëm
 * se një parser që nuk kupton fare. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');

const from = src.findIndex((l) => l.startsWith('interface TpUpdate'));
const to = src.findIndex((l) => l.trim() === 'return { ...none, symbol };');
if (from < 0 || to < 0) {
  throw new Error('Nuk u gjet parseSignal te index.ts — shënuesit e prerjes kanë ndryshuar.');
}
const chunk = src.slice(from, to + 2).join('\n') + '\nexport { parseSignal };\n';
const js = transformSync(chunk, { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const parse = (t: string) => mod.parseSignal(t, 'XAUUSD') as { kind: string; direction: string | null };

describe('urdhrat e mbylljes', () => {
  it.each([
    ['Cancel BUY - no reaction', 'buy'],   // mesazhi real që dështoi
    ['Cancel SELL', 'sell'],
    ['Close the buy', 'buy'],
    ['cancel long', 'buy'],
    ['Close shorts now', 'sell'],
  ])('%s → mbyll vetëm %s', (text, dir) => {
    const r = parse(text);
    expect(r.kind).toBe('exit');
    expect(r.direction).toBe(dir);
  });

  it.each([
    'Cancel',
    'Cancel — no reaction',
    'close all',
    'close XAUUSD',
    'cancel pending orders',
    'mbylle pozicionin',
    'anuloje',
  ])('%s → mbyll gjithçka për simbolin', (text) => {
    const r = parse(text);
    expect(r.kind).toBe('exit');
    expect(r.direction).toBeNull();
  });
});

describe('komentet nuk prekin asgjë', () => {
  it.each([
    'Next Short Level might happen at 4115-4110',
    'Lets wait for the next level.',
    'Gold closed above 4100',
    'We are close to support',
    'Price is closing in on the level',
    'The daily candle closed bullish',
    'For the past five months, Trump has announced peace talks around 25 times.',
  ])('%s → unknown', (text) => {
    expect(parse(text).kind).toBe('unknown');
  });
});

describe('hyrjet mbeten hyrje', () => {
  it('sinjal i plotë BUY', () => {
    const r = parse('BUY XAUUSD\nEntry 4092\nSL 4080\nTP1 4100\nTP2 4110\nTP3 4120\nTP4 4130');
    expect(r.kind).toBe('entry');
    expect(r.direction).toBe('buy');
  });
  it('sinjal i plotë SELL', () => {
    expect(parse('SELL XAUUSD Entry 4150 SL 4160 TP1 4140').kind).toBe('entry');
  });
});

describe('urdhrat e menaxhimit', () => {
  it.each([
    'Move SL to breakeven',
    'SL to 4085',
    'SL 4085',          // forma e zhveshur, pa folje
    'sl 4085',
    'Stop loss 4085',
    'TP1 4100',
    'Move TP to 4105',
  ])('%s → modify', (text) => {
    expect(parse(text).kind).toBe('modify');
  });

  // Një sinjal hyrjeje të cilit i mungon fjala BUY/SELL NUK duhet të bëhet urdhër menaxhimi:
  // përndryshe do t'i lëvizte SL/TP-të e pozicioneve ekzistuese sipas niveleve të një setup-i tjetër.
  it.each([
    'XAUUSD Entry 4092 SL 4080 TP1 4100',
    'Entry 4092 SL 4080',
  ])('%s → unknown (hyrje e palexueshme, jo menaxhim)', (text) => {
    expect(parse(text).kind).toBe('unknown');
  });
});
