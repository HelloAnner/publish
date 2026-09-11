import { describe, expect, test } from "bun:test";
import { applyCliOverrides } from "../src/cli/main.ts";
import { parseArgs } from "../src/cli/args.ts";
import { DEFAULT_CONFIG, deepMerge, parseRangeSeconds } from "../src/core/config.ts";
import { COVER_STYLES } from "../src/core/cover.ts";
import type { PublishConfig } from "../src/core/types.ts";

function fresh(): PublishConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as PublishConfig;
}

describe("配置默认值", () => {
  test("封面默认是纸感、字号 1、白底黑字", () => {
    expect(DEFAULT_CONFIG.cover.style).toBe("纸感");
    expect(DEFAULT_CONFIG.cover.scale).toBe(1);
    expect(COVER_STYLES[0]).toBe("纸感");
    expect(COVER_STYLES).toContain("简约");
  });

  test("默认后台窗口，节奏与护栏是保守值", () => {
    expect(DEFAULT_CONFIG.opencli.window).toBe("background");
    expect(DEFAULT_CONFIG.guard.minIntervalMinutes).toBe(20);
    expect(DEFAULT_CONFIG.guard.maxPerDayPerPlatform).toBe(5);
    expect(DEFAULT_CONFIG.delay.between).toEqual([60_000, 180_000]);
  });
});

describe("parseRangeSeconds", () => {
  test("支持 a-b / a~b / 单值", () => {
    expect(parseRangeSeconds("60-180")).toEqual([60_000, 180_000]);
    expect(parseRangeSeconds("180~60")).toEqual([60_000, 180_000]);
    expect(parseRangeSeconds("0")).toEqual([0, 0]);
    expect(parseRangeSeconds("oops")).toBeNull();
  });
});

describe("deepMerge", () => {
  test("递归合并对象、整体替换数组", () => {
    const merged = deepMerge({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 9 }, list: [3] });
    expect(merged).toEqual({ a: { b: 1, c: 9 }, list: [3] });
  });
});

describe("applyCliOverrides", () => {
  test("命令行参数覆盖配置", () => {
    const cfg = fresh();
    const flags = parseArgs([
      "--delay", "30-60",
      "--pre-delay", "1",
      "--min-interval", "5",
      "--max-per-day", "3",
      "--cover-style", "简约",
      "--cover-scale", "0.88",
      "--no-guard",
      "--session", "mysession",
      "--window", "foreground",
      "--timeout", "60",
    ]).flags;
    applyCliOverrides(cfg, flags);
    expect(cfg.delay.between).toEqual([30_000, 60_000]);
    expect(cfg.delay.pre).toEqual([1_000, 1_000]);
    expect(cfg.guard.enabled).toBe(false);
    expect(cfg.guard.minIntervalMinutes).toBe(5);
    expect(cfg.guard.maxPerDay).toBe(3);
    expect(cfg.cover.style).toBe("简约");
    expect(cfg.cover.scale).toBe(0.88);
    expect(cfg.opencli.session).toBe("mysession");
    expect(cfg.opencli.window).toBe("foreground");
    expect(cfg.opencli.timeoutMs).toBe(60_000);
  });

  test("--no-delay 把前后等待都清零", () => {
    const cfg = fresh();
    applyCliOverrides(cfg, parseArgs(["--no-delay"]).flags);
    expect(cfg.delay.pre).toEqual([0, 0]);
    expect(cfg.delay.between).toEqual([0, 0]);
  });

  test("非法 cover-scale 回退为 1", () => {
    const cfg = fresh();
    applyCliOverrides(cfg, parseArgs(["--cover-scale", "-2"]).flags);
    expect(cfg.cover.scale).toBe(1);
  });
});
