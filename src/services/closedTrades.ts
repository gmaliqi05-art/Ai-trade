// Përpunimi i historikut të MT5: grupon deal-et IN/OUT në trade të mbyllura me DREJTIMIN REAL,
// dhe i lidh me burimin (auto / sinjal / manual / direkt MT5) nga trade_executions.
// I përbashkët për Raportet dhe MetaTrader 5 Live.
import type { HistoryDeal } from './metaapi';

export type TradeSource = 'fastt' | 'auto' | 'signal' | 'manual' | 'mt5';

export interface ClosedTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | '?';
  openTime?: string;
  closeTime?: string;
  volume: number;
  entryPrice?: number;
  exitPrice?: number;
  /** SL/TP të planifikuara kur hyri trade-i (nga trade_executions) — për raportim profesional. */
  plannedSL?: number;
  plannedTP?: number;
  net: number; // profit + commission + swap
  source?: TradeSource;
  /** Afati i trade-it: afat-shkurt (scalp) ose afat-gjate (swing) — nga arsyeja e ekzekutimit. */
  horizon?: 'short' | 'long';
  /** ROBOTI që e hapi (emërtim i saktë për raporte): MMT-Long/MMT-Scalp/MMT-Fast/Sinjalet/Sinjalet-Scalp/FastT/Manuale. */
  robot?: string;
}

// Emri i SAKTË i robotit nga arsyeja e ekzekutimit (burimi autoritar i secilit robot).
export function robotOf(reason: string | null, signalId: string | null): string {
  const r = reason || '';
  if (/^MMT-F/i.test(r)) return 'MMT-Fast';
  if (/^MMT-S/i.test(r)) return 'MMT-Scalp';
  if (/^MMT[ \-]/i.test(r) || /^MMT auto/i.test(r)) return 'MMT-Long';
  if (/^FastT/i.test(r)) return 'FastT';
  if (/^scalp auto/i.test(r)) return 'Sinjalet-Scalp';
  if (/^auto ?\(/i.test(r) || signalId) return 'Sinjalet';
  return 'Manuale';
}
/** Emri i robotit nga komenti/clientId i një POZICIONI TË HAPUR (etiketat e porosive:
 *  MMT-F / MMT-S / MMT / SIG / SCALP / FastT). Pa etiketë → null (tregtim manual). */
export function robotOfPosition(p: { comment?: string; clientId?: string }): string | null {
  const s = `${p.comment ?? ''} ${p.clientId ?? ''}`;
  if (/MMT-F/i.test(s)) return 'MMT-Fast';
  if (/MMT-S/i.test(s)) return 'MMT-Scalp';
  if (/MMT/i.test(s)) return 'MMT-Long';
  if (/SCALP/i.test(s)) return 'Sinjalet-Scalp';
  if (/SIG/i.test(s)) return 'Sinjalet';
  if (/FastT/i.test(s)) return 'FastT';
  return null;
}
// Ngjyra e etiketës për çdo robot — e njëjta paletë me faqen MMT.
export function robotBadgeCls(robot?: string): string {
  switch (robot) {
    case 'MMT-Long': return 'bg-sky-500/20 text-sky-300';
    case 'MMT-Scalp': return 'bg-amber-500/20 text-amber-400';
    case 'MMT-Fast': return 'bg-purple-500/20 text-purple-300';
    case 'Sinjalet': return 'bg-emerald-500/20 text-emerald-300';
    case 'Sinjalet-Scalp': return 'bg-teal-500/20 text-teal-300';
    case 'FastT': return 'bg-rose-500/20 text-rose-400';
    default: return 'bg-gray-600/40 text-gray-400';
  }
}

export interface ExecRow { action: string; symbol: string; signal_id: string | null; reason: string | null; created_at: string; stop_loss?: number | null; take_profit?: number | null; }

// Rresht i plotë i ekzekutimit (hyrje + mbyllje) për të ndërtuar trade-t e FastT-it nga vetë logu.
export interface FasttExecRow {
  status: string; action: string; symbol: string;
  volume?: number | null; entry_price?: number | null; stop_loss?: number | null;
  reason: string | null; created_at: string; metaapi_order_id?: string | null;
}

// Nxjerr P&L-në (numrin e parë me presje dhjetore) nga arsyeja e mbylljes,
// p.sh. "… (-0.35)" → -0.35, "… fitim i kapur (+0.25, maja +0.33)" → +0.25.
function parseFasttNet(reason: string | null): number | null {
  const m = (reason || '').match(/[+-]?\d+\.\d+/);
  return m ? parseFloat(m[0]) : null;
}

// Ndërton trade-t e mbyllura të FastT-it DIREKT nga trade_executions (burimi autoritar i robotit):
// çiftëzon çdo hyrje ('executed', "FastT auto…") me mbylljen pasuese ('info', "FastT mbylli…") të
// të njëjtit simbol+drejtim. Kështu trade-t e FastT-it shfaqen GJITHMONË, pavarësisht historikut të MT5.
// Mbylljet e regjistruara nga serveri (tabela position_closes) → ClosedTrade. Çdo rresht = një trade
// i plotë (s'ka nevojë për çiftim) → burim i qëndrueshëm pavarësisht historikut të MT5.
export interface PositionCloseLike {
  position_id: string; symbol?: string | null; action?: string | null; volume?: number | null;
  entry_price?: number | null; exit_price?: number | null; net?: number | null;
  source?: string | null; horizon?: string | null; opened_at?: string | null; closed_at: string;
}
export function closesFromPositions(rows: PositionCloseLike[]): ClosedTrade[] {
  return rows.map((r) => ({
    id: r.position_id,
    symbol: r.symbol || '—',
    direction: (r.action || '').toUpperCase().includes('BUY') ? 'BUY' as const : 'SELL' as const,
    openTime: r.opened_at || undefined, closeTime: r.closed_at,
    volume: Number(r.volume) || 0,
    entryPrice: r.entry_price != null ? Number(r.entry_price) : undefined,
    exitPrice: r.exit_price != null ? Number(r.exit_price) : undefined,
    net: Number(r.net) || 0,
    source: (r.source as TradeSource) || 'mt5',
    robot: r.source === 'auto' ? 'Sinjalet' : r.source === 'fastt' ? 'FastT' : r.source === 'manual' ? 'Manuale' : undefined,
    horizon: (r.horizon === 'short' || r.horizon === 'long') ? r.horizon : undefined,
  }));
}

export function fasttFromExecutions(rows: FasttExecRow[]): ClosedTrade[] {
  const asc = [...rows].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const open: FasttExecRow[] = [];
  const out: ClosedTrade[] = [];
  for (const r of asc) {
    const reason = r.reason || '';
    if (r.status === 'executed' && /^fastt auto/i.test(reason)) {
      open.push(r);
    } else if (r.status === 'info' && /^fastt mbylli/i.test(reason)) {
      const idx = open.findIndex(o => (o.symbol || '').toUpperCase() === (r.symbol || '').toUpperCase() && o.action === r.action);
      const entry = idx >= 0 ? open.splice(idx, 1)[0] : null;
      const net = parseFasttNet(reason) ?? 0;
      const isBuy = (entry?.action || r.action || '').toUpperCase().includes('BUY');
      const ep = entry?.entry_price != null ? Number(entry.entry_price) : (r.entry_price != null ? Number(r.entry_price) : undefined);
      const exit = ep != null ? (isBuy ? ep + net : ep - net) : undefined;
      out.push({
        id: r.metaapi_order_id || `${entry?.created_at || ''}-${r.created_at}`,
        symbol: r.symbol || entry?.symbol || '—',
        direction: isBuy ? 'BUY' : 'SELL',
        openTime: entry?.created_at, closeTime: r.created_at,
        volume: entry?.volume != null ? Number(entry.volume) : 0,
        entryPrice: ep, exitPrice: exit,
        plannedSL: entry?.stop_loss != null ? Number(entry.stop_loss) : undefined,
        net, source: 'fastt', horizon: 'short', robot: 'FastT',
      });
    }
  }
  return out.sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || ''));
}

// Si u mbyll trade-i: prek TP-në e planifikuar, SL-në, apo doli ndryshe (manual/trailing)?
export function exitKind(t: ClosedTrade): 'tp' | 'sl' | 'other' {
  if (t.exitPrice == null) return 'other';
  const near = (b?: number) => b != null && Math.abs(t.exitPrice! - b) <= Math.max(0.5, Math.abs(b) * 0.0003);
  if (near(t.plannedTP)) return 'tp';
  if (near(t.plannedSL)) return 'sl';
  return 'other';
}

// Klasifikon burimin nga arsyeja + signal_id e regjistruar te trade_executions.
export function classifySource(reason: string | null, signalId: string | null): TradeSource {
  const r = (reason || '').toLowerCase();
  if (r.startsWith('fastt')) return 'fastt';
  if (r.startsWith('scalp auto') || r.startsWith('auto (') || r.startsWith('auto(')) return 'auto';
  if (signalId) return 'signal';
  return 'manual';
}

// Afati i trade-it nga arsyeja: scalp → afat-shkurt; auto/sinjal swing → afat-gjate; manual → s'dihet.
export function classifyHorizon(reason: string | null): 'short' | 'long' | undefined {
  const r = (reason || '').toLowerCase();
  if (r.startsWith('fastt') || r.startsWith('scalp')) return 'short';
  if (r.startsWith('auto (') || r.startsWith('auto(')) return 'long';
  return undefined;
}

// Klasifikon afatin e një POZICIONI TË HAPUR. Brokeri shpesh NUK e ruan komentin ('FastT'/'SCALP'),
// prandaj provojmë me radhë: (1) komentin, (2) id-në (orderId i hapjes == positionId), (3) çmim+kah
// më të afërt te logu i ekzekutimeve. Kthen 'short' (FastT/scalp) ose 'long' (sinjal/auto), ose undefined.
export interface PosLike { id?: string; type?: string; comment?: string; clientId?: string; openPrice?: number }
export interface HorizonExec { status?: string; action?: string; entry_price?: number | null; reason?: string | null; metaapi_order_id?: string | null }
export function positionHorizon(p: PosLike, execs: HorizonExec[]): 'short' | 'long' | undefined {
  if (/SCALP|FastT/i.test(`${p.comment ?? ''} ${p.clientId ?? ''}`)) return 'short';
  const ex = execs.filter(e => e.status === 'executed');
  const byId = p.id ? ex.find(e => e.metaapi_order_id && String(e.metaapi_order_id) === String(p.id)) : undefined;
  if (byId) { const h = classifyHorizon(byId.reason ?? null); if (h) return h; }
  const dir = (p.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL';
  const open = Number(p.openPrice);
  if (!Number.isFinite(open)) return undefined;
  let best: HorizonExec | null = null, bestDiff = Infinity;
  for (const e of ex) {
    if ((e.action || '').toUpperCase() !== dir || e.entry_price == null) continue;
    const diff = Math.abs(Number(e.entry_price) - open);
    if (diff < bestDiff) { bestDiff = diff; best = e; }
  }
  return best && bestDiff <= 2.0 ? classifyHorizon(best.reason ?? null) : undefined;
}

// Grupon deal-et e MT5 në trade të mbyllura. DREJTIMI merret nga deal-i HYRËS (IN), jo nga
// deal-i MBYLLËS (OUT) — sepse OUT i një SELL-i është një BUY (dhe anasjelltas).
export function groupDeals(deals: HistoryDeal[]): ClosedTrade[] {
  const m = new Map<string, ClosedTrade>();
  for (const d of deals) {
    const pid = d.positionId || d.id;
    if (!pid) continue;
    const et = (d.entryType || '').toUpperCase();
    const g = m.get(pid) || { id: pid, symbol: d.symbol || '—', direction: '?' as const, volume: 0, net: 0 };
    g.net += (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0);
    if (et.includes('IN')) {
      g.direction = (d.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL';
      g.entryPrice = Number(d.price) || g.entryPrice;
      g.openTime = d.time || g.openTime;
      g.volume = Number(d.volume) || g.volume;
      if (d.symbol) g.symbol = d.symbol;
    }
    if (et.includes('OUT')) {
      g.exitPrice = Number(d.price) || g.exitPrice;
      g.closeTime = d.time || g.closeTime;
      if (d.symbol && g.symbol === '—') g.symbol = d.symbol;
    }
    m.set(pid, g);
  }
  return [...m.values()]
    .filter(t => t.closeTime) // vetëm trade të mbyllura
    .sort((a, b) => (b.closeTime || '').localeCompare(a.closeTime || ''));
}

// Lidh secilin trade me burimin duke përputhur ekzekutimet (simbol + drejtim + kohë afër hapjes).
export function attachSource(trades: ClosedTrade[], execs: ExecRow[]): void {
  const used = new Set<ExecRow>();
  for (const tr of trades) {
    const openMs = tr.openTime ? new Date(tr.openTime).getTime() : (tr.closeTime ? new Date(tr.closeTime).getTime() : 0);
    let best: ExecRow | null = null, bestDiff = Infinity;
    for (const e of execs) {
      if (used.has(e)) continue;
      if ((e.symbol || '').toUpperCase() !== (tr.symbol || '').toUpperCase()) continue;
      if (e.action !== tr.direction) continue;
      const diff = Math.abs(new Date(e.created_at).getTime() - openMs);
      if (diff < bestDiff) { bestDiff = diff; best = e; }
    }
    if (best && bestDiff < 10 * 60 * 1000) {
      used.add(best); tr.source = classifySource(best.reason, best.signal_id);
      tr.robot = robotOf(best.reason, best.signal_id);
      tr.horizon = classifyHorizon(best.reason);
      if (best.stop_loss != null) tr.plannedSL = Number(best.stop_loss);
      if (best.take_profit != null) tr.plannedTP = Number(best.take_profit);
    }
    else tr.source = 'mt5';
  }
}
