// Ndihmës formatimi për UI-në e motorit.

import type { Action } from '../core/types';

export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(5);
}

export function fmtPct(value0to1: number): string {
  if (!Number.isFinite(value0to1)) return '—';
  return `${Math.round(value0to1 * 100)}%`;
}

/** Etiketa shqip për veprimin. */
export function actionLabel(action: Action): string {
  return action === 'BUY' ? 'BLEJ' : action === 'SELL' ? 'SHIT' : 'PRIT';
}

/** Klasat Tailwind për ngjyrën e veprimit. */
export function actionClasses(action: Action): string {
  if (action === 'BUY') return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (action === 'SELL') return 'bg-red-500/20 text-red-400 border-red-500/30';
  return 'bg-gray-700 text-gray-300 border-gray-600';
}
