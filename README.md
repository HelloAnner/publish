# publish

> 一条命令，把观点发到多个内容平台。

`publish` 是一个基于 [Bun](https://bun.sh) + TypeScript 的命令行工具，
通过 [opencli](https://www.npmjs.com/package/@jackwener/opencli) 的浏览器桥复用你本机 Chrome 的登录态，
把内容发布到**小红书 / X / 知乎**，以及任何可以用一条「操作路径」描述出来的站点。

```bash
publish -c "AI Agent 不是工具，而是同事" -to zhihu
publish -f note.md -to xhs
publish -c "同一条观点" -to x,xhs,zhihu --yes
```

仓库：[github.com/HelloAnner/publish](https://github.com/HelloAnner/publish) · 许可：[MIT](./LICENSE)


---

## 目录

- [设计理念](#设计理念)
- [功能特性](#功能特性)
- [工作原理](#工作原理)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [平台支持](#平台支持)
- [节奏与风控](#节奏与风控)
- [封面](#封面)
- [自定义平台：操作路径](#自定义平台操作路径)
- [内容文件格式](#内容文件格式)
- [配置](#配置)
- [退出码](#退出码)
- [已知限制](#已知限制)
- [开发](#开发)
- [项目结构](#项目结构)
- [免责声明](#免责声明)
- [License](#license)


---

## 设计理念

内容创作的瓶颈在写，不在发。但「发」这件事一直在偷走注意力：打开网页、确认登录、复制粘贴、
找话题、配图、再换个平台重来一遍；一条观点要发三个地方，最后往往是发一处、懒一处、丢掉一处。

`publish` 只想解决这一件事：**把「发布」压缩成一条命令**。围绕这个目标，它坚持四个原则。

**1. 一条命令，组合式输入输出**

内容来源（`-c` 直接给文本 / `-f` 从文件读 / 管道 stdin）和发布目标（`-to`，可重复、可逗号分隔）
是两个正交的维度，任意组合：

```bash
publish -c "一句话观点" -to x          # 文本 → 单平台
publish -c "一句话观点" -to xhs,x,zhihu # 文本 → 多平台
publish -f note.md -to xhs            # 文件 → 单平台
publish -f drafts/*.md -to xhs,x      # 多篇 → 多平台（串行 + 随机间隔）
cat note.md | publish -to xhs         # 管道 → 平台
```

**2. 不托管任何平台凭据**

没有 token、没有密码、没有第三方服务，也没有平台 API 的申请与审核。工具只做一件事：
驱动**你自己已经登录的浏览器**。登录状态、Cookie、风控指纹全部留在本地浏览器里，
`publish` 退出后不保留任何可被冒用的凭据。这也是选择 opencli 而不是平台官方 SDK 的原因——
官方 API 门槛高、能力受限，而真实发布行为本来就是发生在浏览器里的。

**3. 像人一样发，而不是像机器**

自动化最容易犯的错是「太快、太整齐」。固定间隔、连续发布、失败重试，恰好是最容易被识别的机器特征。
因此 `publish` 的默认策略是**宁可慢，不可封号**：所有等待都是区间随机并叠加抖动，每 N 次插入长休息，
并且在本地记录发布历史，命中频率阈值时**直接拒绝执行**，而不是警告后继续。
详见[节奏与风控](#节奏与风控)。

**4. 平台是「操作路径」，不是硬编码**

每支持一个平台就要改一次代码，这种扩展方式走不远。`publish` 把平台抽象成一条声明式的**操作路径（route）**：
用 YAML 描述「打开哪个页面 → 等什么出现 → 填什么 → 点什么 → 怎么判断成功」。
opencli 已有命令的站点直接复用其高层命令；没有命令的站点，用 `publish explore` 让工具去探索页面结构，
生成操作路径骨架，改完即可用 `-to <你的站点>` 发布。


---

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 多平台组合发布 | 一条内容发到多个平台，或把多篇内容串行发到多个平台 |
| 多种内容来源 | 命令行文本、Markdown 文件（支持 front-matter）、glob、stdin 管道 |
| 人类化随机延迟 | 区间随机 + ±8% 抖动 + 周期性长休息，`--seed` 可复现 |
| 本地频率护栏 | 同平台最小间隔、单平台/全平台每日上限，命中即拒绝执行 |
| 干跑与确认 | `--dry-run` 打印将执行的每一条 opencli 命令；默认执行前需确认 |
| 后台窗口 | 默认 `--window background`，自动化过程不抢占你的鼠标与焦点 |
| 自动封面 | 无配图时本地渲染 3:4 中文封面（默认「纸感」白底黑字），按内容缓存 |
| 可扩展平台 | 声明式 route，支持 `open/click/fill/type/wait/expect/pause/upload/eval` 等动作 |
| 页面探索 | `publish explore <url>` 抓取交互元素、导出正文与截图，生成 route 骨架 |
| 结果可编程 | `--json` 输出结构化结果，退出码区分用法错误 / 未登录 / 被护栏拦截 / 部分成功 |
| 本地历史 | 结构化记录每次发布（平台、标题、结果、链接、耗时），供 `publish history` 与护栏使用 |


---

## 工作原理

```text
  内容来源                        发布目标
  -c / -f / stdin / front-matter      -to xhs,x,zhihu
          │                                │
          └────────────┬───────────────────┘
                       ▼
              ① 装载与规范化（标题 / 正文 / 话题 / 配图）
                       ▼
              ② 逐平台准备：字数校验、话题改写、封面生成、拼装 opencli 命令
                       ▼
              ③ 登录预检 → 风控护栏 → 打印计划 → 人工确认
                       ▼
              ④ 串行执行：随机等待 → 发布 → 记录历史（平台失败即熔断）
                       ▼
   opencli <site> <command>   /   opencli browser <session> <cmd>
                       ▼
                  你的 Chrome（已登录态）
```

两种执行通道：

1. **内置适配器**直接复用 opencli 的高层命令（`xiaohongshu publish`、`twitter post`、`zhihu answer` 等）；
2. **route 操作路径**通过 `opencli browser` 原语（`open` / `fill` / `click` / `wait` / `eval` …）驱动任意页面。

`publish` 本身不接触网络请求，也不解析平台接口——所有平台交互都发生在你的浏览器里。


---

## 安装

### 环境要求

- [Bun](https://bun.sh) ≥ 1.1
- [opencli](https://www.npmjs.com/package/@jackwener/opencli)：`npm i -g @jackwener/opencli`
- Chrome 已安装 opencli 的 Browser Bridge 扩展并连接（`opencli doctor` 全部 OK）
- 目标平台已在你的 Chrome 中登录（`publish login -to zhihu`）

### 安装 CLI

```bash
git clone https://github.com/HelloAnner/publish.git
cd publish
make install      # 安装到 ~/.local/bin/publish（同时提供简写 pub）
make smoke        # 校验：版本号 + dry-run，不会真的发布
```

`make install` 把 `~/.local/bin/publish`、`~/.local/bin/pub` 链接到仓库的 `src/index.ts`（带 `#!/usr/bin/env bun`），
因此修改源码后立即生效，无需重新安装。若 `~/.local/bin` 不在 `PATH` 中，命令会直接打印需要追加的那一行；
遇到同名文件会先备份为 `*.bak.<时间戳>`，不会静默覆盖。

```bash
make help                          # 查看全部目标
make install PREFIX=/usr/local     # 更换安装前缀（可能需要 sudo）
make uninstall                     # 只删除指向本项目的链接
make check                         # 类型检查 + 单元测试
```

也可以使用 Bun 自带的全局链接（与 `make install` 二选一）：

```bash
bun install && make link           # 安装到 ~/.bun/bin
make unlink                        # 需要时移除
```

`publish doctor` 会显示当前 `publish` 究竟安装在何处、opencli 与各平台登录态是否正常。


---

## 快速开始

```bash
# 1) 先预演：打印将要执行的命令，不做任何写操作
publish -c "把复杂留给自己，把简单留给用户" -to xhs,x --dry-run

# 2) 发一条观点到知乎（自动搜索并匹配问题，计划里会显示匹配结果）
publish -c "为什么我认为 Agent 会重构软件行业？至少有三个理由……" -to zhihu

# 3) 从文件发小红书（没有配图会自动生成封面）
publish -f note.md -to xhs

# 4) 一条内容组合发布到多个平台
publish -f note.md -to xhs,x,zhihu --title "我的观点" --yes

# 5) 多篇内容，拉长随机间隔，串行发布
publish -f drafts/*.md -to xhs --delay 180-420

# 6) 管道输入
cat note.md | publish -to xhs
```

> 第一次使用建议先加 `--dry-run`，确认计划与命令无误后再去掉。


---

## 命令参考

| 命令 | 作用 |
| --- | --- |
| `publish -c/-f ... -to ...` | 发布内容（默认命令，`publish` 可省略） |
| `publish login -to <平台>` | 打开前台窗口完成登录 |
| `publish platforms` | 列出平台能力矩阵（图片上限、字数、是否需要标题等） |
| `publish history` | 查看本地发布历史与今日配额 |
| `publish doctor` | 体检：opencli、浏览器桥、各平台登录态、封面渲染器、安装位置 |
| `publish explore <url>` | 探索页面结构，导出 route 操作路径骨架 |
| `publish routes list\|show\|init\|validate\|path` | 管理自定义操作路径 |
| `publish config show\|init\|defaults` | 查看 / 初始化配置 |
| `publish help` | 显示帮助 |

### 常用参数

**内容来源**

| 参数 | 说明 |
| --- | --- |
| `-c, --content <文本>` | 直接给出正文，可重复（多条即多篇） |
| `-f, --file <路径>` | 从文件读取正文，可重复，支持 glob，`-` 表示 stdin |
| `-t, --title <标题>` | 标题（单篇时生效；多篇请用文件 front-matter） |
| `-i, --images <路径>` | 配图，逗号分隔或重复传入 |
| `--topics <话题>` | 话题标签，逗号分隔，无需带 `#` |
| `--target <spec>` | 平台目标，如 `zhihu=question:12345` 或 `zhihu=<问题 URL>` |
| `--combine` | 把多个 `-c/-f` 合并为一篇，而非分别发布 |

**目标平台**

| 参数 | 说明 |
| --- | --- |
| `-to, --platform <列表>` | 目标平台，逗号分隔，可重复；支持 `xhs` / `xiaohongshu` / `小红书` 等别名 |

**节奏与风控**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--delay <a-b\|n>` | `60-180` | 两次发布之间的随机等待（秒） |
| `--pre-delay <a-b\|n>` | `2-8` | 开始前的随机等待（秒） |
| `--min-interval <分钟>` | `20` | 同一平台两次发布的最小间隔 |
| `--max-per-platform <n>` | `5` | 单平台每日发布上限 |
| `--max-per-day <n>` | `10` | 全平台每日发布上限 |
| `--no-guard` / `--force` | — | 跳过频率护栏与内容校验（谨慎使用） |
| `--no-delay` | — | 跳过全部随机等待（风控风险高） |
| `--draft` | — | 存为草稿而不直接发布（小红书支持） |
| `--thread` | — | X 超出 280 加权字数时自动拆成线程 |
| `--allow-truncate` | — | 允许自动截断超限文案（默认只报错） |
| `--seed <n>` | — | 固定随机种子，便于复现节奏 |

**输出与高级**

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 只预演，打印将执行的 opencli 命令，不做任何写操作 |
| `-y, --yes` | 跳过发布前确认（不会跳过护栏） |
| `--json` | 输出结构化结果，便于脚本消费 |
| `-q, --quiet` / `-v, --verbose` | 安静模式 / 打印每次 opencli 调用的细节 |
| `--window <foreground\|background>` | 浏览器窗口模式，默认 `background` |
| `--session <名字>` | opencli 浏览器会话名，默认 `publish` |
| `--timeout <秒>` | 单次 opencli 调用超时，默认 180 |
| `--cover <auto\|none\|路径>` | 封面策略，默认 `auto` |
| `--cover-style <名字>` | 封面样式，默认 `纸感` |
| `--cover-scale <倍数>` | 封面字号缩放，默认 `1` |
| `--config <路径>` / `--history <路径>` | 指定配置文件 / 历史文件 |
| `--route-dir <目录>` | 额外的 route 目录（可重复） |


---

## 平台支持

`publish platforms` 会实时展示当前注册的平台与限制。内置三个平台：

| 平台 | ID / 别名 | 图片 | 标题 | 正文 | 草稿 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 小红书 | `xhs` `xiaohongshu` `小红书` | 最多 9 张（必须） | ≤ 20 字 | ≤ 1000 字 | ✔ | 无配图时自动生成「纸感」封面 |
| X | `x` `twitter` | 最多 4 张 | — | 280 加权字 | — | CJK 记 2、链接记 23；`--thread` 可拆线程 |
| 知乎 | `zhihu` `知乎` | — | — | 无硬限制 | — | 发布 = 回答问题，需 `--target` 或自动匹配问题 |

### 知乎的发布语义

知乎没有「发一条动态」的公开入口，因此 `publish` 把发布建模为**回答问题**：

- 显式指定：`--target zhihu=https://www.zhihu.com/question/123456` 或 `zhihu=question:123456`；
- 自动匹配：未指定时用标题（或正文首行）调用 `opencli zhihu search --type question`，
  取最匹配的问题并在发布计划中显示，需你确认后才真正发布。

正文若为纯文本，会被转换为知乎可接受的 HTML 段落（`<p>` / `<br/>`）；若本身已是 HTML 则原样提交。


---

## 节奏与风控

这部分不是附赠功能，而是工具的核心约束。默认策略是「像人一样慢」：

**1. 人类化随机延迟**

所有等待都是区间随机，并在结果上叠加 ±8% 抖动，避免出现整齐划一的间隔——固定间隔是最容易被识别的机器特征。
`--seed <n>` 可用固定种子复现同一套节奏。

**2. 周期性长休息**

默认每 5 次发布插入一次 5–10 分钟的长休息，避免「连发」特征。

**3. 本地频率护栏**

发布历史记录在 `~/.local/share/publish/history.jsonl`（纯本地，不上传），护栏据此判断：

| 规则 | 默认值 |
| --- | --- |
| 同一平台两次发布最小间隔 | 20 分钟 |
| 单平台每日发布上限 | 5 次 |
| 全平台每日发布上限 | 10 次 |

命中任一规则时**拒绝执行**（退出码 3）并说明原因，而不是警告后继续。确认无风险时才用 `--force` 跳过。
`--dry-run` 只是预览，不受护栏限制。

**4. 串行执行与失败熔断**

所有发布严格串行，绝不并发；某个平台失败后，本次运行不再向该平台继续发布后续内容，
其余平台继续进行。失败一律输出真实错误，不做自动重试。

**5. 发布前确认**

默认会先打印完整计划（标题、字数、图片、备注、将执行的命令）并要求确认；
`--yes` 可跳过确认，但**不会**跳过护栏与内容校验。

**6. 后台窗口**

默认 `--window background`，自动化过程不会抢走你的鼠标与焦点；仅 `login` 强制使用前台窗口。

**明确不做的事**：自动重试、失败后立即重发、多账号轮换、绕过平台风控。

> 任何形式的自动化发布都存在平台风控风险。请自行控制频率，并对发布内容与后果负责。


---

## 封面

小红书必须有图。当内容没有配图时，`publish` 会用本地 Pillow 渲染一张 3:4 封面，
并按内容哈希缓存（同样的内容不会重复渲染）。

| 样式 | 说明 |
| --- | --- |
| `纸感`（默认） | 白底黑字、宋体、小字号、大留白，接近一张纸 |
| `简约` / `科技` / `光影` / `清新` / `几何` | 渐变或纯色底的设计款 |

```bash
publish -c "..." -to xhs --dry-run              # 预览：会打印生成好的封面文件路径
publish -c "..." -to xhs --cover-style 简约
publish -c "..." -to xhs --cover-scale 0.88     # 字号更小（1 为标准，>1 更大）
publish -c "..." -to xhs --images cover.png     # 自己的图优先，不生成封面
publish -c "..." -to xhs --cover none           # 不用封面，改用小红书自带「文字配图」
```

细节：正文首段会作为底部灰色副标题（自动去掉结尾标点）；中文按**禁则**处理，`。，、` 等标点不会出现在行首。
渲染依赖 Python 3 + Pillow；若不可用，会自动退化为小红书自带的文字配图模式。

> `cover.style`（本地渲染样式）与 `cover.cardStyle`（小红书「文字配图」样式，取值为 `基础/边框/…`）是两个独立配置。


---

## 自定义平台：操作路径

对于 opencli 尚无命令的站点，用一个 YAML 文件描述「怎么操作」即可接入：

```bash
publish routes init weibo     # 生成模板到 ~/.config/publish/routes/weibo.yaml
publish routes validate       # 校验所有 route
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
  - wait: { selector: "[contenteditable='true']", timeout: 25000 }
  - pause: [1200, 3200]              # 随机等待，人类化
  - type: { target: "[contenteditable='true']", text: "{{content}}" }
  - pause: [700, 2000]
  - click: { target: "button.submit" }
  - expect: { text: "发送成功" }       # 未出现即判定失败
captureUrl: true                      # 结束后把 location.href 记为发布链接
```

**模板变量**：`{{content}}`（正文 + 话题）、`{{body}}`、`{{title}}`、`{{topics}}`、`{{hashtags}}`、
`{{images}}`、`{{image0}}`、`{{target}}`、`{{id}}`；`{{body|json}}` 会做 JSON 转义（用于 `eval`）。

**可用动作**：`open` `back` `click` `dblclick` `fill` `type` `keys` `hover` `focus` `scroll` `select`
`check` `uncheck` `upload` `drag` `wait` `eval` `state` `find` `get` `extract` `frames` `screenshot`
`pause` `expect`。每个动作会被翻译成对应的 `opencli browser <session> <cmd>` 调用。

> `target` 需要是 **CSS 选择器**或 `state` 快照里的 `[N]` 引用编号，不支持 `text=发送` 这类语义写法——
> 写错时 `publish routes validate` 与发布前的校验都会直接拦下并给出修正提示。

### 探索一个陌生站点

```bash
publish explore https://weibo.com/compose
```

它会打开页面（后台窗口）→ 抓取 `state` 交互元素 → 导出 Markdown 正文 → 截图 →
生成一份填好建议定位的 route 骨架（`~/.config/publish/explore/*.route.yaml`）。
报告里的 `[N]` 编号可以直接作为 `target` 使用，例如 `click: { target: "3" }`。


---

## 内容文件格式

`note.md`：

```markdown
---
title: 为什么我看好 AI Agent
topics: [AI, 思考]
images: [./cover.png]                             # 可选；命令行 --images 优先
target: https://www.zhihu.com/question/123456     # 可选；主要用于知乎
platforms:                                        # 可选；平台级覆盖
  xiaohongshu:
    draft: true
---

正文第一段……

正文第二段……
```

规则：

- front-matter 可省略。标题取值优先级：`--title`（单篇时）> front-matter `title` > 正文首个 `# 标题` > 首行。
- 顶部 `# 标题` 被用作标题时，会从正文中移除，避免重复。
- `-c` 传入的多段文本、`-f` 传入的多个文件，默认按「多篇」处理，串行发布；`--combine` 可合并为一篇。


---

## 配置

优先级（后者覆盖前者）：**内置默认值 → 全局配置 → 项目配置 → 环境变量 → 命令行参数**。

```bash
publish config init      # 写入 ~/.config/publish/config.json
publish config show      # 查看生效配置及其来源
publish config defaults  # 查看内置默认值
```

**配置文件位置**：`~/.config/publish/config.json`，以及项目内的 `.publishrc.json` / `.publishrc.yaml` /
`publish.config.json` 等（可用 `--config <路径>` 显式指定）。

**环境变量**：`PUBLISH_OPENCLI`、`PUBLISH_SESSION`、`PUBLISH_WINDOW`、`PUBLISH_DELAY`、
`PUBLISH_MIN_INTERVAL`、`PUBLISH_MAX_PER_DAY`、`PUBLISH_GUARD=0`。

**本地目录**：

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
| `0` | 全部成功（`--dry-run` 亦视为成功） |
| `1` | 全部失败 |
| `2` | 用法或内容校验错误（如 X 超长且未开启 `--thread`） |
| `3` | 被风控护栏拦截 |
| `4` | 未登录 |
| `5` | 部分成功 |

配合 `--json` 可在脚本中判断结果。


---

## 已知限制

诚实地列出当前边界：

1. **小红书长文（写长文）尚未支持**。opencli 的 `xiaohongshu publish` 只覆盖图文笔记，
   正文上限 1000 字；点击创作中心的「写长文」入口会跳转到登录页，需要单独调研后再接入。
   超过 1000 字的文件目前会报错，需要 `--allow-truncate` 截断，或先用 route 自行实现长文流程。
2. **知乎需要问题目标**。知乎发布语义是「回答问题」，未指定 `--target` 时依赖搜索自动匹配，匹配结果需人工确认。
3. **微博等站点只有示例 route**。`examples/routes/weibo.yaml` 中的选择器是起始模板，未做端到端验证，
   使用前请先用 `publish explore` 校对。
4. **route 的 `target` 只支持 CSS 选择器与快照编号**，不支持语义定位（如 `text=发送`）。
5. **依赖浏览器桥的稳定性**。opencli 的浏览器连接异常时，`publish doctor` 会先行提示。


---

## 开发

```bash
make deps         # 安装开发依赖
make test         # 单元测试（全部使用假 opencli，不会真的发布）
make typecheck    # TypeScript 类型检查
make check        # 类型检查 + 单元测试
make dev ARGS=... # 直接用 bun 运行源码
```

测试全部通过注入的假 Runner 完成，不依赖网络、不打开浏览器、不会产生任何真实发布行为。

```text
77 pass / 0 fail
```


---

## 项目结构

```text
src/
  index.ts                  入口（#!/usr/bin/env bun）
  cli/
    args.ts                 参数解析（支持 -to 这类多字符短选项）
    main.ts                 命令分发与 CLI 覆盖项
    help.ts                 帮助文本
    context.ts              运行时上下文
    commands/               publish / login / platforms / history / doctor / explore / routes / config
  core/
    content.ts              内容装载：-c / -f / stdin / glob / front-matter
    delay.ts                人类化随机延迟计划
    risk.ts                 风控护栏与本地历史
    opencli.ts              opencli 调用层（进程执行、输出解析、--window）
    cover.ts                封面渲染（Pillow 脚本 + 样式表 + 缓存）
    config.ts               配置加载与合并
    registry.ts             平台注册表与别名
    types.ts / ui.ts / util.ts / errors.ts / paths.ts / random.ts / yaml.ts
  adapters/
    twitter.ts              X：加权字数、hashtag、线程拆分
    xiaohongshu.ts          小红书：标题/正文字数、图片与文字配图、草稿
    zhihu.ts                知乎：问题目标解析与自动匹配、HTML 转换
    route.ts                通用操作路径适配器（YAML steps → opencli browser）
  routes/                   内置 route 目录
tests/                      bun:test 用例（全部使用假 opencli）
examples/routes/            示例操作路径
Makefile                    安装与开发目标
```


---

## 免责声明

本项目仅用于自动化**你自己账号**在**你自己浏览器**中的发布操作。使用者需自行遵守各平台的服务条款与社区规范，
并对发布内容及由此产生的任何后果负责。作者不对账号受限、内容被删或任何间接损失承担责任。

请勿用于垃圾信息投放、多账号批量操作或任何规避平台风控的场景。


---

## License

[MIT](./LICENSE) © 2026 Anner

