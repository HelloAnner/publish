/** 人类化节奏：随机等待 + 偶尔的长休息，避免机械式连发。 */

import type { DelayConfig } from "./types.ts";
import type { Rng } from "./random.ts";
import { humanize } from "./random.ts";

export interface DelayPlanOptions {
  count: number;
  config: DelayConfig;
  rng: Rng;
  /** 是否包含开始前的等待。 */
  includePre?: boolean;
  /** 全部置零（--no-delay）。 */
  disabled?: boolean;
}

export interface PlannedWait {
  /** 等待毫秒数。 */
  ms: number;
  /** 这次等待的性质。 */
  kind: "pre" | "between" | "long-break";
  label: string;
}

export function planWaits(o: DelayPlanOptions): PlannedWait[] {
  const { count, config, rng } = o;
  const waits: PlannedWait[] = [];
  const disabled = o.disabled ?? false;
  if (count <= 0) return waits;

  if (o.includePre ?? true) {
    waits.push({
      ms: disabled ? 0 : humanize(rng, config.pre[0], config.pre[1]),
      kind: "pre",
      label: "准备中",
    });
  }

  for (let i = 1; i < count; i++) {
    const isLongBreak = config.longBreakEvery > 0 && i % config.longBreakEvery === 0;
    const range = isLongBreak ? config.longBreak : config.between;
    waits.push({
      ms: disabled ? 0 : humanize(rng, range[0], range[1]),
      kind: isLongBreak ? "long-break" : "between",
      label: isLongBreak ? "长休息（避免连发特征）" : "下一次发布前",
    });
  }
  return waits;
}

export function formatWait(ms: number): string {
  if (ms < 1000) return ms + "ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return m + "m" + (rest ? rest + "s" : "");
}
