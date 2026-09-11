/** 与具体平台无关的数据结构。 */

import type { UI } from "./ui.ts";

export type PlatformId = string;

/** 字数计算方式：weighted = CJK 算 2、链接按平台规则折算；chars = 直观字符数。 */
export type LengthMode = "weighted" | "chars";

export interface PlatformCapabilities {
  /** 是否支持纯文本发布。 */
  text: boolean;
  /** 最多图片数，0 表示不支持图片。 */
  images: number;
  /** 是否必须带图片（可用封面兜底）。 */
  requiresImage: boolean;
  /** 是否有独立标题字段。 */
  title: boolean;
  maxTitleLength?: number;
  /** 正文最大长度，undefined 表示无硬限制。 */
  maxTextLength?: number;
  lengthMode: LengthMode;
  /** weighted 模式下链接的权重（X 为 23）。 */
  urlWeight?: number;
  /** 是否支持话题/标签。 */
  topics: boolean;
  /** 是否支持「存草稿」。 */
  draft: boolean;
}

/** 一篇待发布内容（来自 -c / -f / stdin）。 */
export interface Post {
  id: string;
  title?: string;
  body: string;
  topics: string[];
  images: string[];
  /** 平台侧目标（目前主要用于知乎问题）。 */
  target?: string;
  /** 内容来源描述，用于日志。 */
  source: string;
  /** front-matter 中的平台覆盖项。 */
  overrides: Record<string, Record<string, unknown>>;
}

export interface AuthState {
  loggedIn: boolean;
  username?: string;
  detail?: string;
}

export interface PreparedPublish {
  platform: PlatformId;
  platformName: string;
  postId: string;
  postSource: string;
  title?: string;
  text: string;
  images: string[];
  /** 将要执行的 opencli 参数（不含可执行文件本身）。 */
  args: string[];
  /** 完整命令序列（线程/串行多步时大于 1 条）。 */
  plan: string[][];
  warnings: string[];
  errors: string[];
  /** 人类可读的备注，例如「走文字配图模式」。 */
  notes: string[];
  /** route 适配器渲染模板用的变量。 */
  vars?: Record<string, string>;
}

export interface PublishOutcome {
  ok: boolean;
  url?: string;
  detail?: string;
  error?: string;
  raw?: unknown;
}

export interface PublishRunOptions {
  thread: boolean;
  draft: boolean;
  allowTruncate: boolean;
  force: boolean;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type Runner = (
  cmd: string[],
  opts?: { timeoutMs?: number; cwd?: string; env?: Record<string, string | undefined> },
) => Promise<ExecResult>;

export interface PrepareContext {
  config: PublishConfig;
  ui: UI;
  dryRun: boolean;
  run: Runner;
  options: PublishRunOptions;
}

export interface RunContext extends PrepareContext {
  signal?: AbortSignal;
}

export interface PlatformAdapter {
  id: PlatformId;
  name: string;
  /** opencli 的 site 名，用于登录检查（可选）。 */
  site?: string;
  capabilities: PlatformCapabilities;
  /** 自定义登录检查；缺省时用 opencli <site> whoami。 */
  checkAuth?(ctx: RunContext): Promise<AuthState>;
  prepare(post: Post, ctx: PrepareContext): Promise<PreparedPublish>;
  publish(prepared: PreparedPublish, ctx: RunContext): Promise<PublishOutcome>;
  /** 额外帮助信息，例如知乎需要 question 目标。 */
  requirements?: string[];
  /** 自定义 route 时记录来源文件。 */
  routePath?: string;
}

export interface HistoryEntry {
  ts: string;
  platform: PlatformId;
  ok: boolean;
  postId: string;
  title?: string;
  source: string;
  url?: string;
  error?: string;
  dryRun?: boolean;
  durationMs?: number;
}

export interface DelayConfig {
  /** 开始前的随机等待（毫秒区间）。 */
  pre: [number, number];
  /** 两次发布之间的随机等待（毫秒区间）。 */
  between: [number, number];
  /** 每 N 次发布后插入一次长休息。 */
  longBreakEvery: number;
  longBreak: [number, number];
  /** 是否打印倒计时。 */
  showCountdown: boolean;
}

export interface GuardConfig {
  enabled: boolean;
  /** 同一平台两次发布的最小间隔（分钟）。 */
  minIntervalMinutes: number;
  /** 单平台每日上限。 */
  maxPerDayPerPlatform: number;
  /** 全平台每日上限。 */
  maxPerDay: number;
  /** 静默时段 [startHour, endHour)，命中时警告。 */
  quietHours: [number, number] | null;
}

export interface ImageConfig {
  maxBytesPerImage: number;
  autoCompressOverBytes: number;
  autoCompress: boolean;
}

export interface CoverConfig {
  enabled: boolean;
  renderer: "auto" | "pillow" | "card";
  style: string;
  width: number;
  height: number;
  python: string;
}

export interface OpencliConfig {
  binary: string;
  timeoutMs: number;
  window: "foreground" | "background";
  session: string;
  keepTab: boolean;
}

export interface PublishConfig {
  delay: DelayConfig;
  guard: GuardConfig;
  images: ImageConfig;
  cover: CoverConfig;
  opencli: OpencliConfig;
  /** 额外的 route 目录（在前，优先级更高）。 */
  routeDirs: string[];
  defaults: {
    platforms: string[];
    draft: boolean;
  };
  platforms: Record<string, Record<string, unknown>>;
  /** 配置文件来源，便于 doctor 展示。 */
  sources: string[];
}
