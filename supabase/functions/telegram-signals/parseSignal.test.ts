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
    ['Close Buy', 'buy'], ['Close Sell', 'sell'],
    ['Cancel Buy', 'buy'], ['Cancel Sell', 'sell'],
    ['CLOSE BUY', 'buy'], ['close sell now', 'sell'],
    ['Close the buy', 'buy'],
    ['cancel long', 'buy'],
    ['Close shorts now', 'sell'],
    // Fjalë mbushëse mes foljes dhe drejtimit — pa to "Close all buys" mbyllte edhe shitjet.
    ['Close all buys', 'buy'],
    ['Cancel all sells', 'sell'],
    ['Close the pending buy', 'buy'],
    ['Cancel buy order', 'buy'],
    ['Mbyll blerjen', 'buy'],
    ['Anulo shitjen', 'sell'],
    // Ana tjetër përmendet, por urdhri është ai që pason foljen.
    ['Cancel the buy, the sell is still valid', 'buy'],
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
    // Të dyja anët të lidhura shprehimisht → mbyllet gjithçka.
    'Close BUY and SELL',
    'Cancel buy & sell',
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

/* MESAZHET ME NJË PREKJE (Admin → GoldSniperFX). Këto janë tekstet që dërgon pronari me një klikim,
 * ndaj sjellja e tyre duhet të jetë e ngurtë: nëse dikush i ndryshon fjalët nesër, testi bie këtu
 * para se ta zbulojë kanali. */
describe('mesazhet e gatshme të panelit', () => {
  it('“Mbyll pozicionin” mbyll vërtet', () => {
    expect(parse('⚠️ CLOSE THE POSITION NOW\n\nMarket conditions changed — we exit and protect the account.').kind)
      .toBe('exit');
  });
  it('“SL → Breakeven” çon stopin te hyrja', () => {
    expect(parse('🔒 MOVE SL TO ENTRY (BREAKEVEN)\n\nSecure your position — risk is now zero.').kind)
      .toBe('modify');
  });
  it('“Lëviz SL te 4085” lëviz stopin', () => {
    expect(parse('🔒 MOVE SL TO 4085\n\nProtect your running profit.').kind).toBe('modify');
  });
  it.each([
    ['Sesioni u mbyll', '🌙 Session closed for today.\n\nRest well — we are back tomorrow with new setups.'],
    ['Tregu i mbyllur', '📅 The market is currently closed.\n\nSignals resume at market open. Orders placed now will be queued.'],
    ['Lajme me ndikim', '⚠️ HIGH IMPACT NEWS AHEAD\n\nNo new entries until volatility settles. Manage your open positions carefully.'],
    ['Mirëmëngjes', '☀️ Good morning traders!\n\nMarket analysis in progress — signals will follow shortly. Stay ready.'],
  ])('“%s” nuk prek asnjë pozicion', (_label, text) => {
    expect(parse(text).kind).toBe('unknown');
  });
});

/* MBULIMI I ANGLISHTES.
 *
 * Pronari e ka sqaruar se kanali shkruan GJITHMONË në anglisht, ndaj mbulimi i saj nuk mund të
 * mbetet te format që më kanë ardhur mua ndër mend. Lista më poshtë doli nga një provë e gjerë e
 * mënyrave reale të të shkruarit; secila që dështoi, u rregullua. */
describe('anglishtja — mbyllje me drejtim', () => {
  it.each([
    'Close the buy now', 'Close buy trade', 'Close buy position', 'Cancel the buy order',
    'Cancel pending buy', 'Cancel buy limit', 'Close out the buy', 'Exit the buy', 'Exit buy now',
    'Please close the buy', 'Guys close the buy', 'Close the long',
    // Folje që më parë nuk bënin absolutisht asgjë.
    'Remove the buy', 'Delete the pending buy', 'Abort the buy', 'Scrap the buy', 'Drop the buy',
  ])('%s → mbyll vetëm blerjet', (text) => {
    const r = parse(text);
    expect(r.kind).toBe('exit');
    expect(r.direction).toBe('buy');
  });

  it('Cancel the short → mbyll vetëm shitjet', () => {
    expect(parse('Cancel the short')).toMatchObject({ kind: 'exit', direction: 'sell' });
  });
});

describe('anglishtja — mbyllje e përgjithshme', () => {
  it.each([
    'Close all positions', 'Close everything', 'Close trade', 'Close position', 'Close now',
    'Close out', 'Cancel all', 'Cancel the setup', 'Cancel this trade', 'Close gold',
    'Get out now', 'Book profits', 'Closing now', 'Close all pending orders', 'Cancel all orders',
    'Setup invalid - cancel',   // urdhri në FUND të fjalisë
    'Go flat',
  ])('%s → mbyll gjithçka', (text) => {
    expect(parse(text).kind).toBe('exit');
  });
});

describe('anglishtja — stopi dhe TP-ja', () => {
  it.each([
    'SL to BE', 'Bring SL to entry', 'Secure SL at breakeven', 'SL at BE', 'Stop to breakeven',
    'Set SL at 4085', 'Move your SL to 4085', 'Tighten SL to 4085', 'Raise SL to 4085',
    'Move TP1 to 4105', 'TP to 4105',   // e fundit nuk njihej më parë
  ])('%s → menaxhim', (text) => {
    expect(parse(text).kind).toBe('modify');
  });
});

/* Gjysma tjetër, dhe më e rëndësishmja: fjali të zakonshme të tregut që përmbajnë të njëjtat fjalë
 * por NUK janë urdhra. Një parser që reagon te "Gold closed above 4100" është më i rrezikshëm se
 * një që nuk kupton fare. */
describe('anglishtja — komente që nuk duhet të prekin asgjë', () => {
  it.each([
    'Price closing in on 4100', 'We might close the day higher', 'Waiting to close above 4100',
    'Buy side is strong today', 'I would sell here if it breaks', 'The candle closed bullish',
    'Market closes early today', 'No new entries until volatility settles',
    'Stay away from buying here',
  ])('%s → asgjë', (text) => {
    expect(parse(text).kind).toBe('unknown');
  });
});

/* SHKURTESA "BE" — breakeven pa fjalën 'SL'.
 *
 * Rasti real (6 gusht 2026): pas një hyrjeje SELL erdhi "Moving BE at 4061 - buyers are back." dhe
 * roboti e la si koment — SL-të mbetën ku ishin, ndonëse ishte urdhër i qartë. Rregulli i vjetër e
 * pranonte 'BE' vetëm pas 'SL/stop' ("SL to BE"), ndaj kjo formë s'kapej fare.
 *
 * Rreziku i kundërt është po aq real: 'be' është folja më e zakonshme e anglishtes. Prandaj kërkohen
 * dy kushte njëherësh — shkronja të mëdha DHE një folje lëvizjeje pranë. Të dyja anët mbrohen këtu.
 *
 * Fiksohet edhe një hollësi që mund të kushtonte: te "Moving BE at 4061" numri NUK bëhet SL i ri.
 * Breakeven do të thotë SL te HYRJA; po ta merrte 4061-shin si stop, urdhri do të kthehej në të
 * kundërtën e vetvetes. */
describe('breakeven i shkruar si "BE"', () => {
  it.each([
    'Moving BE at 4061 - buyers are back.',   // mesazhi real që dështoi
    'Moving BE',
    'Move to BE',
    'MOVING BE NOW',
    'Go BE now',
    'Set BE please',
    'SL to BE',
  ])('%s → breakeven', (text) => {
    const r = parse(text) as { kind: string; mod?: { breakeven?: boolean } };
    expect(r.kind).toBe('modify');
    expect(r.mod?.breakeven).toBe(true);
  });

  it('“Moving BE at 4061” nuk e merr 4061-shin si stop të ri', () => {
    const r = parse('Moving BE at 4061 - buyers are back.') as { mod?: { sl?: number } };
    expect(r.mod?.sl).toBeUndefined();
  });

  it.each([
    'this will be a strong move today',
    'buyers are back and the trend should be strong',
    'we will move higher and it should be fine',
    'it might be time to be patient',
  ])('“%s” → asgjë (folja "be", jo shkurtesa)', (text) => {
    expect(parse(text).kind).toBe('unknown');
  });
});
