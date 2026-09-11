/** 帮助文本。 */

import { FLAGS, FLAG_GROUPS } from "./args.ts";
import type { UI } from "../core/ui.ts";

const EXAMPLES = [
  ['publish -c "AI Agent 会是下一个十年的基础设施" -to zhihu', "发一条观点到知乎（自动匹配问题）"],
  ["publish -f note.md -to xhs", "从文件读内容发小红书（无图自动生成封面）"],
  ['publish -c "..." -to x,xhs,zhihu', "一条内容，多平台组合发布"],
  ["cat note.md | publish -to xhs", "从 stdin 读内容"],
  ["publish -f drafts/*.md -to xhs --delay 180-420", "多篇内容，拉长随机间隔"],
  ['publish -c "..." -to x --dry-run', "只预演，不做任何写操作"],
  ["publish login -to zhihu", "在浏览器里登录并保存会话"],
  ["publish platforms", "查看已支持的平台和各自限制"],
  ["publish explore https://weibo.com/compose", "探索新站点，生成 route 操作路径骨架"],
  ["publish routes init weibo", "生成自定义 route 模板"],
];

const COMMANDS: [string, string][] = [
  ["publish", "发布内容（默认命令，可省略）"],
  ["login", "打开浏览器完成平台登录"],
  ["platforms", "列出已注册平台及其能力/限制"],
  ["history", "查看本地发布历史与今日配额"],
  ["doctor", "体检：opencli、登录态、配置、封面渲染器"],
  ["explore <url>", "用 opencli 探索页面结构，导出可复用的操作路径"],
  ["routes [list|show|init|path]", "管理自定义平台操作路径"],
  ["config [show|init]", "查看/初始化配置"],
  ["help", "显示帮助"],
];

export function printHelp(ui: UI, topic?: string): void {
  if (topic) {
    const flag = FLAGS.find((f) => f.name === topic || f.alias?.includes(topic));
    if (flag) {
      ui.raw(`${flag.name}${flag.type === "boolean" ? "" : " " + (flag.metavar ?? "<值>")}`);
      ui.raw("  " + flag.help);
      return;
    }
  }
  ui.raw("");
  ui.raw(ui.bold("publish") + " — 把观点快速发布到 小红书 / X / 知乎 / 任意站点");
  ui.raw(ui.dim("基于 opencli 浏览器桥，复用你 Chrome 里的登录态；内置人类化随机延迟与风控护栏。"));
  ui.raw("");
  ui.raw(ui.bold("用法"));
  ui.raw("  publish -c \"<正文>\" -to <平台>[,<平台>...] [选项]");
  ui.raw("  publish -f <文件>   -to <平台>[,<平台>...] [选项]");
  ui.raw("");
  for (const group of FLAG_GROUPS) {
    ui.raw(ui.bold(group));
    for (const f of FLAGS.filter((x) => x.group === group)) {
      const alias = f.alias?.length ? `-${f.alias[0]}, ` : "    ";
      const long = `--${f.name}${f.type === "boolean" ? "" : " " + (f.metavar ?? "<值>")}`;
      ui.raw("  " + alias + long);
      ui.raw("      " + ui.dim(f.help));
    }
    ui.raw("");
  }
  ui.raw(ui.bold("子命令"));
  for (const [name, desc] of COMMANDS) {
    ui.raw("  " + name.padEnd(28) + ui.dim(desc));
  }
  ui.raw("");
  ui.raw(ui.bold("示例"));
  for (const [cmd, desc] of EXAMPLES) {
    ui.raw("  " + cmd);
    ui.raw("    " + ui.dim(desc));
  }
  ui.raw("");
  ui.raw(ui.dim("提示：默认先用 --dry-run 看一眼将要执行的操作，确认无误再去掉。"));
  ui.raw("");
}
