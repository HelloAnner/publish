# publish

> 把一条观点，几秒钟发到 **小红书 / X / 知乎 / 任意站点**。
> 基于 [opencli](https://www.npmjs.com/package/@jackwener/opencli) 浏览器桥复用你 Chrome 里的登录态，
> 内置**人类化随机延迟**与**风控护栏**，默认**后台窗口**操作，不抢你的鼠标。

```bash
publish -c "AI Agent 不是工具，而是同事" -to zhihu
publish -f note.md -to xhs
publish -c "同一条观点" -to x,xhs,zhihu --yes
```

---

## 安装

```bash
cd ~/publish
bun install
bun link          # 把 publish 链接到全局，之后任意目录都能用
publish --version
```

依赖前提：

1. 已安装 `opencli`：`npm i -g @jackwener/opencli`
2. Chrome 里装了 opencli 的 Browser Bridge 扩展并处于连接状态（`opencli doctor` 全 OK）
3. 目标站点已在你的 Chrome 里登录（`publish login -to zhihu`）

---

## 快速开始

```bash
# 1) 先看一眼会发生什么（不会写任何东西）
publish -c "把复杂留给自己，把简单留给用户" -to xhs,x --dry-run

# 2) 直接发观点到知乎（自动搜索并匹配问题，会在计划里显示匹配到哪个问题）
publish -c "为什么我认为 Agent 会重构软件行业？至少有三个理由……" -to zhihu

# 3) 从文件发小红书（没有配图会自动生成一张 3:4 封面）
publish -f note.md -to xhs

# 4) 一条内容多平台组合
publish -f note.md -to xhs,x,zhihu --title "我的观点" --yes

# 5) 多篇内容，拉长随机间隔，串行发
publish -f drafts/*.md -to xhs --delay 180-420

# 6) 管道输入
cat note.md | publish -to xhs
```

---

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `publish -c/-f ... -to ...` | 发布（默认命令，可省略 `publish`） |
| `publish login -to zhihu` | 打开前台窗口完成登录 |
| `publish platforms` | 平台能力矩阵（图片上限、字数、是否要标题…） |
| `publish history` | 本地发布历史 + 今日配额 |
| `publish doctor` | 体检：opencli / 浏览器桥 / 各平台登录态 / 封面渲染器 |
| `publish explore <url>` | 用 opencli 探索页面，导出可复用的操作路径骨架 |
| `publish routes list\|show\|init\|validate\|path` | 管理自定义平台操作路径 |
| `publish config show\|init\|defaults` | 查看 / 初始化配置 |

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `-c, --content <文本>` | 正文，可重复（多条 = 多篇） |
| `-f, --file <路径>` | 从文件读，可重复，支持 glob，`-` 表示 stdin |
| `-to, --platform <列表>` | 目标平台，逗号分隔，可重复；支持 `xhs`/`xiaohongshu`/小红书 等别名 |
| `-t, --title <标题>` | 标题（单篇时生效） |
| `-i, --images <路径>` | 配图，逗号分隔或重复传入 |
| `--topics <话题>` | 话题标签，逗号分隔，不用带 # |
| `--target <spec>` | 平台目标，如 `zhihu=question:12345` 或 `zhihu=https://www.zhihu.com/question/123` |
| `--combine` | 多个 `-c/-f` 合并成一篇而不是分别发 |
| `--draft` | 存草稿（小红书支持） |
| `--thread` | X 超过 280 加权字数时自动拆成线程 |
| `--delay <a-b\|n>` | 两次发布之间的随机等待秒数（默认 60-180） |
| `--pre-delay <a-b\|n>` | 开始前的随机等待（默认 2-8 秒） |
| `--min-interval <分钟>` | 同平台最小间隔（默认 20） |
| `--max-per-day <n>` | 全平台每日上限（默认 10） |
| `--max-per-platform <n>` | 单平台每日上限（默认 5） |
| `--force` / `--no-guard` | 跳过护栏与校验（**请谨慎**） |
| `--no-delay` | 跳过所有等待（**风控风险高**） |
| `--window <foreground\|background>` | 浏览器窗口模式，默认 background 不抢焦点 |
| `--dry-run` | 只预演，打印将要执行的 opencli 命令 |
| `--json` | 结构化输出，便于脚本消费 |
| `-y, --yes` | 跳过发布前确认 |

---

## 平台能力

`publish platforms` 实时展示。当前内置：

| 平台 | 图片 | 标题 | 正文 | 草稿 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 小红书 `xhs` | 最多 9 张（必须） | ≤ 20 字 | ≤ 1000 字 | ✔ | 无图自动生成封面，失败则退化为「文字配图」模式 |
| X `x` | 最多 4 张 | — | 280 加权字（CJK=2、链接=23） | — | 超长用 `--thread` 拆线程 |
| 知乎 `zhihu` | — | — | 很长 | — | 发布 = 回答问题，需 `--target` 或自动匹配问题 |

X 的 280 是**加权**字数（中文算 2），所以一条 140 字的中文推文正好占满。

---

## 节奏与风控设计

这是这个工具的**核心**，不是附赠功能。默认策略是「像人一样慢」，而不是「尽量快」：

1. **人类化随机延迟**
   所有等待都是区间随机，再叠加 ±8% 抖动，避免出现整齐划一的间隔——
   固定间隔是最容易被识别的机器特征。`--seed` 可复现同一套节奏。
2. **长休息**
   默认每 5 次发布插入一次 5-10 分钟的长休息，避免「连发」特征。
3. **本地频率护栏**（`~/.local/share/publish/history.jsonl`）
   - 同一平台两次发布至少间隔 20 分钟
   - 单平台每日 ≤ 5 次，全平台每日 ≤ 10 次
   - 命中护栏直接**拒绝执行**（退出码 3），而不是警告后继续
4. **串行 + 单平台失败熔断**
   绝不并发；某个平台失败后，本次运行不再向该平台继续发第二篇。
5. **发布前确认**
   默认打印完整计划（标题 / 字数 / 图片 / 备注 / 将执行的命令）并要求确认；
   `--yes` 可跳过，但只会跳过确认，不会跳过护栏。
6. **后台窗口**
   默认 `--window background`，操作不会抢走你的鼠标和焦点；只有 `login` 强制前台。
7. **不做的事**
   不做自动重试、不做失败后立刻重发、不做多账号轮换。失败就报真实错误，由你决定。

> 任何自动化发布都存在平台风控风险。请自行控制频率，并对发布内容负责。

---

## 自定义平台：一个 route 就是一条操作路径

opencli 没有命令的站点，用一段声明式的 YAML 描述「怎么操作」即可：

```bash
publish routes init weibo     # 生成模板到 ~/.config/publish/routes/weibo.yaml
# 编辑 steps 后：
publish -c "我的观点" -to weibo --dry-run
publish -c "我的观点" -to weibo
```

```yaml
id: weibo
name: 微博
session: publish-weibo
capabilities:
  text: true
  images: 9
  maxTextLength: 2000
steps:
  - open: "https://weibo.com/compose"
  - wait: { selector: "textarea", timeout: 20000 }
  - pause: [900, 2400]                 # 随机等待，人类化
  - fill: { target: "textarea", text: "{{content}}" }
  - pause: [500, 1600]
  - click: { target: "text=发送" }
  - expect: { text: "发布成功" }        # 没出现就判定失败
captureUrl: true                       # 结束后把 location.href 记为发布链接
```

**模板变量**：`{{content}}`（正文+话题）、`{{body}}`、`{{title}}`、`{{topics}}`、`{{hashtags}}`、
`{{images}}`、`{{image0}}`、`{{target}}`、`{{id}}`；`{{body|json}}` 会做 JSON 转义（用于 `eval`）。

**可用动作**：`open` `back` `click` `dblclick` `fill` `type` `keys` `hover` `focus` `scroll` `select`
`check` `uncheck` `upload` `drag` `wait` `eval` `state` `find` `get` `extract` `frames` `screenshot`
`pause` `expect`。每个动作会被翻译成对应的 `opencli browser <session> <cmd>` 调用。

**不知道怎么选元素？** 让工具去探索：

```bash
publish explore https://weibo.com/compose
```

它会：打开页面（后台窗口）→ 抓 `state` 交互元素 → 导出 Markdown 正文 → 截图 → 生成一份填好建议定位的
route 骨架（`~/.config/publish/explore/*.route.yaml`）。报告里的 `[N]` 索引可以直接当 target 用：
`click: { target: "3" }`。

---

## 内容文件格式

`note.md`：

```markdown
---
title: 为什么我看好 AI Agent
topics: [AI, 思考]
images: [/Users/me/cover.png]     # 可选，命令行 --images 优先
target: https://www.zhihu.com/question/123456   # 可选，知乎问题
---

正文第一段……

正文第二段……
```

- front-matter 可选；没有 `title` 时用正文第一个 `# 标题`，再退化为首行。
- `platforms:` 块可写平台级覆盖，例如 `platforms: { xiaohongshu: { draft: true } }`。

---

## 配置文件

优先级：**内置默认 → `~/.config/publish/config.json` → 当前目录 `.publishrc.json`/`publish.config.json` → 环境变量 → 命令行参数**。

```bash
publish config init      # 写入 ~/.config/publish/config.json
publish config show      # 查看生效配置 + 来源
```

环境变量：`PUBLISH_OPENCLI`、`PUBLISH_SESSION`、`PUBLISH_WINDOW`、`PUBLISH_DELAY`、
`PUBLISH_MIN_INTERVAL`、`PUBLISH_MAX_PER_DAY`、`PUBLISH_GUARD=0`。

目录：

| 用途 | 路径 |
| --- | --- |
| 配置 | `~/.config/publish/config.json` |
| 自定义 route | `~/.config/publish/routes/*.yaml` |
| 发布历史 | `~/.local/share/publish/history.jsonl` |
| 封面缓存 | `~/.cache/publish/covers/` |
| 探索报告 | `~/.config/publish/explore/` |

---

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 全部成功（`--dry-run` 也算成功） |
| 1 | 全部失败 |
| 2 | 用法/内容校验错误（例如 X 超长没开 `--thread`） |
| 3 | 风控护栏拦截 |
| 4 | 未登录 |
| 5 | 部分成功 |

配合 `--json` 可以在脚本里判断。

---

## 工作原理

```
内容(-c/-f/stdin/front-matter)
   ↓ 装载与规范化
每个平台一份「已备好的发布」prepare()：改标题、算字数、补话题、配好图、生成 opencli 命令
   ↓ 登录预检 → 风控护栏 → 打印计划 → 人工确认
串行执行：随机等待 → adapter.publish() → 写历史
   ↓
opencli <site> <command> / opencli browser <session> <cmd>  →  你的 Chrome
```

- 内置平台直接复用 opencli 的高层命令（`xiaohongshu publish` / `twitter post` / `zhihu answer`）。
- 其它站点走 `opencli browser` 原语（route 操作路径）。
- 封面由本地 Pillow 渲染（macOS 上用 PingFang/黑体，中文正常显示），按内容 hash 缓存。

---

## 开发

```bash
bun test          # 69 个用例，全部使用假 opencli，不会真的发布
npx tsc --noEmit  # 类型检查
```

目录结构：

```
src/
  index.ts              入口
  cli/                  参数、帮助、上下文、各子命令
  core/                 内容装载、延迟引擎、风控、opencli 调用、封面、配置
  adapters/             twitter / xiaohongshu / zhihu / route（通用操作路径）
  routes/               内置 route 目录
tests/                  bun:test 用例
examples/routes/        示例操作路径
```
