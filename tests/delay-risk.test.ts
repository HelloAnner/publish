import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { planWaits, formatWait } from "../src/core/delay.ts";
import { createRng, humanize, randInt } from "../src/core/random.ts";
import { evaluateGuard } from "../src/core/risk.ts";
import type { GuardConfig, HistoryEntry } from "../src/core/types.ts";

const guardConfig: GuardConfig = { enabled: true, minIntervalMinutes: 20, maxPerDayPerPlatform: 5, maxPerDay: 10, quietHours: null };

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return { ts: new Date().toISOString(), platform: "xiaohongshu", ok: true, postId: "p", source: "-c", ...over };
}

describe("随机与人味儿", () => {
  test("同一 seed 结果可复现，且落在区间内", () => {
    const a = Array.from({ length: 20 }, () => humanize(createRng(42).rng, 1000, 2000));
    const b = Array.from({ length: 20 }, () => humanize(createRng(42).rng, 1000, 2000));
    expect(a).toEqual(b);
    for (const n of a) {
      expect(n).toBeGreaterThanOrEqual(900);
      expect(n).toBeLessThanOrEqual(2200);
    }
  });

  test("randInt 闭区间", () => {
    const rng = createRng(7).rng;
    for (let i = 0; i < 200; i++) {
      const n = randInt(rng, 3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

describe("planWaits", () => {
  test("三次发布 = 1 个预备等待 + 2 个间隔", () => {
    const waits = planWaits({ count: 3, config: DEFAULT_CONFIG.delay, rng: createRng(1).rng, includePre: true });
    expect(waits.map((w) => w.kind)).toEqual(["pre", "between", "between"]);
  });

  test("每 N 次插入长休息", () => {
    const waits = planWaits({
      count: 6,
      config: { ...DEFAULT_CONFIG.delay, longBreakEvery: 3, between: [1000, 1000], longBreak: [9000, 9000] },
      rng: createRng(2).rng,
    });
    expect(waits.filter((w) => w.kind === "long-break")).toHaveLength(1);
    expect(waits.find((w) => w.kind === "long-break")!.ms).toBeGreaterThan(8000);
  });

  test("disabled 时全部为 0", () => {
    const waits = planWaits({ count: 4, config: DEFAULT_CONFIG.delay, rng: createRng(3).rng, disabled: true });
    expect(waits.every((w) => w.ms === 0)).toBe(true);
  });

  test("formatWait 人类可读", () => {
    expect(formatWait(500)).toBe("500ms");
    expect(formatWait(90_000)).toBe("1m30s");
  });
});

describe("evaluateGuard", () => {
  test("刚发过就再发会被拦", () => {
    const report = evaluateGuard({
      history: [entry({ ts: new Date(Date.now() - 60_000).toISOString() })],
      platforms: ["xiaohongshu"],
      plannedPerPlatform: { xiaohongshu: 1 },
      config: guardConfig,
    });
    expect(report.violations.some((v) => v.kind === "min-interval")).toBe(true);
  });

  test("超过单平台/全平台每日上限会被拦", () => {
    const many = Array.from({ length: 5 }, (_, i) => entry({ ts: new Date(Date.now() - (i + 1) * 3600_000).toISOString() }));
    const report = evaluateGuard({
      history: many,
      platforms: ["xiaohongshu"],
      plannedPerPlatform: { xiaohongshu: 1 },
      config: guardConfig,
    });
    expect(report.violations.map((v) => v.kind)).toContain("daily-platform");
  });

  test("昨天的记录不影响今天", () => {
    const old = entry({ ts: new Date(Date.now() - 30 * 3600_000).toISOString() });
    const report = evaluateGuard({ history: [old], platforms: ["xiaohongshu"], plannedPerPlatform: { xiaohongshu: 1 }, config: guardConfig });
    expect(report.violations).toHaveLength(0);
  });

  test("关掉护栏就放行", () => {
    const report = evaluateGuard({
      history: [entry({})],
      platforms: ["xiaohongshu"],
      plannedPerPlatform: { xiaohongshu: 3 },
      config: { ...guardConfig, enabled: false },
    });
    expect(report.violations).toHaveLength(0);
  });

  test("预演记录不算真实发布", () => {
    const report = evaluateGuard({
      history: [entry({ dryRun: true })],
      platforms: ["xiaohongshu"],
      plannedPerPlatform: { xiaohongshu: 1 },
      config: guardConfig,
    });
    expect(report.violations).toHaveLength(0);
  });
});
