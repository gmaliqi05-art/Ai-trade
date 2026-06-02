// Indikatorë teknikë — funksione të pastra mbi seri çmimesh.
// Të gjitha kthejnë vargje me të njëjtën gjatësi si hyrja; vlerat e periudhës së
// "ngrohjes" (warmup) janë NaN, që alinjimi me qirinjtë të jetë i drejtpërdrejtë.

/** Mesatarja e thjeshtë lëvizëse. */
export function sma(values: number[], period: number): number[] {
  if (period <= 0) throw new Error('period duhet > 0');
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Mesatarja eksponenciale lëvizëse (e mbjellë me SMA-në e parë). */
export function ema(values: number[], period: number): number[] {
  if (period <= 0) throw new Error('period duhet > 0');
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Mbjellja: SMA e `period` vlerave të para.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Indeksi i Fuqisë Relative (RSI) me zbutje sipas Wilder-it. */
export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gainSum += ch;
    else lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAvg(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAvg(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

/** MACD: linja, sinjali dhe histograma. */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i])
      ? NaN
      : emaFast[i] - emaSlow[i],
  );
  // EMA e sinjalit llogaritet vetëm mbi pjesën e vlefshme të macdLine.
  const firstValid = macdLine.findIndex((v) => !Number.isNaN(v));
  const signal: number[] = new Array(values.length).fill(NaN);
  if (firstValid !== -1) {
    const slice = macdLine.slice(firstValid);
    const sig = ema(slice, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i];
  }
  const histogram = values.map((_, i) =>
    Number.isNaN(macdLine[i]) || Number.isNaN(signal[i])
      ? NaN
      : macdLine[i] - signal[i],
  );
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

/** Brezat e Bollinger-it (devijim standard popullsie). */
export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): BollingerResult {
  const middle = sma(values, period);
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/** Average True Range (ATR) me zbutje sipas Wilder-it — masë e paqëndrueshmërisë. */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const n = closes.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n <= period) return out;
  const tr: number[] = new Array(n).fill(NaN);
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
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}
