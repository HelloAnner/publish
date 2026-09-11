/** 平台注册表：内置适配器 + 用户自定义 route。 */

import type { PlatformAdapter } from "./types.ts";

const ALIASES: Record<string, string> = {
  zhihu: "zhihu",
  "知乎": "zhihu",
  zhi: "zhihu",
  xhs: "xiaohongshu",
  xiaohongshu: "xiaohongshu",
  red: "xiaohongshu",
  redbook: "xiaohongshu",
  "小红书": "xiaohongshu",
  x: "twitter",
  twitter: "twitter",
  tweet: "twitter",
  "推特": "twitter",
  weibo: "weibo",
  "微博": "weibo",
};

export class Registry {
  private adapters = new Map<string, PlatformAdapter>();

  add(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): PlatformAdapter | undefined {
    return this.adapters.get(normalizePlatform(id));
  }

  has(id: string): boolean {
    return this.adapters.has(normalizePlatform(id));
  }

  list(): PlatformAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  ids(): string[] {
    return this.list().map((a) => a.id);
  }

  /** 解析用户输入，返回规范 id（找不到时返回规范化后的原值）。 */
  normalize(id: string): string {
    return normalizePlatform(id);
  }
}

export function normalizePlatform(id: string): string {
  const key = id.trim().toLowerCase();
  return ALIASES[key] ?? key;
}

/** 解析 -to 的多个值。 */
export function resolvePlatforms(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const id = normalizePlatform(v);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function describeMissingPlatform(id: string, available: string[]): string {
  return `未知平台 "${id}"。已注册：${available.join(", ")}\n自定义平台请放到 ~/.config/publish/routes/<id>.yaml，或参考：publish routes init <id>`;
}
