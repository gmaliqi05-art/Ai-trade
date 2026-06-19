// LIDHJE DIREKTE STREAMING me MetaApi (websocket) — çmime/pozicione/SL-TP në kohë reale, pa polling.
//
// Si punon: shfletuesi hap një lidhje websocket direkt te MetaApi dhe mban një "terminalState" të
// sinkronizuar (kopje lokale e gjendjes së llogarisë MT5). Leximi i çmimit/pozicioneve nga
// terminalState është LOKAL (pa thirrje rrjeti) → praktikisht real-time. Një lexues çdo 200ms
// e shndërron gjendjen në një 'snapshot' dhe njofton komponentët React.
//
// Token-i merret nga 'metaapi_config' (RLS: vetëm pronari lexon rreshtin e vet) — i njëjti model
// besimi që përdor faqja e konfigurimit. Lidhja është PRONARI → MetaApi, direkt.

// SDK-ja ngarkohet DINAMIKISht brenda start() (≈650KB) → s'rëndon bundle-in kryesor; merret
// vetëm kur përdoruesi hap lidhjen direkte te "Trade Live".

export type StreamStatus = 'idle' | 'connecting' | 'synchronizing' | 'live' | 'reconnecting' | 'error';

export interface StreamPrice { bid: number; ask: number; time: number }

export interface StreamPosition {
  id: string; symbol: string; type: string; volume: number;
  openPrice: number; currentPrice: number; profit: number;
  stopLoss?: number; takeProfit?: number; comment?: string; clientId?: string;
}

export interface StreamSnapshot {
  status: StreamStatus;
  error?: string;
  connectedToBroker: boolean;
  prices: Record<string, StreamPrice>;
  positions: StreamPosition[];
  orders: unknown[];
  account: { balance?: number; equity?: number; currency?: string } | null;
  lastTickAt: number; // ms i tick-ut më të fundit ndër simbolet e abonuara (0 = ende asnjë)
  updatedAt: number;  // ms i leximit të fundit të snapshot-it
}

type Listener = (s: StreamSnapshot) => void;

// Përkthen 'region' e ruajtur (new-york/london/singapore) në opsionin e SDK-së.
function regionFor(region?: string): string | undefined {
  const r = (region || '').trim().toLowerCase();
  if (!r) return undefined;
  if (r.includes('london')) return 'london';
  if (r.includes('singapore')) return 'singapore';
  return 'new-york';
}

class MetaStream {
  private api: { metatraderAccountApi: { getAccount: (id: string) => Promise<unknown> } } | null = null;
  private account: any = null;       // eslint-disable-line @typescript-eslint/no-explicit-any
  private connection: any = null;    // eslint-disable-line @typescript-eslint/no-explicit-any
  private terminal: any = null;      // eslint-disable-line @typescript-eslint/no-explicit-any
  private listeners = new Set<Listener>();
  private subsReq = new Set<string>();              // simbolet bazë të kërkuara (p.sh. 'XAUUSD')
  private subBroker = new Map<string, string>();    // bazë → emri REAL te brokeri (p.sh. 'XAUUSD+')
  private subscribedBrokers = new Set<string>();    // simbolet broker për të cilat kemi thirrur subscribe
  private specs: string[] = [];                     // lista e simboleve të brokerit nga terminalState
  private pollId: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private cfgKey = '';
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private snap: StreamSnapshot = {
    status: 'idle', connectedToBroker: false, prices: {}, positions: [], orders: [],
    account: null, lastTickAt: 0, updatedAt: 0,
  };

  getSnapshot(): StreamSnapshot { return this.snap; }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snap);
    return () => { this.listeners.delete(l); };
  }

  private emit() { for (const l of this.listeners) { try { l(this.snap); } catch { /* injoro */ } } }
  private set(patch: Partial<StreamSnapshot>) { this.snap = { ...this.snap, ...patch, updatedAt: Date.now() }; this.emit(); }

  // Nis lidhjen direkte. Idempotente për të njëjtin (accountId, region).
  async start(token: string, accountId: string, region: string): Promise<void> {
    if (!token || !accountId) return;
    const key = `${accountId}:${regionFor(region) || ''}`;
    if (this.cfgKey === key && (this.starting || this.connection)) return; // tashmë e nisur
    if (this.cfgKey && this.cfgKey !== key) await this.stop();              // ndryshoi llogaria → rinis

    this.cfgKey = key;
    this.starting = true;
    this.set({ status: 'connecting', error: undefined });
    try {
      // Subpath '/web' = build-i ESM për shfletues (exports["./web"]); shmang problemin e
      // rezolvimit të specifier-it të zhveshur nga rezolvuesi commonjs i Vite-s.
      // Interop i sigurt: default mund të jetë i mbështjellë (UMD) → provoji format e mundshme.
      const mod = await import('metaapi.cloud-sdk/web') as Record<string, unknown>;
      const d = mod.default as Record<string, unknown> | undefined;
      const MetaApi = ((d && (d.default ?? d)) ?? mod.MetaApi ?? mod) as new (token: string, opts?: unknown) => unknown;
      this.api = new MetaApi(token, { region: regionFor(region) }) as typeof this.api;
      this.account = await this.api!.metatraderAccountApi.getAccount(accountId);
      try { if (this.account.state && this.account.state !== 'DEPLOYED') await this.account.deploy(); } catch { /* mund të jetë i deploy-uar */ }
      try { await this.account.waitConnected(); } catch { /* vazhdo; streaming pret vetë sinkronizimin */ }

      this.connection = this.account.getStreamingConnection();
      await this.connection.connect();
      this.set({ status: 'synchronizing' });
      await this.connection.waitSynchronized({ timeoutInSeconds: 60 });
      this.terminal = this.connection.terminalState;
      this.starting = false;
      this.retries = 0;
      this.set({ status: 'live' });

      for (const s of this.subsReq) this.tryResolveAndSubscribe(s); // ri-abono simbolet e kërkuara
      this.startPoll();
    } catch (e) {
      this.starting = false;
      this.set({ status: 'error', error: (e as Error)?.message || String(e) });
      this.scheduleRetry(token, accountId, region); // rikuperim automatik nga dështime kalimtare
    }
  }

  // Riprovon lidhjen me prapakthim eksponencial (deri në 6 herë) → s'ngec në REST nga një dështim kalimtar.
  private scheduleRetry(token: string, accountId: string, region: string) {
    if (this.retries >= 6) return;
    const delay = Math.min(30000, 3000 * 2 ** this.retries);
    this.retries++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.cfgKey = ''; this.connection = null; this.terminal = null; this.starting = false;
      void this.start(token, accountId, region);
    }, delay);
  }

  async subscribeSymbol(symbol: string): Promise<void> {
    if (!symbol) return;
    // Çelësi mbahet SI Ç'KËRKOHET (faqja kërkon 'XAUUSD', paneli kërkon emrin e brokerit të pozicionit)
    // që të dy ta gjejnë çmimin te stream.prices me të njëjtin çelës që përdorën.
    this.subsReq.add(symbol);
    if (this.connection && (this.snap.status === 'live' || this.snap.status === 'reconnecting')) this.tryResolveAndSubscribe(symbol);
  }

  // Gjen emrin REAL të simbolit te brokeri (XAUUSD → XAUUSD+/GOLD…) nga lista e specifikimeve dhe
  // abonon ATË. Nëse specs s'janë gati ende, lihet për readTerminal të riprovojë.
  private tryResolveAndSubscribe(base: string) {
    if (this.subBroker.has(base)) return;
    const broker = this.resolveBroker(base);
    if (!broker) return; // specs jo gati → riprovohet më vonë
    this.subBroker.set(base, broker);
    if (!this.subscribedBrokers.has(broker)) {
      this.subscribedBrokers.add(broker);
      try {
        void this.connection.subscribeToMarketData(broker, [
          { type: 'quotes' },
          { type: 'candles', timeframe: '1m' },
        ]);
      } catch { /* mund të jetë tashmë i abonuar */ }
    }
  }

  // Përkthen simbolin bazë në emrin e brokerit duke përdorur specifikimet e llogarisë + alias-e.
  private resolveBroker(base: string): string | null {
    if (this.specs.length === 0) {
      try { this.specs = ((this.terminal?.specifications || []) as Array<{ symbol?: string }>).map(s => String(s.symbol || '')).filter(Boolean); } catch { this.specs = []; }
    }
    const specs = this.specs;
    if (specs.length === 0) return null;
    const up = base.toUpperCase();
    let m = specs.find(s => s.toUpperCase() === up);                 // përputhje e saktë
    if (m) return m;
    m = specs.find(s => s.toUpperCase().startsWith(up));             // XAUUSD+, XAUUSD., XAUUSDm…
    if (m) return m;
    const aliases: Record<string, string[]> = {
      XAUUSD: ['GOLD', 'XAU/USD', 'XAUUSD'],
      XAGUSD: ['SILVER', 'XAG/USD'],
      USOIL: ['WTI', 'CRUDE', 'XTIUSD', 'USOUSD'],
      UKOIL: ['BRENT', 'XBRUSD', 'UKOUSD'],
      BTCUSD: ['BITCOIN', 'BTC/USD'],
      ETHUSD: ['ETHEREUM', 'ETH/USD'],
    };
    for (const a of (aliases[up] || [])) {
      const au = a.toUpperCase();
      m = specs.find(s => s.toUpperCase() === au || s.toUpperCase().startsWith(au));
      if (m) return m;
    }
    return null;
  }

  private startPoll() {
    if (this.pollId) clearInterval(this.pollId);
    this.pollId = setInterval(() => this.readTerminal(), 200);
    this.readTerminal();
  }

  // Lexon terminalState lokal (pa rrjet) → snapshot. terminalState mbahet i freskët nga websocket-i.
  private readTerminal() {
    if (!this.terminal) return;
    const prices: Record<string, StreamPrice> = {};
    let lastTickAt = 0;
    for (const base of this.subsReq) {
      if (!this.subBroker.has(base)) this.tryResolveAndSubscribe(base); // zgjidh emrin sapo specs janë gati
      const sym = this.subBroker.get(base) || base;
      try {
        const p = this.terminal.price(sym);
        const bid = Number(p?.bid), ask = Number(p?.ask);
        if (bid > 0 && ask > 0) {
          const t = p?.time ? new Date(p.time).getTime() : Date.now();
          prices[base] = { bid, ask, time: t }; // çelësi mbetet simboli i kërkuar (bazë)
          if (t > lastTickAt) lastTickAt = t;
        }
      } catch { /* ende pa çmim */ }
    }

    let positions: StreamPosition[] = [];
    let orders: unknown[] = [];
    let account: StreamSnapshot['account'] = null;
    let connectedToBroker = false;
    try {
      const raw = (this.terminal.positions || []) as Array<Record<string, unknown>>;
      positions = raw.map((p) => ({
        id: String(p.id),
        symbol: String(p.symbol),
        type: String(p.type || ''),
        volume: Number(p.volume || 0),
        openPrice: Number(p.openPrice || 0),
        currentPrice: Number(p.currentPrice || 0),
        profit: Number(p.profit ?? p.unrealizedProfit ?? 0),
        stopLoss: p.stopLoss != null ? Number(p.stopLoss) : undefined,
        takeProfit: p.takeProfit != null ? Number(p.takeProfit) : undefined,
        comment: p.comment != null ? String(p.comment) : undefined,
        clientId: p.clientId != null ? String(p.clientId) : undefined,
      }));
    } catch { /* injoro */ }
    try { orders = (this.terminal.orders || []) as unknown[]; } catch { /* injoro */ }
    try {
      const ai = this.terminal.accountInformation;
      if (ai) account = { balance: Number(ai.balance), equity: Number(ai.equity), currency: String(ai.currency || 'EUR') };
    } catch { /* injoro */ }
    try { connectedToBroker = !!this.terminal.connectedToBroker; } catch { /* injoro */ }

    // Statusi: nëse terminalState raporton i shkëputur → 'reconnecting'; përndryshe mbaj 'live'.
    let status: StreamStatus = this.snap.status;
    if (status === 'live' || status === 'reconnecting') {
      let connected = true;
      try { connected = this.terminal.connected !== false; } catch { /* injoro */ }
      status = connected ? 'live' : 'reconnecting';
    }

    this.set({ prices, positions, orders, account, connectedToBroker, lastTickAt, status });
  }

  async stop(): Promise<void> {
    if (this.pollId) { clearInterval(this.pollId); this.pollId = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.retries = 0;
    try { if (this.connection) await this.connection.close(); } catch { /* injoro */ }
    this.api = null; this.account = null; this.connection = null; this.terminal = null;
    this.subsReq.clear(); this.subBroker.clear(); this.subscribedBrokers.clear(); this.specs = [];
    this.cfgKey = ''; this.starting = false;
    this.set({ status: 'idle', connectedToBroker: false, prices: {}, positions: [], orders: [], account: null, lastTickAt: 0 });
  }
}

export const metaStream = new MetaStream();
