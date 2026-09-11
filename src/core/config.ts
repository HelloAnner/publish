/** 配置加载：内置默认值 <- 全局 config.json <- 项目配置 <- 环境变量 <- CLI 覆盖。 */

import { join } from "node:path";
import { globalConfigFile } from "./paths.ts";
import type { PublishConfig } from "./types.ts";
import { readStructuredFile } from "./yaml.ts";

export const DEFAULT_CONFIG: PublishConfig = {
  delay: {
    pre: [2_000, 8_000],
    between: [60_000, 180_000],
    longBreakEvery: 5,
    longBreak: [300_000, 600_000],
    showCountdown: true,
  },
  guard: {
    enabled: true,
    minIntervalMinutes: 20,
    maxPerDayPerPlatform: 5,
    maxPerDay: 10,
    quietHours: null,
  },
  images: {
    maxBytesPerImage: 1_200_000,
    autoCompressOverBytes: 1_500_000,
    autoCompress: false,
  },
  cover: {
    enabled: true,
    renderer: "auto",
    style: "简约",
    width: 1080,
    height: 1440,
    python: "python3",
  },
  opencli: {
    binary: "opencli",
    timeoutMs: 180_000,
    window: "background",
    session: "publish",
    keepTab: false,
  },
  routeDirs: [],
  defaults: {
    platforms: [],
    draft: false,
  },
  platforms: {},
  sources: [],
};

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Json = isPlainObject(base) ? { ...(base as Json) } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(v) && isPlainObject(cur)) out[k] = deepMerge(cur, v);
    else out[k] = v;
  }
  return out as T;
}

export interface LoadConfigOptions {
  cwd?: string;
  explicitPath?: string;
  env?: Record<string, string | undefined>;
  /** 跳过项目内配置文件（doctor 需要）。 */
  skipProject?: boolean;
}

export function projectConfigCandidates(cwd: string): string[] {
  return [
    join(cwd, ".publishrc.json"),
    join(cwd, ".publishrc.yaml"),
    join(cwd, ".publishrc.yml"),
    join(cwd, "publish.config.json"),
    join(cwd, "publish.config.yaml"),
    join(cwd, "publish.config.yml"),
  ];
}

function applyEnv(cfg: PublishConfig, env: Record<string, string | undefined>): PublishConfig {
  const out = { ...cfg, delay: { ...cfg.delay }, guard: { ...cfg.guard }, opencli: { ...cfg.opencli } };
  if (env.PUBLISH_OPENCLI) out.opencli.binary = env.PUBLISH_OPENCLI;
  if (env.PUBLISH_SESSION) out.opencli.session = env.PUBLISH_SESSION;
  if (env.PUBLISH_WINDOW === "foreground" || env.PUBLISH_WINDOW === "background") out.opencli.window = env.PUBLISH_WINDOW;
  if (env.PUBLISH_DELAY) {
    const r = parseRangeSeconds(env.PUBLISH_DELAY);
    if (r) out.delay.between = r;
  }
  if (env.PUBLISH_GUARD === "0" || env.PUBLISH_GUARD === "false") out.guard.enabled = false;
  if (env.PUBLISH_MAX_PER_DAY) {
    const n = Number(env.PUBLISH_MAX_PER_DAY);
    if (Number.isFinite(n)) out.guard.maxPerDay = n;
  }
  if (env.PUBLISH_MIN_INTERVAL) {
    const n = Number(env.PUBLISH_MIN_INTERVAL);
    if (Number.isFinite(n)) out.guard.minIntervalMinutes = n;
  }
  return out;
}

/** 解析 "60-180" / "90" / "0" 秒区间，返回毫秒区间。 */
export function parseRangeSeconds(text: string, fallback?: [number, number]): [number, number] | null {
  const t = text.trim();
  if (!t) return fallback ?? null;
  const m = /^(\d+(?:\.\d+)?)\s*(?:-|~|,|至)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return [Math.min(a, b) * 1000, Math.max(a, b) * 1000];
  }
  const n = Number(t);
  if (Number.isFinite(n)) return [n * 1000, n * 1000];
  return fallback ?? null;
}

export async function loadConfig(opts: LoadConfigOptions = {}): Promise<PublishConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  let cfg: PublishConfig = structuredCloneSafe(DEFAULT_CONFIG);
  const sources: string[] = [];

  const files: string[] = [];
  if (opts.explicitPath) files.push(opts.explicitPath);
  else {
    files.push(globalConfigFile());
    if (!opts.skipProject) files.push(...projectConfigCandidates(cwd));
  }

  for (const path of files) {
    const exists = await Bun.file(path).exists();
    if (!exists) {
      if (opts.explicitPath) throw new Error(`--config 指定的文件不存在：${path}`);
      continue;
    }
    let data: unknown;
    try {
      data = await readStructuredFile(path);
    } catch (err) {
      throw new Error(`配置文件读取失败 ${path}：${(err as Error).message}`);
    }
    cfg = deepMerge(cfg, data);
    sources.push(path);
  }

  cfg = applyEnv(cfg, env);
  cfg.sources = sources;
  return cfg;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function configPaths(): { global: string; project: string[] } {
  return { global: globalConfigFile(), project: projectConfigCandidates(process.cwd()) };
}
