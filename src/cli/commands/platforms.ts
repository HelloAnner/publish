/** platforms：列出平台能力与限制。 */

import { EXIT } from "../../core/errors.ts";
import type { CliContext } from "../context.ts";

export async function runPlatforms(ctx: CliContext): Promise<number> {
  const { ui } = ctx;
  const adapters = ctx.registry.list();

  if (ui.json) {
    process.stdout.write(
      JSON.stringify(
        adapters.map((a) => ({
          id: a.id,
          name: a.name,
          site: a.site ?? null,
          source: a.routePath ?? "builtin",
          capabilities: a.capabilities,
          requirements: a.requirements ?? [],
        })),
        null,
        2,
      ) + "\n",
    );
    return EXIT.ok;
  }

  ui.head("已注册平台");
  ui.table(
    ["ID", "平台", "文本", "图片", "标题", "正文字数", "草稿", "来源"],
    adapters.map((a) => [
      a.id,
      a.name,
      a.capabilities.text ? "✔" : "—",
      a.capabilities.images > 0 ? String(a.capabilities.images) : "—",
      a.capabilities.title ? (a.capabilities.maxTitleLength ? `✔ ≤${a.capabilities.maxTitleLength}` : "✔") : "—",
      a.capabilities.maxTextLength ? String(a.capabilities.maxTextLength) : "不限",
      a.capabilities.draft ? "✔" : "—",
      a.routePath ? "自定义 route" : "内置",
    ]),
  );
  ui.raw("");
  ui.info(ui.dim("  图片列是最大张数；正文字数对 X 是加权（CJK=2、链接=23），其他平台是字符数。"));
  for (const a of adapters) {
    if (!a.requirements?.length) continue;
    ui.raw("");
    ui.info(ui.bold(`  ${a.name}（${a.id}）`));
    for (const r of a.requirements) ui.info("    · " + r);
  }
  ui.raw("");
  return EXIT.ok;
}
