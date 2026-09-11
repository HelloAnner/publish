/** opencli 调用层：进程执行、输出解析、错误归一化。 */

import type { ExecResult, Runner } from "./types.ts";

export function createRunner(): Runner {
  return async (cmd, opts = {}) => {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);
    return { code: code ?? 0, stdout, stderr, timedOut };
  };
}

export interface OpencliErrorInfo {
  code: string;
  message: string;
  help?: string;
  exitCode?: number;
}

export interface OpencliResult {
  ok: boolean;
  rows: unknown[];
  raw: unknown;
  error?: OpencliErrorInfo;
  exec: ExecResult;
  /** 人类可读的失败原因。 */
  reason?: string;
}

function parseFlexible(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    /* fallthrough */
  }
  try {
    const yaml = (Bun as unknown as { YAML?: { parse(s: string): unknown } }).YAML;
    if (yaml?.parse) return yaml.parse(t);
  } catch {
    /* fallthrough */
  }
  return undefined;
}

export function extractOpencliError(res: ExecResult): OpencliErrorInfo | null {
  const parsed = parseFlexible(res.stdout) ?? parseFlexible(res.stderr);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.ok === false || obj.error) {
      const rawErr = obj.error;
      const err: Record<string, unknown> = rawErr && typeof rawErr === "object" ? (rawErr as Record<string, unknown>) : {};
      const stringErr = typeof rawErr === "string" ? rawErr : undefined;
      return {
        code: String(err.code ?? obj.code ?? "OPENCLI_ERROR"),
        message: String(err.message ?? obj.message ?? stringErr ?? "opencli 执行失败"),
        help: err.help ? String(err.help) : undefined,
        exitCode: typeof err.exitCode === "number" ? err.exitCode : res.code,
      };
    }
  }
  const text = (res.stderr || res.stdout).trim();
  if (res.code !== 0 && text) {
    return { code: "OPENCLI_ERROR", message: text.split("\n").slice(-3).join(" ").slice(0, 400), exitCode: res.code };
  }
  return null;
}

export function isAuthError(err: OpencliErrorInfo | null | undefined): boolean {
  if (!err) return false;
  if (err.exitCode === 77) return true;
  const code = err.code.toUpperCase();
  if (code.includes("AUTH") || code.includes("LOGIN") || code.includes("UNAUTHORIZED")) return true;
  return /未登录|登录|login|not logged|cookie/i.test(err.message);
}

export interface CallOptions {
  binary: string;
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** 浏览器窗口模式；background 不抢焦点（默认）。 */
  window?: "foreground" | "background" | string;
  /** 打印实际命令。 */
  onInvoke?: (args: string[]) => void;
}

export async function callOpencli(run: Runner, args: string[], opts: CallOptions): Promise<OpencliResult> {
  const finalArgs = opts.window && !args.includes("--window") ? [...args, "--window", opts.window] : args;
  opts.onInvoke?.(finalArgs);
  const exec = await run([opts.binary, ...finalArgs], {
    timeoutMs: opts.timeoutMs,
    cwd: opts.cwd,
    env: opts.env,
  });
  if (exec.timedOut) {
    return {
      ok: false,
      rows: [],
      raw: undefined,
      exec,
      error: { code: "TIMEOUT", message: `opencli 调用超时（>${Math.round(opts.timeoutMs / 1000)}s）：${finalArgs.slice(0, 2).join(" ")}` },
    };
  }
  const error = extractOpencliError(exec);
  if (error) {
    return { ok: false, rows: [], raw: undefined, error, exec };
  }
  const raw = parseFlexible(exec.stdout);
  const rows = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return { ok: true, rows, raw, exec };
}

/** 从 opencli 返回行里取第一个对象。 */
export function firstRowObject(result: OpencliResult): Record<string, unknown> | undefined {
  for (const row of result.rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) return row as Record<string, unknown>;
  }
  return undefined;
}

export function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** 只做展示用：把运行时会自动追加的参数补进命令串，让 dry-run 与实际执行一致。 */
export function decorateForDisplay(args: string[], window?: string): string[] {
  if (args.length === 0) return args;
  if (args[0]!.startsWith("#")) return args;
  if (!window || args.includes("--window")) return args;
  return [...args, "--window", window];
}

/** 把 opencli 的通用参数（-f json / --window / --keep-tab）拼上去。 */
export function withCommonFlags(args: string[], opts: { json?: boolean; window?: string; keepTab?: boolean }): string[] {
  const out = [...args];
  if (opts.json ?? true) out.push("-f", "json");
  if (opts.window) out.push("--window", opts.window);
  if (opts.keepTab) out.push("--keep-tab", "true");
  return out;
}
