/** explore：用 opencli 探索页面结构，导出可复用的 route 骨架。 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { callOpencli } from "../../core/opencli.ts";
import { EXIT, UsageError } from "../../core/errors.ts";
import { configDir } from "../../core/paths.ts";
import type { CliContext } from "../context.ts";

export interface StateElement {
  index: number;
  tag: string;
  attrs: string;
  text: string;
  ref?: string;
}

function slugify(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "page";
  } catch {
    return "page";
  }
}

/** 解析 \`opencli browser <s> state\` 的文字输出：[1]<a href=x>text</a> */
export function parseStateElements(text: string): StateElement[] {
  const out: StateElement[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*\[(\d+)\]<([a-zA-Z0-9-]+)((?:\s[^>]*)?)>(.*?)<\/\2>\s*$/.exec(line);
    if (!m) continue;
    out.push({ index: Number(m[1]), tag: m[2]!, attrs: m[3]!.trim(), text: m[4]!.trim() });
  }
  return out;
}

/** 从 attrs 串里挑一个稳定定位方式，用于生成 route 骨架。 */
export function suggestTarget(el: StateElement): string {
  const pick = (name: string): string | undefined => {
    const re = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|([^\\s]+))`);
    const m = re.exec(el.attrs);
    if (!m) return undefined;
    return (m[1] ?? m[2] ?? "").trim() || undefined;
  };
  const testid = pick("data-testid") ?? pick("data-test");
  if (testid) return `[data-testid="${testid}"]`;
  const placeholder = pick("placeholder");
  if (placeholder) return `[placeholder*="${placeholder}"]`;
  const aria = pick("aria-label");
  if (aria) return `[aria-label*="${aria}"]`;
  if (el.text && el.text.length <= 12) return `text=${el.text}`;
  return `${el.tag}:nth-of-type(1)`;
}

export async function runExplore(ctx: CliContext): Promise<number> {
  const { ui, flags, config } = ctx;
  const url = ctx.rest[0];
  if (!url || !/^https?:\/\//.test(url)) {
    throw new UsageError("请给出要探索的完整 URL", "例：publish explore https://weibo.com/compose");
  }
  const session = flags.str("session") ?? config.opencli.session;
  const call = (args: string[], timeoutMs = config.opencli.timeoutMs) =>
    callOpencli(ctx.run, args, {
      binary: config.opencli.binary,
      timeoutMs,
      window: config.opencli.window,
      onInvoke: (a) => ui.detail("opencli " + a.join(" ")),
    });

  ui.step(`在会话 ${session} 打开 ${url}`);
  const opened = await call(["browser", session, "open", url]);
  if (!opened.ok) {
    ui.fail(`打开失败：${opened.error?.message ?? "unknown"}`);
    return EXIT.error;
  }
  await call(["browser", session, "wait", "time", "3"], 60_000);

  const stateRes = await call(["browser", session, "state"]);
  const stateText = stateRes.ok ? stateRes.exec.stdout : "";
  const elements = parseStateElements(stateText);

  const extractRes = await call(["browser", session, "extract"], 90_000);
  const extractRow = extractRes.rows.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
  const markdown = typeof extractRow?.content === "string" ? extractRow.content : undefined;
  const title = typeof extractRow?.title === "string" ? extractRow.title : undefined;

  const dir = join(configDir(), "explore");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${slugify(url)}`;
  const reportPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);
  const shotPath = join(dir, `${base}.png`);
  const shot = await call(["browser", session, "screenshot", shotPath], 60_000);

  const report = {
    url,
    session,
    title: title ?? null,
    exploredAt: new Date().toISOString(),
    elements,
    stateText,
    screenshot: shot.ok ? shotPath : null,
    screenshotError: shot.ok ? null : (shot.error?.message ?? "unknown"),
  };
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  if (markdown) await Bun.write(mdPath, markdown);

  const routeId = (slugify(url).split("-").filter((s) => s && !["com", "www", "https"].includes(s))[0] ?? "site").slice(0, 20);
  const input = elements.find((e) => ["textarea", "input"].includes(e.tag));
  const button = elements.find((e) => e.tag === "button" || /发送|发布|提交|submit/i.test(e.text));
  const skeleton = `# publish explore 生成的操作路径骨架（${new Date().toISOString()}）
# 页面：${url}
# 登录后把本文件放到 ~/.config/publish/routes/${routeId}.yaml，即可 publish -to ${routeId}
id: ${routeId}
name: ${routeId}
# site: ${routeId}        # opencli 有对应 site 时启用登录检查
session: publish-${routeId}
capabilities:
  text: true
  images: 9
  requiresImage: false
  title: false
  maxTextLength: 2000
  topics: true
  draft: false
steps:
  - open: "${url}"
  - wait: { selector: "${input ? suggestTarget(input) : "textarea"}", timeout: 20000 }
  - pause: [900, 2400]
  - fill: { target: "${input ? suggestTarget(input) : "textarea"}", text: "{{content}}" }
  - pause: [500, 1600]
  - click: { target: "${button ? suggestTarget(button) : "text=发送"}" }
  - expect: { text: "发布成功" }
captureUrl: true
`;
  const skeletonPath = join(dir, `${base}.route.yaml`);
  await Bun.write(skeletonPath, skeleton);

  if (ui.json) {
    process.stdout.write(
      JSON.stringify({ reportPath, markdownPath: markdown ? mdPath : null, screenshot: shot.ok ? shotPath : null, elements, skeletonPath }, null, 2) + "\n",
    );
    return EXIT.ok;
  }

  ui.head("页面可交互元素");
  if (elements.length === 0) {
    ui.info(ui.dim("  没解析到交互元素；看 state 原文或截图确认页面是否需要登录。"));
  } else {
    ui.table(
      ["#", "标签", "文本", "属性", "建议定位"],
      elements.slice(0, 40).map((e) => [
        String(e.index),
        e.tag,
        e.text.replace(/\s+/g, " ").slice(0, 30),
        e.attrs.replace(/\s+/g, " ").slice(0, 30),
        suggestTarget(e).slice(0, 30),
      ]),
    );
    ui.raw("");
    ui.info(ui.dim("  route 里可以直接用 [N] 索引当 target，例如 click: { target: \"3\" }"));
  }
  ui.raw("");
  ui.ok(`探索报告：${reportPath}`);
  if (markdown) ui.ok(`页面正文：${mdPath}`);
  if (shot.ok) ui.ok(`页面截图：${shotPath}`);
  else ui.warn(`截图不可用：${shot.error?.message ?? "unknown"}`);
  ui.ok(`route 骨架：${skeletonPath}`);
  ui.info(ui.dim("  改好后放到 ~/.config/publish/routes/ 下即可用 -to <id> 发布。"));
  ui.raw("");
  return EXIT.ok;
}
