/** history：本地发布历史与今日配额。 */

import { readHistory } from "../../core/risk.ts";
import { EXIT } from "../../core/errors.ts";
import { formatRelative, localDay } from "../../core/util.ts";
import type { CliContext } from "../context.ts";

export async function runHistory(ctx: CliContext): Promise<number> {
  const { ui, flags, config } = ctx;
  const entries = await readHistory(ctx.historyPath);
  const limit = flags.num("limit") ?? 20;
  const filter = new Set(flags.list("platform").map((p) => ctx.registry.normalize(p)));
  const filtered = filter.size > 0 ? entries.filter((e) => filter.has(e.platform)) : entries;
  const sorted = [...filtered].sort((a, b) => b.ts.localeCompare(a.ts));
  const today = localDay();
  const todayReal = entries.filter((e) => e.ok && !e.dryRun && localDay(new Date(e.ts)) === today);

  if (ui.json) {
    process.stdout.write(
      JSON.stringify({ historyFile: ctx.historyPath, total: entries.length, today: todayReal.length, entries: sorted.slice(0, limit) }, null, 2) + "\n",
    );
    return EXIT.ok;
  }

  ui.head("今日配额");
  const perPlatform = new Map<string, number>();
  for (const e of todayReal) perPlatform.set(e.platform, (perPlatform.get(e.platform) ?? 0) + 1);
  ui.table(
    ["平台", "今日已发", "单平台上限", "全平台上限"],
    ctx.registry.list().map((a) => [
      a.name,
      String(perPlatform.get(a.id) ?? 0),
      String(config.guard.maxPerDayPerPlatform),
      String(config.guard.maxPerDay),
    ]),
  );
  ui.info(`\n  今天共 ${todayReal.length} 次真实发布；历史文件：${ui.dim(ctx.historyPath)}`);

  ui.head(`最近 ${Math.min(limit, sorted.length)} 条`);
  if (sorted.length === 0) {
    ui.info(ui.dim("  （还没有发布记录）"));
    return EXIT.ok;
  }
  ui.table(
    ["时间", "平台", "标题", "状态", "链接"],
    sorted.slice(0, limit).map((e) => [
      formatRelative(e.ts),
      e.platform,
      (e.title ?? e.postId).slice(0, 26),
      e.dryRun ? "预演" : e.ok ? "✔" : "✖",
      e.url ?? e.error?.slice(0, 40) ?? "—",
    ]),
  );
  ui.raw("");
  return EXIT.ok;
}
