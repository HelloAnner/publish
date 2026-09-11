/** routes：管理自定义操作路径。 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { builtinRouteDirs } from "../../adapters/index.ts";
import { parseRoute, loadRoutes } from "../../adapters/route.ts";
import { EXIT, UsageError } from "../../core/errors.ts";
import { userRouteDir } from "../../core/paths.ts";
import { readStructuredFile } from "../../core/yaml.ts";
import type { CliContext } from "../context.ts";

const TEMPLATE = (id: string) => `# publish 自定义操作路径（route）
# 用法：把文件放到 ${userRouteDir()}/${id}.yaml，然后 publish -c "正文" -to ${id}
id: ${id}
name: ${id}
# site: ${id}            # opencli 里对应的 site 名，用于自动登录检查（可选）
session: publish-${id}   # opencli browser 会话名
capabilities:
  text: true
  images: 9
  requiresImage: false
  title: false
  maxTextLength: 2000
  topics: true
  draft: false

# 可用模板变量：
#   {{content}} 正文 + 话题   {{body}} 正文   {{title}} 标题
#   {{topics}} 逗号分隔话题   {{hashtags}} "#a #b"   {{images}} 逗号分隔图片路径
#   {{image0}} 第一张图       {{target}} 目标        {{id}} 内容 id
# JSON 场景可用 {{value|json}} 做转义。
#
# target 只能是 CSS 选择器（如 'button.submit'、'[placeholder*="标题"]'）
# 或 state 快照里的 [N] 编号（如 "3"）——opencli 不支持 text= 这类语义定位。
steps:
  - open: "https://example.com/compose"
  - wait: { selector: "textarea", timeout: 20000 }
  - pause: [900, 2400]
  - fill: { target: "textarea", text: "{{content}}" }
  - pause: [500, 1600]
  - click: { target: "button[type=submit]" }   # 换成真实选择器（用 publish explore 校对）
  - expect: { text: "发布成功" }
# verify:
#   selector: ".success"
captureUrl: true
`;

export async function runRoutes(ctx: CliContext): Promise<number> {
  const { ui, flags } = ctx;
  const sub = ctx.rest[0] ?? "list";

  if (sub === "path") {
    for (const dir of builtinRouteDirs()) ui.raw(dir);
    return EXIT.ok;
  }

  if (sub === "list") {
    const adapters = ctx.registry.list();
    if (ui.json) {
      process.stdout.write(
        JSON.stringify(
          adapters.map((a) => ({ id: a.id, name: a.name, builtin: !a.routePath, path: a.routePath ?? null })),
          null,
          2,
        ) + "\n",
      );
      return EXIT.ok;
    }
    const custom = adapters.filter((a) => a.routePath);
    ui.head(`自定义 route（${custom.length}）`);
    if (custom.length === 0) {
      ui.info(ui.dim("  还没有自定义 route。用 publish routes init <id> 生成模板。"));
    } else {
      ui.table(["ID", "名称", "文件"], custom.map((a) => [a.id, a.name, a.routePath!]));
    }
    ui.raw("");
    ui.info(ui.dim("  搜索目录："));
    for (const dir of builtinRouteDirs()) ui.info(ui.dim("    " + dir));
    ui.raw("");
    return EXIT.ok;
  }

  if (sub === "show") {
    const id = ctx.rest[1];
    if (!id) throw new UsageError("用法：publish routes show <id>");
    const adapter = ctx.registry.get(id);
    if (!adapter) throw new UsageError(`未注册的 route：${id}`);
    if (!adapter.routePath) {
      ui.info(`${id} 是内置平台适配器，没有 route 文件。`);
      return EXIT.ok;
    }
    const data = await readStructuredFile(adapter.routePath);
    const def = parseRoute(data, adapter.routePath);
    ui.head(`${def.name}（${def.id}）`);
    ui.info(`  文件：${def.path}`);
    ui.info(`  会话：${def.session ?? "(默认)"}`);
    ui.info(`  步骤：${def.steps.length}`);
    ui.raw("");
    for (const [i, step] of def.steps.entries()) {
      ui.info(`  ${String(i + 1).padStart(2)}. ${JSON.stringify(step)}`);
    }
    ui.raw("");
    if (ctx.flags.bool("verbose")) ui.raw(await Bun.file(adapter.routePath).text());
    return EXIT.ok;
  }

  if (sub === "validate") {
    const dirs = [...flags.all("route-dir"), ...ctx.config.routeDirs, ...builtinRouteDirs()];
    const { routes, warnings } = await loadRoutes(dirs);
    for (const w of warnings) ui.fail(w);
    ui.ok(`校验完成：${routes.length} 个 route 正常，${warnings.length} 个错误`);
    return warnings.length === 0 ? EXIT.ok : EXIT.error;
  }

  if (sub === "init") {
    const id = ctx.rest[1];
    if (!id) throw new UsageError("用法：publish routes init <id>");
    const dir = flags.all("route-dir")[0] ?? userRouteDir();
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${id}.yaml`);
    const file = Bun.file(target);
    if ((await file.exists()) && !ctx.force) {
      throw new UsageError(`文件已存在：${target}`, "加 --force 覆盖");
    }
    await Bun.write(target, TEMPLATE(id));
    ui.ok(`已生成 route 模板：${target}`);
    ui.info(ui.dim("  编辑 steps 后运行：publish routes validate"));
    return EXIT.ok;
  }

  throw new UsageError(`未知子命令：${sub}`, "可用：list / show <id> / init <id> / validate / path");
}
