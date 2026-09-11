/** 参数解析：支持 -to / -c / -f 这类多字符短选项、--x=y、组合布尔、- 与 -- 约定。 */

import { UsageError } from "../core/errors.ts";
import { splitList } from "../core/util.ts";

export type FlagType = "string" | "boolean" | "number";

export interface FlagDef {
  name: string;
  alias?: string[];
  type: FlagType;
  multiple?: boolean;
  metavar?: string;
  group: "内容来源" | "目标平台" | "节奏与风控" | "输出" | "高级";
  help: string;
}

export const FLAGS: FlagDef[] = [
  // ── 内容来源 ──────────────────────────────────────────────
  { name: "content", alias: ["c"], type: "string", multiple: true, metavar: "<文本>", group: "内容来源", help: "直接给正文，可重复（多段=多篇）" },
  { name: "file", alias: ["f", "input"], type: "string", multiple: true, metavar: "<路径>", group: "内容来源", help: "从文件读正文，可重复；支持 glob；- 表示 stdin" },
  { name: "title", alias: ["t"], type: "string", metavar: "<标题>", group: "内容来源", help: "标题（单篇时生效；可被文件 front-matter 覆盖为逐篇标题）" },
  { name: "images", alias: ["i"], type: "string", multiple: true, metavar: "<路径>", group: "内容来源", help: "配图，逗号分隔或重复传入" },
  { name: "topics", alias: ["tag"], type: "string", multiple: true, metavar: "<话题>", group: "内容来源", help: "话题标签，逗号分隔或重复传入（不含 #）" },
  { name: "target", type: "string", multiple: true, metavar: "<spec>", group: "内容来源", help: "平台目标，如 zhihu=question:12345，或单平台时直接给 URL" },
  { name: "combine", type: "boolean", group: "内容来源", help: "把多个 -c/-f 合并成一篇，而不是分别发布" },

  // ── 目标平台 ─────────────────────────────────────────────
  { name: "platform", alias: ["to", "p"], type: "string", multiple: true, metavar: "<列表>", group: "目标平台", help: "目标平台，逗号分隔，可重复：zhihu,xhs,x / 别名 twitter,xiaohongshu" },

  // ── 节奏与风控 ───────────────────────────────────────────
  { name: "delay", type: "string", metavar: "<a-b|n>", group: "节奏与风控", help: "两次发布之间的随机等待秒数，默认 60-180，0 表示不等" },
  { name: "pre-delay", type: "string", metavar: "<a-b|n>", group: "节奏与风控", help: "开始前的随机等待秒数，默认 2-8" },
  { name: "min-interval", type: "number", metavar: "<分钟>", group: "节奏与风控", help: "同一平台两次发布的最小间隔，默认 20" },
  { name: "max-per-platform", type: "number", metavar: "<n>", group: "节奏与风控", help: "单平台每日发布上限，默认 5" },
  { name: "max-per-day", type: "number", metavar: "<n>", group: "节奏与风控", help: "全平台每日发布上限，默认 10" },
  { name: "no-guard", type: "boolean", group: "节奏与风控", help: "关闭频率护栏（等同于 --force）" },
  { name: "force", type: "boolean", group: "节奏与风控", help: "忽略护栏与字数超限，强行发布" },
  { name: "no-delay", type: "boolean", group: "节奏与风控", help: "跳过所有随机等待（慎用，风控风险高）" },
  { name: "draft", type: "boolean", group: "节奏与风控", help: "存草稿而不直接发布（小红书支持）" },
  { name: "thread", type: "boolean", group: "节奏与风控", help: "X 超长时自动拆成串（thread）" },
  { name: "allow-truncate", type: "boolean", group: "节奏与风控", help: "允许自动截断超限文案（默认只告警不截断）" },
  { name: "seed", type: "number", metavar: "<n>", group: "节奏与风控", help: "随机种子，便于复现等待节奏" },

  // ── 输出 ────────────────────────────────────────────────
  { name: "json", type: "boolean", group: "输出", help: "以 JSON 输出结果，便于脚本消费" },
  { name: "quiet", alias: ["q"], type: "boolean", group: "输出", help: "安静模式，只输出错误" },
  { name: "verbose", alias: ["v"], type: "boolean", group: "输出", help: "打印每次 opencli 调用的细节" },
  { name: "color", type: "boolean", group: "输出", help: "强制彩色输出" },
  { name: "no-color", type: "boolean", group: "输出", help: "关闭彩色输出" },
  { name: "yes", alias: ["y"], type: "boolean", group: "输出", help: "跳过发布前确认" },
  { name: "dry-run", alias: ["n"], type: "boolean", group: "输出", help: "只预演：打印将要执行的 opencli 命令，不做任何写操作" },
  { name: "help", alias: ["h"], type: "boolean", group: "输出", help: "显示帮助" },
  { name: "version", alias: ["V"], type: "boolean", group: "输出", help: "显示版本" },

  // ── 高级 ────────────────────────────────────────────────
  { name: "session", type: "string", metavar: "<名字>", group: "高级", help: "opencli 浏览器会话名，默认 publish" },
  { name: "window", type: "string", metavar: "<foreground|background>", group: "高级", help: "浏览器窗口模式" },
  { name: "timeout", type: "number", metavar: "<秒>", group: "高级", help: "单次 opencli 调用超时，默认 180" },
  { name: "opencli", type: "string", metavar: "<bin>", group: "高级", help: "opencli 可执行文件路径" },
  { name: "config", type: "string", metavar: "<路径>", group: "高级", help: "指定配置文件" },
  { name: "history", type: "string", metavar: "<路径>", group: "高级", help: "指定历史记录文件" },
  { name: "route-dir", type: "string", multiple: true, metavar: "<目录>", group: "高级", help: "额外 route 目录（自定义平台操作路径）" },
  { name: "cover", type: "string", metavar: "<auto|none|路径>", group: "高级", help: "无配图时自动生成封面，默认 auto" },
  { name: "keep-tab", type: "boolean", group: "高级", help: "保留 opencli 占用的浏览器标签页" },
  { name: "limit", type: "number", metavar: "<n>", group: "高级", help: "history/platforms 等只显示最近 n 条" },
];

const FLAG_BY_NAME = new Map<string, FlagDef>();
const FLAG_BY_ALIAS = new Map<string, FlagDef>();
for (const f of FLAGS) {
  FLAG_BY_NAME.set(f.name, f);
  for (const a of f.alias ?? []) FLAG_BY_ALIAS.set(a, f);
}

export class Flags {
  private map: Map<string, string[]>;

  constructor(map: Map<string, string[]>) {
    this.map = map;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  /** 非多值选项取最后一个；多值选项也返回最后一个。 */
  str(name: string): string | undefined {
    const v = this.map.get(name);
    if (!v || v.length === 0) return undefined;
    return v[v.length - 1];
  }

  all(name: string): string[] {
    return this.map.get(name) ?? [];
  }

  bool(name: string): boolean {
    const v = this.map.get(name);
    if (!v || v.length === 0) return false;
    return v[v.length - 1] !== "false";
  }

  num(name: string): number | undefined {
    const s = this.str(name);
    if (s === undefined) return undefined;
    const n = Number(s);
    if (!Number.isFinite(n)) throw new UsageError(`--${name} 需要数字，收到 "${s}"`);
    return n;
  }

  /** 展开所有逗号分隔的多值选项。 */
  list(name: string): string[] {
    return this.all(name).flatMap((v) => splitList(v));
  }
}

export interface ParsedArgs {
  command: string;
  rest: string[];
  flags: Flags;
  unknown: string[];
}

export const COMMANDS = [
  "publish",
  "login",
  "platforms",
  "history",
  "doctor",
  "explore",
  "routes",
  "config",
  "help",
  "version",
] as const;

const COMMAND_ALIASES: Record<string, string> = {
  pub: "publish",
  p: "publish",
  post: "publish",
  send: "publish",
  "ls-platforms": "platforms",
  list: "platforms",
  log: "history",
  check: "doctor",
  route: "routes",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const map = new Map<string, string[]>();
  const positionals: string[] = [];
  const unknown: string[] = [];

  const setValue = (def: FlagDef, value: string, forceMultiple = false) => {
    const arr = map.get(def.name) ?? [];
    if (def.multiple || forceMultiple) arr.push(value);
    else arr.splice(0, arr.length, value);
    map.set(def.name, arr);
  };
  const setFlag = (def: FlagDef, value: boolean) => {
    const arr = map.get(def.name) ?? [];
    arr.push(value ? "true" : "false");
    map.set(def.name, arr);
  };

  let i = 0;
  let literal = false;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (literal || tok === "-" || !tok.startsWith("-")) {
      positionals.push(tok);
      i += 1;
      continue;
    }
    if (tok === "--") {
      literal = true;
      i += 1;
      continue;
    }
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      let raw = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      const inline = eq === -1 ? undefined : tok.slice(eq + 1);
      let negated = false;
      // 先看是不是显式声明的 --no-xxx（例如 --no-guard/--no-delay/--no-color），
      // 再退化为通用的布尔取反 --no-<flag>。
      if (!FLAG_BY_NAME.has(raw) && raw.startsWith("no-")) {
        const cand = FLAG_BY_NAME.get(raw.slice(3));
        if (cand && cand.type === "boolean") {
          raw = raw.slice(3);
          negated = true;
        }
      }
      const def = FLAG_BY_NAME.get(raw);
      if (!def) {
        unknown.push(tok);
        i += 1;
        continue;
      }
      if (def.type === "boolean") {
        if (inline !== undefined && inline !== "") setValue(def, inline, true);
        else setFlag(def, !negated);
        i += 1;
        continue;
      }
      let value = inline;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError(`--${def.name} 缺少参数值`);
        value = next;
        i += 1;
      }
      setValue(def, value);
      i += 1;
      continue;
    }
    // 短选项
    const body = tok.slice(1);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      const def = FLAG_BY_ALIAS.get(body.slice(0, eq));
      if (!def) {
        unknown.push(tok);
        i += 1;
        continue;
      }
      setValue(def, body.slice(eq + 1), def.type === "boolean");
      i += 1;
      continue;
    }
    const exact = FLAG_BY_ALIAS.get(body);
    if (exact) {
      if (exact.type === "boolean") {
        setFlag(exact, true);
        i += 1;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`-${body} 缺少参数值`);
      setValue(exact, next);
      i += 2;
      continue;
    }
    const first = FLAG_BY_ALIAS.get(body.slice(0, 1));
    if (first) {
      if (first.type !== "boolean" && body.length > 1) {
        setValue(first, body.slice(1));
        i += 1;
        continue;
      }
      const chars = [...body];
      const allBool = chars.every((ch) => FLAG_BY_ALIAS.get(ch)?.type === "boolean");
      if (allBool) {
        for (const ch of chars) setFlag(FLAG_BY_ALIAS.get(ch)!, true);
        i += 1;
        continue;
      }
    }
    unknown.push(tok);
    i += 1;
  }

  // 命令只认 argv[0]：否则 -c "history" 这类正文会被误判成子命令
  let command = "publish";
  let rest = positionals;
  const head = argv[0];
  if (head && !head.startsWith("-") && positionals[0] === head) {
    const resolved = COMMAND_ALIASES[head] ?? head;
    if ((COMMANDS as readonly string[]).includes(resolved)) {
      command = resolved;
      rest = positionals.slice(1);
    }
  }

  return { command, rest, flags: new Flags(map), unknown };
}

export function flagHelp(group: FlagDef["group"]): FlagDef[] {
  return FLAGS.filter((f) => f.group === group);
}

export const FLAG_GROUPS: FlagDef["group"][] = ["内容来源", "目标平台", "节奏与风控", "输出", "高级"];
