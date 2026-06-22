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
}

export interface ExecRow { action: string; symbol: string; signal_id: string | null; reason: string | null; created_at: string; stop_loss?: number | null; take_profit?: number | null; }

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
      tr.horizon = classifyHorizon(best.reason);
      if (best.stop_loss != null) tr.plannedSL = Number(best.stop_loss);
      if (best.take_profit != null) tr.plannedTP = Number(best.take_profit);
    }
    else tr.source = 'mt5';
  }
}
