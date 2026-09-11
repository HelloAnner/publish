/** CLI 主入口：解析 → 组装上下文 → 分发命令 → 统一退出码。 */

import { buildRegistry } from "../adapters/index.ts";
import { loadConfig, parseRangeSeconds } from "../core/config.ts";
import { EXIT, PublishError, UsageError, errorMessage } from "../core/errors.ts";
import { createRunner } from "../core/opencli.ts";
import { historyFile } from "../core/paths.ts";
import type { PublishConfig } from "../core/types.ts";
import { UI } from "../core/ui.ts";
import { parseArgs, type Flags } from "./args.ts";
import { VERSION, type CliContext } from "./context.ts";
import { printHelp } from "./help.ts";
import { runConfig } from "./commands/config.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runExplore } from "./commands/explore.ts";
import { runHistory } from "./commands/history.ts";
import { runLogin } from "./commands/login.ts";
import { runPlatforms } from "./commands/platforms.ts";
import { runPublish } from "./commands/publish.ts";
import { runRoutes } from "./commands/routes.ts";

export async function runCli(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write("✖ " + errorMessage(err) + "\n");
    return EXIT.usage;
  }

  const { flags } = parsed;
  const ui = new UI({
    json: flags.bool("json"),
    // --json 时静音人类可读输出（警告/错误仍走 stderr），保证 stdout 是纯 JSON
    quiet: flags.bool("quiet") || flags.bool("json"),
    verbose: flags.bool("verbose"),
    color: flags.bool("color") ? true : flags.bool("no-color") ? false : undefined,
  });

  try {
    if (parsed.unknown.length > 0) {
      throw new UsageError(`未知参数：${parsed.unknown.join(" ")}`, "publish help 查看全部参数");
    }
    if (parsed.command === "version" || flags.bool("version")) {
      ui.raw(VERSION);
      return EXIT.ok;
    }
    if (parsed.command === "help" || flags.bool("help")) {
      printHelp(ui, parsed.rest[0]);
      return EXIT.ok;
    }

    const cwd = process.cwd();
    const config = await loadConfig({ cwd, explicitPath: flags.str("config") });
    applyCliOverrides(config, flags);

    const routeDirs = flags.all("route-dir");
    const registry = await buildRegistry({
      extraRouteDirs: routeDirs,
      routeDirs: config.routeDirs,
      onWarning: (msg) => ui.warn(msg),
    });

    const ctx: CliContext = {
      ui,
      flags,
      command: parsed.command,
      rest: parsed.rest,
      cwd,
      env: process.env,
      config,
      registry,
      run: createRunner(),
      historyPath: flags.str("history") ?? historyFile(),
      dryRun: flags.bool("dry-run"),
      assumeYes: flags.bool("yes"),
      force: flags.bool("force") || flags.bool("no-guard"),
    };

    switch (parsed.command) {
      case "publish":
        return await runPublish(ctx);
      case "login":
        return await runLogin(ctx);
      case "platforms":
        return await runPlatforms(ctx);
      case "history":
        return await runHistory(ctx);
      case "doctor":
        return await runDoctor(ctx);
      case "explore":
        return await runExplore(ctx);
      case "routes":
        return await runRoutes(ctx);
      case "config":
        return await runConfig(ctx);
      default:
        throw new UsageError(`未知命令：${parsed.command}`);
    }
  } catch (err) {
    return reportError(ui, err);
  }
}

function reportError(ui: UI, err: unknown): number {
  const publishErr = err instanceof PublishError ? err : undefined;
  const message = errorMessage(err);
  const exitCode = publishErr?.exitCode ?? EXIT.error;
  if (ui.json) {
    process.stdout.write(
      JSON.stringify({ ok: false, code: publishErr?.code ?? "ERROR", message, hint: publishErr?.hint }, null, 2) + "\n",
    );
  } else {
    ui.fail(message);
    if (publishErr?.hint) ui.info("  " + ui.dim(publishErr.hint));
  }
  if (ui.verbose && err instanceof Error && err.stack) ui.detail(err.stack);
  return exitCode;
}

export function applyCliOverrides(config: PublishConfig, flags: Flags): void {
  const delay = flags.str("delay");
  if (delay !== undefined) {
    const range = parseRangeSeconds(delay, config.delay.between);
    if (range) config.delay.between = range;
  }
  const preDelay = flags.str("pre-delay");
  if (preDelay !== undefined) {
    const range = parseRangeSeconds(preDelay, config.delay.pre);
    if (range) config.delay.pre = range;
  }
  if (flags.bool("no-delay")) {
    config.delay.pre = [0, 0];
    config.delay.between = [0, 0];
  }
  const minInterval = flags.num("min-interval");
  if (minInterval !== undefined) config.guard.minIntervalMinutes = minInterval;
  const maxPerDay = flags.num("max-per-day");
  if (maxPerDay !== undefined) config.guard.maxPerDay = maxPerDay;
  const maxPerPlatform = flags.num("max-per-platform");
  if (maxPerPlatform !== undefined) config.guard.maxPerDayPerPlatform = maxPerPlatform;
  if (flags.bool("no-guard")) config.guard.enabled = false;

  const session = flags.str("session");
  if (session) config.opencli.session = session;
  const windowMode = flags.str("window");
  if (windowMode === "foreground" || windowMode === "background") config.opencli.window = windowMode;
  const timeout = flags.num("timeout");
  if (timeout !== undefined) config.opencli.timeoutMs = Math.max(5_000, timeout * 1000);
  if (flags.bool("keep-tab")) config.opencli.keepTab = true;
  const binary = flags.str("opencli");
  if (binary) config.opencli.binary = binary;

  const coverStyle = flags.str("cover-style");
  if (coverStyle) config.cover.style = coverStyle;
  const coverScale = flags.num("cover-scale");
  if (coverScale !== undefined) config.cover.scale = coverScale > 0 ? coverScale : 1;
}

export { printHelp };
