/** 测试公共设施：假 Runner + 临时上下文。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinRegistry } from "../src/adapters/index.ts";
import { parseArgs } from "../src/cli/args.ts";
import type { CliContext } from "../src/cli/context.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import type { ExecResult, PublishConfig, Runner } from "../src/core/types.ts";
import { UI } from "../src/core/ui.ts";

export interface FakeRunner {
  run: Runner;
  calls: string[][];
  /** 只保留 opencli 参数（去掉可执行文件）。 */
  args(): string[][];
}

export function fakeRunner(handler?: (cmd: string[]) => Partial<ExecResult> | undefined): FakeRunner {
  const calls: string[][] = [];
  const run: Runner = async (cmd) => {
    calls.push(cmd);
    const res = handler?.(cmd) ?? defaultHandler(cmd) ?? { code: 0, stdout: "", stderr: "" };
    return { code: res.code ?? 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "", timedOut: res.timedOut };
  };
  return { run, calls, args: () => calls.map((c) => c.slice(1)) };
}

export function ok(stdout: unknown): Partial<ExecResult> {
  return { code: 0, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout) };
}

export function fail(message: string, code = 1): Partial<ExecResult> {
  return { code, stdout: `ok: false\nerror:\n  code: ERROR\n  message: ${message}\n`, stderr: "" };
}

export function authFail(message = "not logged in"): Partial<ExecResult> {
  return {
    code: 77,
    stdout: `ok: false\nerror:\n  code: AUTH_REQUIRED\n  message: ${message}\n  exitCode: 77\n`,
  };
}

function defaultHandler(cmd: string[]): Partial<ExecResult> | undefined {
  const [, site, sub] = cmd;
  if (site === "twitter") {
    if (sub === "whoami") return ok({ logged_in: true, username: "tester" });
    if (sub === "post") return ok([{ status: "success", url: "https://x.com/i/status/111" }]);
    if (sub === "reply") return ok([{ status: "success", url: "https://x.com/i/status/112" }]);
  }
  if (site === "xiaohongshu") {
    if (sub === "whoami") return ok({ logged_in: true, username: "tester" });
    if (sub === "publish") return ok([{ status: "success", detail: "已提交发布" }]);
  }
  if (site === "zhihu") {
    if (sub === "whoami") return ok({ logged_in: true, username: "tester" });
    if (sub === "search") {
      return ok([{ rank: 1, title: "AI Agent 会重构软件行业吗？", type: "question", url: "https://www.zhihu.com/question/123456" }]);
    }
    if (sub === "answer") {
      return ok([{ status: "success", message: "已发布", created_url: "https://www.zhihu.com/question/123456/answer/999" }]);
    }
  }
  if (site === "browser") {
    if (sub === "eval") return ok("https://example.com/done");
    return ok({ url: "https://example.com/done", page: "p1" });
  }
  return ok("");
}

export interface MakeContextOptions {
  argv: string[];
  run: Runner;
  cwd?: string;
  configure?: (config: PublishConfig) => void;
}

export function testConfig(configure?: (config: PublishConfig) => void): PublishConfig {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as PublishConfig;
  config.delay.pre = [0, 0];
  config.delay.between = [0, 0];
  config.cover.enabled = false;
  config.sources = [];
  configure?.(config);
  return config;
}

export function makeContext(o: MakeContextOptions): CliContext {
  const parsed = parseArgs(o.argv);
  const cwd = o.cwd ?? mkdtempSync(join(tmpdir(), "publish-test-"));
  const ui = new UI({ quiet: true, color: false, sink: () => {} });
  return {
    ui,
    flags: parsed.flags,
    command: parsed.command,
    rest: parsed.rest,
    cwd,
    env: {},
    config: testConfig(o.configure),
    registry: builtinRegistry(),
    run: o.run,
    historyPath: join(cwd, "history.jsonl"),
    dryRun: parsed.flags.bool("dry-run"),
    assumeYes: true,
    force: parsed.flags.bool("force"),
  };
}
