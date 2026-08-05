import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

/* BUTONAT E KONSOLËS SË ADMINIT ↔ VEPRIMI I ROBOTIT
 *
 * Nga 5 gushti 2026 butonat e Adminit nuk dërgojnë vetëm mesazh te kanali: teksti kalon edhe te
 * roboti, ku parseSignal vendos çfarë të bëjë. Domethënë teksti i butonit NUK është më dekor — ai
 * është urdhri.
 *
 * Prandaj kjo lidhje duhet mbrojtur në të dyja drejtimet:
 *   · një buton që premton mbyllje DUHET të prodhojë mbyllje — përndryshe pronari shtyp "Mbyll
 *     pozicionin", sheh mesazhin te kanali dhe beson se u krye, ndërsa te brokeri s'ka ndryshuar
 *     asgjë. Pikërisht kjo ndodhi më 3 gusht;
 *   · një buton informues (TP u prek, mirëmëngjes, lajme) NUK guxon të prekë asnjë pozicion.
 *
 * Tekstet lexohen nga vetë faqja e Adminit, jo nga një kopje: nëse dikush e ndryshon fjalorin e një
 * butoni dhe ai pushon së kuptuari si urdhër, testi bie këtu, jo te llogaria e dikujt. */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.ts'), 'utf8').split('\n');
const from = src.findIndex((l) => l.startsWith('interface TpUpdate'));
const to = src.findIndex((l) => l.trim() === 'return { ...none, symbol };');
const js = transformSync(src.slice(from, to + 2).join('\n') + '\nexport { parseSignal };\n',
  { loader: 'ts', format: 'esm' }).code;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const kindOf = (t: string) => (mod.parseSignal(t, 'XAUUSD') as { kind: string }).kind;

// Tekstet e vërteta të butonave, lexuar nga faqja e Adminit.
const page = readFileSync(join(here, '../../../src/admin/AdminGoldSniperPage.tsx'), 'utf8');
const buttons = new Map<string, string>();
for (const m of page.matchAll(/id: '([a-z0-9]+)',[\s\S]{0,160}?text: '((?:[^'\\]|\\.)*)'/g)) {
  buttons.set(m[1], m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace('{v}', '4150'));
}

const textOf = (id: string) => {
  const t = buttons.get(id);
  if (!t) throw new Error(`Butoni '${id}' s'u gjet te AdminGoldSniperPage.tsx — a ndryshoi id-ja?`);
  return t;
};

describe('butonat e Adminit → roboti', () => {
  it('u lexuan tekstet e butonave nga faqja', () => {
    expect(buttons.size).toBeGreaterThanOrEqual(12);
  });

  it.each([
    ['close', 'Mbyll pozicionin'],
    ['cancelpend', 'Anulo porositë në pritje'],
  ])('“%s” (%s) → roboti MBYLL/ANULON', (id) => {
    expect(kindOf(textOf(id))).toBe('exit');
  });

  it.each([
    ['be', 'SL → Breakeven'],
    ['sl', 'Lëviz SL te një çmim'],
  ])('“%s” (%s) → roboti MODIFIKON SL', (id) => {
    expect(kindOf(textOf(id))).toBe('modify');
  });

  /* Informuesit: asnjë prekje pozicioni. 'tp1' bën përjashtim me qëllim — teksti i tij thotë
   * shprehimisht "move SL to entry", ndaj roboti e siguron pozicionin te breakeven. Kjo është
   * sjellje e dëshiruar dhe fiksohet këtu që të mos ndryshojë pa u vënë re. */
  it.each(['tp2', 'tp3', 'tp4', 'morning', 'evening', 'closed', 'news', 'wait', 'greatday'])(
    '“%s” është vetëm mesazh — nuk prek asnjë pozicion', (id) => {
      expect(kindOf(textOf(id))).toBe('unknown');
    });

  it('“TP1 u prek” e çon SL-në te hyrja (breakeven), siç e thotë vetë teksti', () => {
    expect(kindOf(textOf('tp1'))).toBe('modify');
  });

  /* MOSPËRPUTHJE E NJOHUR: "Mbyll gjysmën" nuk mbyll gjysmën — mbyllja e pjesshme s'mbështetet
   * ende, ndaj roboti e çon SL-në te breakeven dhe pozicioni mbetet i plotë. Fiksohet këtu që
   * askush të mos e besojë të kundërtën pa e ndryshuar me vetëdije. */
  it('“Mbyll gjysmën” bën VETËM breakeven — mbyllja e pjesshme s\'mbështetet', () => {
    expect(kindOf(textOf('half'))).toBe('modify');
  });
});
