/** doctor：体检。 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callOpencli } from "../../core/opencli.ts";
import { EXIT } from "../../core/errors.ts";
import { configDir, coverCacheDir, globalConfigFile, historyFile, userRouteDir } from "../../core/paths.ts";
import { readHistory } from "../../core/risk.ts";
import { localDay } from "../../core/util.ts";
import type { CliContext } from "../context.ts";

interface Check {
  name: string;
  ok: boolean | "warn";
  detail: string;
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export async function runDoctor(ctx: CliContext): Promise<number> {
  const { ui, config } = ctx;
  const checks: Check[] = [];

  const version = await ctx.run([config.opencli.binary, "--version"], { timeoutMs: 15_000 });
  if (version.code === 0) {
    checks.push({ name: "opencli", ok: true, detail: (version.stdout + version.stderr).trim().split("\n")[0]! });
  } else {
    checks.push({
      name: "opencli",
      ok: false,
      detail: `找不到或无法执行 "${config.opencli.binary}"。安装：npm i -g @jackwener/opencli`,
    });
  }

  if (version.code === 0) {
    const bridge = await ctx.run([config.opencli.binary, "doctor"], { timeoutMs: 60_000 });
    const text = (bridge.stdout + bridge.stderr).replace(/\u001b\[[0-9;]*m/g, "");
    const ok = /\[OK\] Extension: connected/i.test(text) && /\[OK\] Connectivity/i.test(text);
    const line = text.split("\n").find((l) => /Connectivity|Extension/.test(l))?.trim() ?? "无输出";
    checks.push({ name: "浏览器桥", ok, detail: line });
  }

  if (version.code === 0) {
    for (const adapter of ctx.registry.list()) {
      if (!adapter.site) {
        checks.push({ name: `${adapter.id} 登录`, ok: "warn", detail: `自定义 route：${adapter.routePath}` });
        continue;
      }
      const res = await callOpencli(ctx.run, [adapter.site, "whoami", "-f", "json"], {
        binary: config.opencli.binary,
        timeoutMs: 60_000,
        window: config.opencli.window,
      });
      if (res.ok) {
        const row = res.rows.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
        checks.push({ name: `${adapter.id} 登录`, ok: true, detail: row?.username ? String(row.username) : "已登录" });
      } else {
        checks.push({ name: `${adapter.id} 登录`, ok: false, detail: res.error?.message ?? "whoami 失败" });
      }
    }
  }

  const py = await ctx.run([config.cover.python, "-c", "import PIL; print(PIL.__version__)"], { timeoutMs: 30_000 });
  checks.push({
    name: "封面渲染器",
    ok: py.code === 0 ? true : "warn",
    detail: py.code === 0 ? `Pillow ${py.stdout.trim()}` : "未安装 Pillow：无配图时会退化为平台自带文字卡片（pip install pillow 可启用封面生成）",
  });

  const history = await readHistory(ctx.historyPath);
  const today = history.filter((e) => e.ok && !e.dryRun && localDay(new Date(e.ts)) === localDay()).length;
  checks.push({ name: "本地历史", ok: true, detail: `${history.length} 条记录，今日 ${today} 次（${historyFile()}）` });

  // 注意：import.meta.url 是「当前模块」的路径，这里要的是入口脚本路径
  const entryPath = (Bun as unknown as { main?: string }).main ?? process.argv[1] ?? "";
  const entry = realpathSafe(entryPath);
  const installed = [join(homedir(), ".local", "bin", "publish"), join(homedir(), ".bun", "bin", "publish")]
    .filter((p) => existsSync(p))
    .map((p) => {
      const real = realpathSafe(p);
      const shown = p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p;
      return real === entry ? shown + " ← 本项目" : shown + " → " + real;
    });
  checks.push({
    name: "CLI 安装",
    ok: installed.some((i) => i.includes("本项目")) ? true : "warn",
    detail: installed.length > 0 ? installed.join("  ") : "未安装到 ~/.local/bin，运行 make install",
  });

  checks.push({
    name: "配置文件",
    ok: "warn",
    detail: config.sources.length > 0 ? config.sources.join(", ") : `未使用配置文件（全局默认在 ${globalConfigFile()}）`,
  });

  if (ui.json) {
    process.stdout.write(JSON.stringify(checks, null, 2) + "\n");
  } else {
    ui.head("体检结果");
    ui.table(
      ["项目", "状态", "详情"],
      checks.map((c) => [c.name, c.ok === true ? "✔ 正常" : c.ok === "warn" ? "▲ 提醒" : "✖ 异常", c.detail]),
    );
    ui.raw("");
    ui.info(ui.dim(`  配置目录：${configDir()}`));
    ui.info(ui.dim(`  route 目录：${userRouteDir()}`));
    ui.info(ui.dim(`  封面缓存：${coverCacheDir()}`));
    ui.raw("");
  }
  return checks.some((c) => c.ok === false) ? EXIT.error : EXIT.ok;
}
