/* Deterministic, stateless randomness. Same inputs → same outputs, so telemetry and logs
   are stable across renders, ranges and reloads. */

function mix(h: number, v: number) {
  h = Math.imul(h ^ (v >>> 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return h >>> 0;
}

/** hash any list of (possibly huge) integers into a uint32 */
export function hash(...nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    const lo = n % 2147483648;
    const hi = Math.floor(n / 2147483648);
    h = mix(h, lo | 0);
    h = mix(h, hi | 0);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** 0..1 */
export function rand(...nums: number[]): number {
  return hash(...nums) / 4294967296;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** smooth value noise in [-1, 1] */
export function valueNoise(seed: number, t: number, period: number): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const a = rand(seed, i) * 2 - 1;
  const b = rand(seed, i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** fractal noise: layered octaves for an organic look */
export function fbm(seed: number, t: number, period: number): number {
  return (
    0.58 * valueNoise(seed, t, period) +
    0.28 * valueNoise(seed + 101, t, period / 3.1) +
    0.14 * valueNoise(seed + 202, t, period / 9.7)
  );
}

export function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;
}

/** sample a small Poisson-like count deterministically */
export function poisson(lambda: number, r1: number, r2: number): number {
  if (lambda <= 0) return 0;
  const base = Math.floor(lambda);
  const frac = lambda - base;
  const jitter = lambda > 3 ? Math.round((r2 - 0.5) * Math.sqrt(lambda) * 1.2) : 0;
  return Math.max(0, base + (r1 < frac ? 1 : 0) + jitter);
}

export function hex(n: number, len: number): string {
  let s = "";
  let x = n >>> 0;
  let salt = 1;
  while (s.length < len) {
    s += x.toString(16).padStart(8, "0");
    x = hash(x, salt++);
  }
  return s.slice(0, len);
}

/** mulberry32: seeded sequence generator for one-off simulations */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
