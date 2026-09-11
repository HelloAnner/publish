/** 风控护栏：本地历史 + 频率检查。 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GuardConfig, HistoryEntry } from "./types.ts";
import { localDay, nowIso } from "./util.ts";

export interface GuardViolation {
  platform?: string;
  kind: "min-interval" | "daily-platform" | "daily-global";
  message: string;
  hint: string;
}

export interface GuardReport {
  violations: GuardViolation[];
  notes: string[];
}

export interface GuardInput {
  history: HistoryEntry[];
  platforms: string[];
  /** 本次将要执行的发布次数（平台 × 篇数）。 */
  plannedPerPlatform: Record<string, number>;
  config: GuardConfig;
  now?: Date;
}

function isReal(e: HistoryEntry): boolean {
  return e.ok && !e.dryRun;
}

export function evaluateGuard(input: GuardInput): GuardReport {
  const now = input.now ?? new Date();
  const cfg = input.config;
  const violations: GuardViolation[] = [];
  const notes: string[] = [];
  if (!cfg.enabled) return { violations, notes };

  const today = localDay(now);
  const real = input.history.filter(isReal);
  const todayEntries = real.filter((e) => localDay(new Date(e.ts)) === today);

  if (cfg.quietHours) {
    const h = now.getHours();
    const [start, end] = cfg.quietHours;
    const inQuiet = start <= end ? h >= start && h < end : h >= start || h < end;
    if (inQuiet) {
      notes.push(`当前处于静默时段 ${String(start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00，建议推迟发布`);
    }
  }

  const plannedTotal = Object.values(input.plannedPerPlatform).reduce((a, b) => a + b, 0);
  if (todayEntries.length + plannedTotal > cfg.maxPerDay) {
    violations.push({
      kind: "daily-global",
      message: `今日已发布 ${todayEntries.length} 次，本次计划 ${plannedTotal} 次，超过全平台每日上限 ${cfg.maxPerDay}`,
      hint: "拆到明天，或 --force 跳过（不推荐）",
    });
  }

  for (const platform of input.platforms) {
    const planned = input.plannedPerPlatform[platform] ?? 0;
    const entries = todayEntries.filter((e) => e.platform === platform);
    if (entries.length + planned > cfg.maxPerDayPerPlatform) {
      violations.push({
        platform,
        kind: "daily-platform",
        message: `${platform} 今日已发布 ${entries.length} 次，本次计划 ${planned} 次，超过单平台上限 ${cfg.maxPerDayPerPlatform}`,
        hint: "这是最容易触发风控的信号，建议减少次数",
      });
    }
    const last = real.filter((e) => e.platform === platform).sort((a, b) => b.ts.localeCompare(a.ts))[0];
    if (last) {
      const elapsedMin = (now.getTime() - new Date(last.ts).getTime()) / 60_000;
      if (elapsedMin < cfg.minIntervalMinutes) {
        const wait = Math.ceil(cfg.minIntervalMinutes - elapsedMin);
        violations.push({
          platform,
          kind: "min-interval",
          message: `${platform} 距上次发布仅 ${elapsedMin.toFixed(1)} 分钟（要求 ≥ ${cfg.minIntervalMinutes} 分钟）`,
          hint: `大致还需等待 ${wait} 分钟；可加 --delay 拉长本次间隔，或 --force 跳过`,
        });
      }
    }
  }

  return { violations, notes };
}

export async function readHistory(path: string): Promise<HistoryEntry[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as HistoryEntry;
      if (parsed && typeof parsed === "object" && parsed.ts && parsed.platform) out.push(parsed);
    } catch {
      /* 忽略坏行 */
    }
  }
  return out;
}

export async function appendHistory(path: string, entry: Omit<HistoryEntry, "ts"> & { ts?: string }): Promise<HistoryEntry> {
  const full: HistoryEntry = { ts: entry.ts ?? nowIso(), ...entry } as HistoryEntry;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(full) + "\n", "utf8");
  return full;
}
