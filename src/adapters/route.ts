/**
 * 通用 route 适配器：用声明式的浏览器操作路径驱动 opencli browser 原语，
 * 让「opencli 还没有命令」的站点也能发。
 *
 * route 文件放在 ~/.config/publish/routes/<id>.yaml，例如：
 *
 *   id: weibo
 *   name: 微博
 *   capabilities: { text: true, images: 9, maxTextLength: 2000 }
 *   steps:
 *     - open: https://weibo.com/compose
 *     - wait: { selector: "textarea", timeout: 20000 }
 *     - pause: [900, 2400]
 *     - fill: { target: "textarea", text: "{{content}}" }
 *     - click: { target: "text=发送" }
 *     - expect: { text: "发布成功" }
 */

import { extname } from "node:path";
import { callOpencli, type OpencliResult } from "../core/opencli.ts";
import { createRng, humanize } from "../core/random.ts";
import type {
  AuthState,
  PlatformAdapter,
  PlatformCapabilities,
  PrepareContext,
  PreparedPublish,
  PublishOutcome,
  Post,
  RunContext,
} from "../core/types.ts";
import { sleep } from "../core/ui.ts";
import { readStructuredFile } from "../core/yaml.ts";

export type RouteStep = Record<string, unknown>;

export interface RouteCheck {
  selector?: string;
  text?: string;
  url?: string;
  js?: string;
  equals?: unknown;
  timeout?: number;
}

export interface RouteDefinition {
  id: string;
  name: string;
  site?: string;
  session?: string;
  capabilities: Partial<PlatformCapabilities>;
  auth?: { site?: string; command?: string[]; steps?: RouteStep[] };
  vars?: Record<string, string>;
  steps: RouteStep[];
  verify?: RouteCheck;
  captureUrl?: boolean;
  path?: string;
}

const BROWSER_STEP_KEYS = new Set([
  "open",
  "back",
  "scroll",
  "state",
  "screenshot",
  "console",
  "find",
  "get",
  "click",
  "type",
  "hover",
  "focus",
  "dblclick",
  "check",
  "uncheck",
  "upload",
  "drag",
  "fill",
  "select",
  "keys",
  "wait",
  "eval",
  "extract",
  "frames",
]);

export class RouteError extends Error {}

function requireString(value: unknown, what: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  throw new RouteError(`route 字段 ${what} 需要字符串`);
}

export function parseRoute(data: unknown, path: string): RouteDefinition {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RouteError(`${path} 顶层必须是对象`);
  }
  const obj = data as Record<string, unknown>;
  const id = requireString(obj.id, "id");
  const steps = obj.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RouteError(`${path} 缺少非空的 steps 数组`);
  }
  for (const [i, step] of steps.entries()) {
    validateStep(step, i, path);
  }
  const capabilities = (obj.capabilities ?? {}) as Partial<PlatformCapabilities>;
  return {
    id,
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name : id,
    site: typeof obj.site === "string" ? obj.site : undefined,
    session: typeof obj.session === "string" ? obj.session : undefined,
    capabilities,
    auth: (obj.auth ?? undefined) as RouteDefinition["auth"],
    vars: (obj.vars ?? undefined) as Record<string, string> | undefined,
    steps: steps as RouteStep[],
    verify: (obj.verify ?? undefined) as RouteCheck | undefined,
    captureUrl: obj.captureUrl === undefined ? true : Boolean(obj.captureUrl),
    path,
  };
}

function validateStep(step: unknown, index: number, path: string): void {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new RouteError(`${path} 第 ${index + 1} 个 step 必须是对象`);
  }
  const keys = Object.keys(step as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new RouteError(`${path} 第 ${index + 1} 个 step 必须只有一个动作键，收到：${keys.join(", ")}`);
  }
  const key = keys[0]!;
  if (key === "pause" || key === "expect") return;
  if (!BROWSER_STEP_KEYS.has(key)) {
    throw new RouteError(`${path} 第 ${index + 1} 个 step 用了未知动作 "${key}"`);
  }
}

export const DEFAULT_ROUTE_CAPS: PlatformCapabilities = {
  text: true,
  images: 9,
  requiresImage: false,
  title: true,
  maxTextLength: 5000,
  lengthMode: "chars",
  topics: true,
  draft: false,
};

export function buildRouteVars(post: Post, extra: Record<string, string> = {}): Record<string, string> {
  const hashtags = post.topics.map((t) => "#" + t.replace(/^#+/, "")).join(" ");
  const content = hashtags ? post.body + "\n\n" + hashtags : post.body;
  const vars: Record<string, string> = {
    id: post.id,
    title: post.title ?? "",
    body: post.body,
    text: post.body,
    content,
    topics: post.topics.join(","),
    hashtags,
    images: post.images.join(","),
    target: post.target ?? "",
    source: post.source,
  };
  post.images.forEach((img, i) => {
    vars[`image${i}`] = img;
  });
  // 便捷别名：image / image1 都指向第一张
  if (post.images[0]) {
    vars.image = post.images[0]!;
    if (!vars.image1) vars.image1 = post.images[0]!;
  }
  return { ...vars, ...extra };
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*(?:\|\s*(json|raw|upper))?\s*\}\}/g, (_m, key: string, filter?: string) => {
    const value = vars[key] ?? "";
    if (filter === "json") return JSON.stringify(value);
    if (filter === "upper") return value.toUpperCase();
    return value;
  });
}

function renderDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return renderTemplate(value, vars);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderDeep(v, vars);
    return out;
  }
  return value;
}

interface StepAction {
  kind: "browser" | "pause";
  args?: string[];
  pauseMs?: number;
}

export function stepToAction(step: RouteStep, session: string, vars: Record<string, string>, rng = createRng().rng): StepAction {
  const key = Object.keys(step)[0]!;
  const raw = renderDeep(step[key], vars);

  if (key === "pause") {
    const ms = Array.isArray(raw)
      ? humanize(rng, Number(raw[0] ?? 0), Number(raw[1] ?? raw[0] ?? 0))
      : Math.max(0, Number(raw) || 0);
    return { kind: "pause", pauseMs: ms };
  }

  const base = ["browser", session];
  const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const flag = (r: Record<string, unknown>, name: string): string[] =>
    r[name] === undefined ? [] : [`--${name}`, String(r[name])];

  switch (key) {
    case "open":
      return { kind: "browser", args: [...base, "open", requireString(raw, "open")] };
    case "eval":
      return { kind: "browser", args: [...base, "eval", requireString(raw, "eval")] };
    case "click":
    case "hover":
    case "focus":
    case "dblclick":
    case "check":
    case "uncheck": {
      const target = typeof raw === "string" ? raw : requireString(asRecord(raw).target, key + ".target");
      const r = asRecord(raw);
      return { kind: "browser", args: [...base, key, target, ...flag(r, "timeout")] };
    }
    case "type":
    case "fill": {
      const r = asRecord(raw);
      const target = requireString(r.target, key + ".target");
      const text = typeof r.text === "string" ? r.text : "";
      return { kind: "browser", args: [...base, key, target, text, ...flag(r, "timeout")] };
    }
    case "keys":
      return { kind: "browser", args: [...base, "keys", typeof raw === "string" ? raw : requireString(asRecord(raw).key, "keys.key")] };
    case "scroll": {
      const direction = typeof raw === "string" ? raw : requireString(asRecord(raw).direction, "scroll.direction");
      return { kind: "browser", args: [...base, "scroll", direction, ...flag(asRecord(raw), "amount")] };
    }
    case "select": {
      const r = asRecord(raw);
      return {
        kind: "browser",
        args: [...base, "select", requireString(r.target, "select.target"), requireString(r.option, "select.option")],
      };
    }
    case "upload": {
      const r = asRecord(raw);
      const files = Array.isArray(r.files) ? r.files.map(String) : String(r.files ?? "").split(",").filter(Boolean);
      const args = [...base, "upload"];
      if (r.target) args.push(String(r.target));
      args.push(...files);
      return { kind: "browser", args };
    }
    case "wait": {
      if (typeof raw === "string") return { kind: "browser", args: [...base, "wait", "selector", raw] };
      const r = asRecord(raw);
      const type = ["selector", "text", "time", "xhr", "download"].find((t) => r[t] !== undefined);
      if (!type) throw new RouteError("wait 需要 selector/text/time/xhr/download 之一");
      const args = [...base, "wait", type, String(r[type])];
      if (r.timeout !== undefined) args.push("--timeout", String(r.timeout));
      return { kind: "browser", args };
    }
    case "screenshot": {
      const path = typeof raw === "string" ? raw : (asRecord(raw).path as string | undefined);
      return { kind: "browser", args: path ? [...base, "screenshot", path] : [...base, "screenshot"] };
    }
    case "find": {
      const r = asRecord(raw);
      const selector = typeof raw === "string" ? raw : (r.css as string | undefined) ?? (r.selector as string | undefined);
      const args = [...base, "find"];
      if (selector) args.push("--css", selector);
      if (r.text !== undefined) args.push("--text", String(r.text));
      if (r.role !== undefined) args.push("--role", String(r.role));
      if (r.name !== undefined) args.push("--name", String(r.name));
      if (r.limit !== undefined) args.push("--limit", String(r.limit));
      return { kind: "browser", args };
    }
    case "get": {
      const name = typeof raw === "string" ? raw : (asRecord(raw).name as string | undefined);
      return { kind: "browser", args: name ? [...base, "get", name] : [...base, "get"] };
    }
    case "state":
    case "extract":
    case "console":
    case "frames":
    case "back":
      return { kind: "browser", args: [...base, key] };
    default:
      throw new RouteError(`未知动作 ${key}`);
  }
}

/** 把 eval 的返回值从 opencli 输出里取出来。 */
export function evalValue(res: OpencliResult): unknown {
  if (res.rows.length === 1 && (typeof res.rows[0] !== "object" || res.rows[0] === null)) return res.rows[0];
  for (const row of res.rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const obj = row as Record<string, unknown>;
      for (const k of ["result", "value", "data", "output", "text"]) {
        if (k in obj) return obj[k];
      }
    }
  }
  return res.rows[0];
}

export function createRouteAdapter(def: RouteDefinition, baseCaps?: Partial<PlatformCapabilities>): PlatformAdapter {
  const caps: PlatformCapabilities = { ...DEFAULT_ROUTE_CAPS, ...baseCaps, ...def.capabilities };
  const sessionOf = (ctx: PrepareContext | RunContext) => def.session ?? `${ctx.config.opencli.session}-${def.id}`;

  const call = (args: string[], ctx: PrepareContext | RunContext) =>
    callOpencli(ctx.run, args, {
      binary: ctx.config.opencli.binary,
      timeoutMs: ctx.config.opencli.timeoutMs,
      // 浏览器原语与 whoami 都支持 --window；自定义 auth.command 则原样执行
      window: args[0] === "browser" || args.includes("whoami") ? ctx.config.opencli.window : undefined,
      onInvoke: (a: string[]) => ctx.ui.detail("opencli " + a.join(" ")),
    });

  const check = async (c: RouteCheck, ctx: RunContext, label: string): Promise<string | null> => {
    if (c.selector) {
      const res = await call(["browser", sessionOf(ctx), "eval", `!!document.querySelector(${JSON.stringify(c.selector)})`], ctx);
      if (!res.ok) return `${label} 检查失败：${res.error?.message ?? "unknown"}`;
      if (evalValue(res) !== true) return `${label} 期望出现元素 ${c.selector}，但没有找到`;
    }
    if (c.text) {
      const res = await call(["browser", sessionOf(ctx), "eval", `document.body.innerText.includes(${JSON.stringify(c.text)})`], ctx);
      if (!res.ok) return `${label} 检查失败：${res.error?.message ?? "unknown"}`;
      if (evalValue(res) !== true) return `${label} 期望页面包含文案 "${c.text}"`;
    }
    if (c.url) {
      const res = await call(["browser", sessionOf(ctx), "eval", "location.href"], ctx);
      const value = String(evalValue(res) ?? "");
      if (!value.includes(c.url)) return `${label} 期望 URL 含 "${c.url}"，实际 ${value}`;
    }
    if (c.js) {
      const res = await call(["browser", sessionOf(ctx), "eval", c.js], ctx);
      if (!res.ok) return `${label} 检查失败：${res.error?.message ?? "unknown"}`;
      const value = evalValue(res);
      const expected = c.equals === undefined ? true : c.equals;
      if (value !== expected) return `${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(value)}`;
    }
    return null;
  };

  const runSteps = async (steps: RouteStep[], vars: Record<string, string>, ctx: RunContext, label: string): Promise<string | null> => {
    const rng = createRng().rng;
    for (const [i, step] of steps.entries()) {
      const key = Object.keys(step)[0]!;
      if (key === "expect") {
        const rendered = renderDeep(step[key], vars) as RouteCheck;
        const problem = await check(rendered, ctx, `${label} 第 ${i + 1} 步 expect`);
        if (problem) return problem;
        continue;
      }
      let action: StepAction;
      try {
        action = stepToAction(step, sessionOf(ctx), vars, rng);
      } catch (err) {
        return `${label} 第 ${i + 1} 步配置错误：${(err as Error).message}`;
      }
      if (action.kind === "pause") {
        await sleep(action.pauseMs ?? 0, ctx.signal);
        continue;
      }
      const res = await call(action.args!, ctx);
      if (!res.ok) {
        return `${label} 第 ${i + 1} 步 ${key} 失败：${res.error?.message ?? "unknown"}`;
      }
    }
    return null;
  };

  return {
    id: def.id,
    name: def.name,
    site: def.site,
    routePath: def.path,
    capabilities: caps,
    requirements: [`自定义 route：${def.path ?? def.id}`],

    async checkAuth(ctx: RunContext): Promise<AuthState> {
      if (def.auth?.site) {
        const res = await call([def.auth.site, "whoami", "-f", "json"], ctx);
        if (!res.ok) {
          const msg = res.error?.message ?? "unknown";
          if (/login|cookie|auth|未登录/i.test(msg) || res.error?.exitCode === 77) {
            return { loggedIn: false, detail: msg };
          }
        }
        return { loggedIn: res.ok, detail: res.ok ? undefined : res.error?.message };
      }
      if (def.auth?.command) {
        const res = await call(def.auth.command, ctx);
        return { loggedIn: res.ok, detail: res.ok ? undefined : res.error?.message };
      }
      if (def.auth?.steps) {
        const problem = await runSteps(def.auth.steps, buildRouteVars({} as Post), ctx, "登录检查");
        return problem ? { loggedIn: false, detail: problem } : { loggedIn: true };
      }
      return { loggedIn: true, detail: "未配置登录检查" };
    },

    async prepare(post: Post, ctx: PrepareContext): Promise<PreparedPublish> {
      const warnings: string[] = [];
      const errors: string[] = [];
      const notes: string[] = [];
      const vars = buildRouteVars(post, def.vars);
      const session = sessionOf(ctx);

      if (caps.maxTextLength && [...post.body].length > caps.maxTextLength) {
        warnings.push(`正文 ${[...post.body].length} 字，超过 route 声明上限 ${caps.maxTextLength} 字`);
      }
      if (caps.requiresImage && post.images.length === 0) {
        errors.push("该 route 要求配图：请加 --images，或让 publish 自动生成封面");
      }
      if (post.images.length > caps.images) {
        warnings.push(`图片超过 route 上限 ${caps.images} 张，仅使用前 ${caps.images} 张`);
      }

      const plan: string[][] = [];
      for (const step of def.steps) {
        const key = Object.keys(step)[0] ?? "";
        if (key === "expect") {
          plan.push([`# expect ${JSON.stringify(renderDeep(step[key], vars))}`]);
          continue;
        }
        try {
          const action = stepToAction(step, session, vars);
          if (action.kind === "browser") plan.push(action.args!);
          else plan.push([`# pause ${action.pauseMs}ms`]);
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      notes.push(`走 route 操作路径（${def.steps.length} 步）`);

      return {
        platform: def.id,
        platformName: def.name,
        postId: post.id,
        postSource: post.source,
        title: post.title,
        text: post.body,
        images: post.images,
        args: plan[0] ?? [],
        plan,
        warnings,
        errors,
        notes,
        vars,
      };
    },

    async publish(prepared: PreparedPublish, ctx: RunContext): Promise<PublishOutcome> {
      const vars = prepared.vars ?? buildRouteVars({} as Post);
      const problem = await runSteps(def.steps, vars, ctx, "route");
      if (problem) return { ok: false, error: problem };
      if (def.verify) {
        const verifyProblem = await check(def.verify, ctx, "route verify");
        if (verifyProblem) return { ok: false, error: verifyProblem };
      }
      let url: string | undefined;
      if (def.captureUrl !== false) {
        const res = await call(["browser", sessionOf(ctx), "eval", "location.href"], ctx);
        if (res.ok) {
          const value = evalValue(res);
          if (typeof value === "string" && value.startsWith("http")) url = value;
        }
      }
      return { ok: true, url, detail: `已完成 ${def.steps.length} 步操作路径` };
    },
  };
}

export async function loadRoutes(dirs: string[]): Promise<{ routes: RouteDefinition[]; warnings: string[] }> {
  const routes: RouteDefinition[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      const glob = new Bun.Glob("*");
      for (const f of glob.scanSync({ cwd: dir })) entries.push(f);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      const ext = extname(name).toLowerCase();
      if (![".json", ".yaml", ".yml"].includes(ext)) continue;
      if (name.startsWith(".")) continue;
      const full = `${dir}/${name}`;
      const id = name.replace(/\.(json|yaml|yml)$/i, "");
      if (seen.has(id)) continue;
      try {
        const data = await readStructuredFile(full);
        const def = parseRoute(data, full);
        routes.push(def);
        seen.add(def.id);
      } catch (err) {
        warnings.push(`route 加载失败 ${full}：${(err as Error).message}`);
      }
    }
  }
  return { routes, warnings };
}
