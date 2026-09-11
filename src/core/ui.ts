/** 终端输出：颜色、结构化日志、表格、确认、倒计时。 */

import { displayWidth, formatClock, truncateDisplay, wrapDisplay } from "./util.ts";

const ESC = "\u001b[";

const CODES: Record<string, string> = {
  reset: "0",
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  gray: "90",
};

export interface UiOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
  stdinIsTty?: boolean;
  /** 注入输出目标（测试用）。 */
  sink?: (stream: "out" | "err", text: string) => void;
}

export class UI {
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
  readonly stdinIsTty: boolean;
  private out: (s: string) => void;
  private err: (s: string) => void;

  constructor(opts: UiOptions = {}) {
    this.json = Boolean(opts.json);
    this.quiet = Boolean(opts.quiet);
    this.verbose = Boolean(opts.verbose);
    const envNoColor = Boolean(process.env.NO_COLOR) || process.env.FORCE_COLOR === "0";
    this.color = opts.color ?? (!envNoColor && Boolean(process.stdout?.isTTY));
    this.stdinIsTty = opts.stdinIsTty ?? Boolean(process.stdin?.isTTY);
    const sink = opts.sink;
    this.out = sink ? (s) => sink("out", s) : (s) => process.stdout.write(s);
    this.err = sink ? (s) => sink("err", s) : (s) => process.stderr.write(s);
  }

  paint(style: string, text: string): string {
    if (!this.color) return text;
    const code = CODES[style];
    if (!code) return text;
    return ESC + code + "m" + text + ESC + CODES.reset + "m";
  }

  bold(s: string): string {
    return this.paint("bold", s);
  }

  dim(s: string): string {
    return this.paint("dim", s);
  }

  /** 原始输出（仍遵守 --quiet 之外的场景由调用方决定）。 */
  raw(text: string): void {
    this.out(text.endsWith("\n") ? text : text + "\n");
  }

  blank(): void {
    if (!this.quiet) this.out("\n");
  }

  private emit(line: string): void {
    if (this.quiet) return;
    this.out(line + "\n");
  }

  info(msg: string): void {
    this.emit(msg);
  }

  ok(msg: string): void {
    this.emit(this.paint("green", "✔") + " " + msg);
  }

  warn(msg: string): void {
    if (this.quiet) return;
    this.err(this.paint("yellow", "▲") + " " + msg + "\n");
  }

  fail(msg: string): void {
    this.err(this.paint("red", "✖") + " " + msg + "\n");
  }

  step(msg: string): void {
    this.emit(this.paint("cyan", "→") + " " + msg);
  }

  detail(msg: string): void {
    if (!this.verbose) return;
    this.emit(this.paint("gray", "  " + msg));
  }

  head(msg: string): void {
    if (this.quiet) return;
    this.out("\n" + this.paint("bold", msg) + "\n");
  }

  section(msg: string): void {
    this.emit(this.paint("bold", msg));
  }

  /** 简单两列表格。 */
  table(headers: string[], rows: string[][], opts: { maxColWidth?: number } = {}): void {
    if (this.quiet) return;
    const maxW = opts.maxColWidth ?? 46;
    const cells = rows.map((r) => r.map((c) => truncateDisplay(String(c ?? ""), maxW)));
    const widths = headers.map((h, i) =>
      Math.max(displayWidth(h), ...cells.map((r) => displayWidth(r[i] ?? ""))),
    );
    const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayWidth(s)));
    const line = (r: string[]) => r.map((c, i) => pad(c ?? "", widths[i]!)).join("  ").trimEnd();
    this.out("  " + this.paint("bold", line(headers)) + "\n");
    this.out("  " + this.paint("gray", widths.map((w) => "─".repeat(w)).join("  ")) + "\n");
    for (const r of cells) this.out("  " + line(r) + "\n");
  }

  /** 带缩进的多行文本块。 */
  block(text: string, indent = "    "): void {
    if (this.quiet) return;
    for (const line of wrapDisplay(text, 84)) this.out(indent + line + "\n");
  }

  /** 原地倒计时；非 TTY 时退化为一次性提示。 */
  async countdown(ms: number, label: string, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || this.quiet) return;
    const deadline = Date.now() + ms;
    if (!this.color || !process.stdout?.isTTY) {
      this.emit(`${this.paint("gray", "…")} ${label} ${formatClock(ms)}`);
      await sleep(ms, signal);
      return;
    }
    while (true) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      this.out("\r" + label + " " + formatClock(left) + "   ");
      await sleep(Math.min(1000, left), signal);
    }
    this.out("\r" + " ".repeat(displayWidth(label) + 8) + "\r");
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ConfirmOptions {
  default?: boolean;
  assumeYes?: boolean;
}

/** 交互确认；非 TTY 或 --yes 时直接返回默认值。 */
export async function confirm(question: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const def = opts.default ?? false;
  if (opts.assumeYes) return true;
  if (!process.stdin?.isTTY) return def;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = def ? " [Y/n] " : " [y/N] ";
    const answer = (await rl.question(question + suffix)).trim().toLowerCase();
    if (!answer) return def;
    return answer === "y" || answer === "yes" || answer === "是";
  } finally {
    rl.close();
  }
}
