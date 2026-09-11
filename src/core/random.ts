/** 可复现的随机数：默认真随机，--seed 时确定。 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed?: number): { rng: Rng; seed: number } {
  const s = seed ?? Math.floor(Math.random() * 0xffffffff);
  return { rng: mulberry32(s), seed: s };
}

/** [min, max] 闭区间随机整数。 */
export function randInt(rng: Rng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

export function pick<T>(rng: Rng, arr: readonly T[], fallback?: T): T {
  if (arr.length === 0) {
    if (fallback === undefined) throw new Error("pick() 收到空数组");
    return fallback;
  }
  return arr[Math.floor(rng() * arr.length)]!;
}

/**
 * 人类化偏移：在 [min,max] 内取随机值后，叠加 ±8% 的抖动，
 * 避免出现整齐划一的间隔（风控最容易识别的特征之一）。
 */
export function humanize(rng: Rng, min: number, max: number): number {
  const base = randInt(rng, min, max);
  if (base <= 0) return 0;
  const jitter = base * 0.08;
  return Math.max(0, Math.round(base + (rng() * 2 - 1) * jitter));
}
