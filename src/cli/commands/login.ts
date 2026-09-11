/** login：打开浏览器完成平台登录。 */

import { callOpencli } from "../../core/opencli.ts";
import { EXIT, UsageError } from "../../core/errors.ts";
import { describeMissingPlatform, resolvePlatforms } from "../../core/registry.ts";
import type { CliContext } from "../context.ts";

export async function runLogin(ctx: CliContext): Promise<number> {
  const { ui, flags } = ctx;
  const requested = flags.list("platform");
  const platforms = resolvePlatforms(
    requested.length > 0 ? requested : ctx.registry.list().filter((a) => a.site).map((a) => a.id),
  );
  if (platforms.length === 0) {
    throw new UsageError("没有可登录的平台", "例：publish login -to zhihu");
  }

  let failed = 0;
  for (const id of platforms) {
    const adapter = ctx.registry.get(id);
    if (!adapter) throw new UsageError(describeMissingPlatform(id, ctx.registry.ids()));
    if (!adapter.site) {
      ui.warn(`[${id}] 自定义 route 没有声明 site，请直接在日常浏览器里登录后重试`);
      continue;
    }
    ui.step(`[${id}] 打开 ${adapter.site} 登录页（前台窗口），请在浏览器里完成登录…`);
    const res = await callOpencli(ctx.run, [adapter.site, "login", "-f", "json"], {
      binary: ctx.config.opencli.binary,
      timeoutMs: Math.max(ctx.config.opencli.timeoutMs, 300_000),
      // 登录必须前台，否则用户看不到页面
      window: "foreground",
      onInvoke: (args) => ui.detail("opencli " + args.join(" ")),
    });
    if (res.ok) {
      ui.ok(`[${id}] 登录态已就绪`);
    } else {
      failed += 1;
      ui.fail(`[${id}] 登录失败：${res.error?.message ?? "unknown"}`);
    }
  }
  return failed === 0 ? EXIT.ok : EXIT.error;
}
