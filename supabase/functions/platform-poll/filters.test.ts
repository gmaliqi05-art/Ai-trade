import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* FILTRAT E POLLER-IT TË PLATFORMËS
 *
 * Rasti që i lindi (5 gusht 2026): pas një hyrjeje BUY, pronari dërgoi "Cancel BUY - we didnt reach
 * entry on time". Mesazhi u shfaq te kanali dhe porositë mbetën te brokeri. Parseri e kupton atë
 * tekst pa asnjë vështirësi — problemi ishte më lart: 'isRobotOrder' njihte 'close/exit/mbyll' por
 * JO 'cancel'. Me çelësin "Fshih bisedat" të ndezur, urdhri trajtohej si muhabet dhe hidhej para se
 * roboti ta shihte.
 *
 * Kjo funksion vendos nëse një mesazh mbrohet nga filtrat e komenteve. Gabimi këtu nuk prish pamje —
 * lë porosi të hapura me para të vërteta kur pronari ka kërkuar t'i ndalë. Ndaj foljet duhet të
 * mbeten të sinkronizuara me ato të parserit, dhe kjo listë është ajo që e detyron.
 *
 * Ashtu si te testi i parserit, funksioni lexohet nga burimi i VËRTETË, jo nga një kopje. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');

const from = src.findIndex((l) => l.startsWith('function isRobotOrder'));
const to = src.findIndex((l, i) => i > from && l.trim() === '}');
if (from < 0 || to < 0) {
  throw new Error('Nuk u gjet isRobotOrder te index.ts — shënuesit e prerjes kanë ndryshuar.');
}
const chunk = src.slice(from, to + 1).join('\n') + '\nexport { isRobotOrder };\n';
const js = transformSync(chunk, { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const isRobotOrder = (t: string) => mod.isRobotOrder(t) as boolean;

describe('isRobotOrder — urdhrat që s\'guxojnë të bllokohen kurrë', () => {
  it.each([
    'Cancel BUY - we didnt reach entry on time. We wait next VWAP zone', // mesazhi real që dështoi
    'Cancel BUY',
    'Cancel SELL',
    'cancel all pending orders',
    '🚫 Cancel BUY ❌',           // dekorimet nuk e ndryshojnë natyrën e urdhrit
    'Remove the buy',
    'Delete all pending',
    'Abort the setup',
    'Setup invalid - cancel',
    'Go flat',
    'Close BUY',
    'close all',
    'Exit now',
    'Move SL to 4100',
    'SL to breakeven',
    'TP1 4160',
    'Mbylle blerjen',
    'Anuloje shitjen',
  ])('e njeh si urdhër: %s', (text) => {
    expect(isRobotOrder(text)).toBe(true);
  });

  /* Ana tjetër: muhabeti i zakonshëm duhet të mbetet muhabet, përndryshe çelësi "Fshih bisedat"
   * s'do të fshihte më asgjë dhe filtri do të bëhej i kotë. */
  it.each([
    'Good morning everyone',
    'The market pumped on hopes of a peace deal',
    'Gold is looking strong today',
    'Our team sees a potential BUY setup on XAU/USD',
    'News is spreading everywhere that negotiations are progressing',
  ])('nuk e ngatërron me urdhër: %s', (text) => {
    expect(isRobotOrder(text)).toBe(false);
  });
});
