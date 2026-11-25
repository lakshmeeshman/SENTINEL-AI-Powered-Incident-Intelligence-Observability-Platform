/*
 * Anomaly detection.
 *
 * 1. Adaptive robust baseline (streaming): a rolling window of the last W *non-anomalous*
 *    points. Score = (x − median) / (1.4826 · MAD). Anomalous points don't contaminate the
 *    baseline, so a long incident stays flagged; after a sustained level shift (> 3W points)
 *    the new level is accepted as normal.
 * 2. Frozen baseline (forensic): stats from a pre-incident window, used by the RCA engine
 *    to find onset time and peak deviation per service and metric.
 *
 * A relative-change floor prevents tiny absolute moves on very stable metrics from being
 * flagged, and a minimum run length suppresses single-point blips.
 */

export interface Sample {
  t: number;
  v: number;
}

export interface AnomalySegment {
  start: number;
  end: number;
  peakT: number;
  peakValue: number;
  peakZ: number;
  baseline: number;
}

export interface RobustStats {
  median: number;
  mad: number;
  sigma: number;
  mean: number;
  std: number;
}

export function robustStats(values: number[]): RobustStats {
  if (!values.length) return { median: 0, mad: 0, sigma: 1, mean: 0, std: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const dev = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = quantile(dev, 0.5);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const sigma = Math.max(1.4826 * mad, Math.abs(median) * 0.025, 1e-6);
  return { median, mad, sigma, mean, std };
}

export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface DetectOptions {
  window?: number;
  threshold?: number;
  minRun?: number;
  direction?: "up" | "down" | "both";
  /** minimum |x − median| / median to count as anomalous */
  minRelative?: number;
  /** after this many consecutive anomalous points, accept the new level as normal (default 3W) */
  adaptAfter?: number;
}

export interface DetectResult {
  scores: number[];
  baseline: number[];
  flags: boolean[];
  segments: AnomalySegment[];
}

export function detectAdaptive(samples: Sample[], opts: DetectOptions = {}): DetectResult {
  const W = opts.window ?? 30;
  const thr = opts.threshold ?? 3.5;
  const minRun = opts.minRun ?? 2;
  const dir = opts.direction ?? "up";
  const minRel = opts.minRelative ?? 0.2;
  const adaptAfter = opts.adaptAfter ?? W * 3;

  const buf: number[] = [];
  const scores: number[] = [];
  const baseline: number[] = [];
  const raw: boolean[] = [];
  let anomalousStreak = 0;

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!.v;
    if (buf.length < Math.min(10, W)) {
      buf.push(x);
      scores.push(0);
      baseline.push(x);
      raw.push(false);
      continue;
    }
    const st = robustStats(buf);
    const z = (x - st.median) / st.sigma;
    const rel = Math.abs(x - st.median) / Math.max(Math.abs(st.median), 1e-6);
    const directional = dir === "up" ? z : dir === "down" ? -z : Math.abs(z);
    const isAnom = directional > thr && rel > minRel;
    scores.push(z);
    baseline.push(st.median);
    raw.push(isAnom);
    if (isAnom) {
      anomalousStreak++;
      if (anomalousStreak > adaptAfter) {
        // sustained level shift: accept as the new normal
        buf.push(x);
        if (buf.length > W) buf.shift();
      }
    } else {
      anomalousStreak = 0;
      buf.push(x);
      if (buf.length > W) buf.shift();
    }
  }

  const flags = applyMinRun(raw, minRun);
  return { scores, baseline, flags, segments: toSegments(samples, flags, scores, baseline) };
}

/** score every sample against a fixed baseline window (forensic mode) */
export function detectAgainstBaseline(
  samples: Sample[],
  baselineValues: number[],
  opts: Omit<DetectOptions, "window"> = {}
): DetectResult & { stats: RobustStats } {
  const thr = opts.threshold ?? 3.5;
  const minRun = opts.minRun ?? 2;
  const dir = opts.direction ?? "up";
  const minRel = opts.minRelative ?? 0.2;
  const st = robustStats(baselineValues);
  const scores = samples.map((s) => (s.v - st.median) / st.sigma);
  const raw = samples.map((s, i) => {
    const z = scores[i]!;
    const d = dir === "up" ? z : dir === "down" ? -z : Math.abs(z);
    const rel = Math.abs(s.v - st.median) / Math.max(Math.abs(st.median), 1e-6);
    return d > thr && rel > minRel;
  });
  const flags = applyMinRun(raw, minRun);
  const baseline = samples.map(() => st.median);
  return { scores, baseline, flags, segments: toSegments(samples, flags, scores, baseline), stats: st };
}

function applyMinRun(raw: boolean[], minRun: number): boolean[] {
  const out = new Array<boolean>(raw.length).fill(false);
  let i = 0;
  while (i < raw.length) {
    if (!raw[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < raw.length && raw[j]) j++;
    if (j - i >= minRun) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  return out;
}

function toSegments(samples: Sample[], flags: boolean[], scores: number[], baseline: number[]): AnomalySegment[] {
  const segs: AnomalySegment[] = [];
  let cur: AnomalySegment | null = null;
  for (let i = 0; i < samples.length; i++) {
    if (flags[i]) {
      const s = samples[i]!;
      if (!cur) cur = { start: s.t, end: s.t, peakT: s.t, peakValue: s.v, peakZ: scores[i]!, baseline: baseline[i]! };
      cur.end = s.t;
      if (Math.abs(scores[i]!) > Math.abs(cur.peakZ)) {
        cur.peakZ = scores[i]!;
        cur.peakT = s.t;
        cur.peakValue = s.v;
      }
    } else if (cur) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

/** least-squares slope per minute; used to recognise monotonic growth (leaks, lag) */
export function slopePerMinute(samples: Sample[]): number {
  const n = samples.length;
  if (n < 3) return 0;
  const t0 = samples[0]!.t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 60_000;
    sx += x;
    sy += s.v;
    sxx += x * x;
    sxy += x * s.v;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

/** exponentially weighted moving average */
export function ewma(values: number[], alpha = 0.3): number[] {
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}
