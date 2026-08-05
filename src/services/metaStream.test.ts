import { describe, it, expect, beforeEach } from 'vitest';
import { metaStream, type StreamSnapshot } from './metaStream';

/* NJOFTIMET E STREAMING-UT
 *
 * metaStream e lexon terminalState çdo 200ms. Ndryshimi që mbrohet këtu është se ai njofton VETËM
 * kur diçka ndryshon vërtet — përndryshe faqja "Tregto Live" rirenderohej 5 herë në sekondë edhe
 * me tregun të palëvizur, dhe në telefon dukej si bllokadë.
 *
 * Rreziku i një optimizimi të tillë është i qartë: po e shtypëm një njoftim që duhej dërguar,
 * ekrani ngrin dhe tregtari sheh një çmim të vjetër pa e ditur. Prandaj testohen të dyja anët —
 * heshtja kur s'ka ndryshim, DHE njoftimi te çdo lloj ndryshimi që e sheh përdoruesi.
 *
 * Terminali është i rremë: 'readTerminal' është privat vetëm në kohë kompilimi, ndaj testi e
 * thërret drejtpërdrejt me një gjendje të kontrolluar, pa SDK dhe pa rrjet. */

// deno-lint-ignore-file
/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakePrice { bid: number; ask: number; time?: string }

function fakeTerminal(price: FakePrice, positions: Array<Record<string, unknown>> = []) {
  return {
    price: () => price,
    positions,
    orders: [],
    accountInformation: { balance: 1000, equity: 1000, currency: 'EUR' },
    connectedToBroker: true,
    connected: true,
    specifications: [{ symbol: 'XAUUSD' }],
  };
}

/** Vendos gjendjen e brendshme dhe kthen numëruesin e njoftimeve. */
function arm(price: FakePrice, positions: Array<Record<string, unknown>> = []) {
  const s = metaStream as any;
  s.terminal = fakeTerminal(price, positions);
  s.subsReq = new Set(['XAUUSD']);
  s.subBroker = new Map([['XAUUSD', 'XAUUSD']]);
  s.snap = {
    status: 'live', connectedToBroker: false, prices: {}, positions: [], orders: [],
    account: null, lastTickAt: 0, updatedAt: 0,
  } as StreamSnapshot;
  let hits = 0;
  const off = metaStream.subscribe(() => { hits++; });
  hits = 0; // subscribe() e thërret dëgjuesin një herë me gjendjen aktuale — mos e numëro
  return {
    read: () => (metaStream as any).readTerminal(),
    setPrice: (p: FakePrice) => { s.terminal.price = () => p; },
    setPositions: (p: Array<Record<string, unknown>>) => { s.terminal.positions = p; },
    get hits() { return hits; },
    reset: () => { hits = 0; },
    snap: () => metaStream.getSnapshot(),
    off,
  };
}

describe('metaStream — njoftime vetëm kur ndryshon diçka', () => {
  let h: ReturnType<typeof arm>;
  beforeEach(() => { h?.off?.(); });

  it('njofton te leximi i parë, pastaj hesht kur çmimi nuk lëviz', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 });
    h.read();
    expect(h.hits).toBe(1);          // gjendja e parë duhet të mbërrijë
    h.reset();
    h.read(); h.read(); h.read();
    expect(h.hits).toBe(0);          // asgjë s'ndryshoi → asnjë rirenderim
    h.off();
  });

  it('njofton sapo çmimi lëviz', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 });
    h.read(); h.reset();
    h.setPrice({ bid: 4150.2, ask: 4150.4 });
    h.read();
    expect(h.hits).toBe(1);
    h.off();
  });

  it('njofton kur fitimi i një pozicioni ndryshon, edhe pa lëvizur çmimi', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 }, [{ id: '1', symbol: 'XAUUSD', volume: 0.01, profit: 5 }]);
    h.read(); h.reset();
    h.setPositions([{ id: '1', symbol: 'XAUUSD', volume: 0.01, profit: 7 }]);
    h.read();
    expect(h.hits).toBe(1);
    h.off();
  });

  it('njofton kur SL/TP ndryshon — përndryshe pilula do të tregonte nivelin e vjetër', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 }, [{ id: '1', symbol: 'XAUUSD', volume: 0.01, profit: 5 }]);
    h.read(); h.reset();
    h.setPositions([{ id: '1', symbol: 'XAUUSD', volume: 0.01, profit: 5, stopLoss: 4100 }]);
    h.read();
    expect(h.hits).toBe(1);
    h.off();
  });

  it('njofton kur hapet ose mbyllet një pozicion', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 }, []);
    h.read(); h.reset();
    h.setPositions([{ id: '9', symbol: 'XAUUSD', volume: 0.02, profit: 0 }]);
    h.read();
    expect(h.hits).toBe(1);
    h.off();
  });

  it('lastTickAt matet me orën LOKALE, jo me kohën e brokerit', () => {
    // Brokeri raporton një kohë krejt të gabuar (ora e telefonit/serverit e zhvendosur).
    const brokerTime = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    h = arm({ bid: 4150.1, ask: 4150.3, time: brokerTime });
    const before = Date.now();
    h.read();
    const { lastTickAt } = h.snap();
    expect(lastTickAt).toBeGreaterThanOrEqual(before);   // ora jonë, jo ajo e brokerit
    expect(Date.now() - lastTickAt).toBeLessThan(5000);  // pra lidhja duket e freskët
    h.off();
  });

  it('lastTickAt nuk lëviz kur çmimi rri i ngrirë', () => {
    h = arm({ bid: 4150.1, ask: 4150.3 });
    h.read();
    const t1 = h.snap().lastTickAt;
    h.read();
    expect(h.snap().lastTickAt).toBe(t1); // pa lëvizje → freskia nuk rinovohet artificialisht
    h.off();
  });
});
