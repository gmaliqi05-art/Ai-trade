// Indikatorë minimalë e të pavarur për FastT (asnjë varësi nga motori ekzistues).

/** EMA mbi një varg vlerash; kthen të gjithë vargun (NaN deri sa mbushet periudha). */
export function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Vlera e fundit e EMA-s. */
export function emaLast(values, period) {
  const a = ema(values, period);
  return a[a.length - 1];
}

/** ATR (Wilder) — kthen vlerën e fundit; matës i volatilitetit për mbrojtje/buffer. */
export function atrLast(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n <= period) return NaN;
  const tr = new Array(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  for (let i = period + 1; i < n; i++) prev = (prev * (period - 1) + tr[i]) / period;
  return prev;
}
