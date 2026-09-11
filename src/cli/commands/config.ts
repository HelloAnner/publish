/** config：查看/初始化配置。 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, configPaths } from "../../core/config.ts";
import { EXIT, UsageError } from "../../core/errors.ts";
import { globalConfigFile } from "../../core/paths.ts";
import type { CliContext } from "../context.ts";

export async function runConfig(ctx: CliContext): Promise<number> {
  const { ui } = ctx;
  const sub = ctx.rest[0] ?? "show";

  if (sub === "show") {
    const paths = configPaths();
    if (ui.json) {
      process.stdout.write(JSON.stringify({ effective: ctx.config, sources: ctx.config.sources, paths }, null, 2) + "\n");
      return EXIT.ok;
    }
    ui.head("生效配置");
    ui.raw(JSON.stringify(ctx.config, null, 2));
    ui.raw("");
    ui.info(`  来源：${ctx.config.sources.length > 0 ? ctx.config.sources.join(", ") : "内置默认值"}`);
    ui.info(ui.dim(`  全局配置：${paths.global}`));
    ui.info(ui.dim(`  项目配置：${paths.project.join(" / ")}`));
    ui.raw("");
    return EXIT.ok;
  }

  if (sub === "init") {
    const target = ctx.flags.str("config") ?? globalConfigFile();
    const file = Bun.file(target);
    if ((await file.exists()) && !ctx.force) {
      throw new UsageError(`配置文件已存在：${target}`, "加 --force 覆盖");
    }
    await mkdir(dirname(target), { recursive: true });
    const template = { ...DEFAULT_CONFIG, sources: undefined };
    delete (template as Record<string, unknown>).sources;
    await Bun.write(target, JSON.stringify(template, null, 2) + "\n");
    ui.ok(`已写入配置模板：${target}`);
    return EXIT.ok;
  }

  if (sub === "defaults") {
    ui.raw(JSON.stringify(DEFAULT_CONFIG, null, 2));
    return EXIT.ok;
  }

  throw new UsageError(`未知子命令：${sub}`, "可用：show / init / defaults");
}
