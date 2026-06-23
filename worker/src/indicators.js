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

/** ADX (Wilder) — kthen vlerën e fundit; matës i FORCËS së trendit (jo drejtimit). >18 = trend real. */
export function adxLast(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n <= period * 2 + 1) return NaN;
  const pdm = new Array(n).fill(0), mdm = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let as = 0, ps = 0, ms = 0;
  for (let i = 1; i <= period; i++) { as += tr[i]; ps += pdm[i]; ms += mdm[i]; }
  const dx = new Array(n).fill(NaN);
  for (let i = period + 1; i < n; i++) {
    as = as - as / period + tr[i]; ps = ps - ps / period + pdm[i]; ms = ms - ms / period + mdm[i];
    const pdi = as === 0 ? 0 : 100 * ps / as, mdi = as === 0 ? 0 : 100 * ms / as;
    const den = pdi + mdi; dx[i] = den === 0 ? 0 : 100 * Math.abs(pdi - mdi) / den;
  }
  const f = dx.findIndex((x) => !Number.isNaN(x));
  if (f === -1 || f + period >= n) return NaN;
  let sum = 0; for (let i = f; i < f + period; i++) sum += dx[i];
  let prev = sum / period;
  for (let i = f + period; i < n; i++) prev = (prev * (period - 1) + dx[i]) / period;
  return prev;
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
