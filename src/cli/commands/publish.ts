/** publish：内容 → 计划 → 确认 → 串行发布（带人类化延迟与风控护栏）。 */

import { isAbsolute, resolve } from "node:path";
import { resolvePlatforms, describeMissingPlatform } from "../../core/registry.ts";
import { loadPosts, parseTargetSpecs, stdinHasData } from "../../core/content.ts";
import { createRng } from "../../core/random.ts";
import { planWaits, formatWait } from "../../core/delay.ts";
import { appendHistory, evaluateGuard, readHistory } from "../../core/risk.ts";
import { generateCover } from "../../core/cover.ts";
import { callOpencli, decorateForDisplay } from "../../core/opencli.ts";
import { AuthRequiredError, EXIT, GuardError, PublishError, UsageError } from "../../core/errors.ts";
import type { AuthState, PlatformAdapter, Post, PreparedPublish, RunContext } from "../../core/types.ts";
import { confirm } from "../../core/ui.ts";
import { truncateDisplay } from "../../core/util.ts";
import type { CliContext } from "../context.ts";

interface Step {
  post: Post;
  adapter: PlatformAdapter;
  prepared: PreparedPublish;
  index: number;
}

interface StepResult {
  platform: string;
  platformName: string;
  postId: string;
  title?: string;
  ok: boolean;
  url?: string;
  detail?: string;
  error?: string;
  durationMs: number;
}

export async function runPublish(ctx: CliContext): Promise<number> {
  const { ui, flags, config } = ctx;
  const platformInput = flags.list("platform");
  const platforms = resolvePlatforms(platformInput.length > 0 ? platformInput : config.defaults.platforms);
  if (platforms.length === 0) {
    throw new UsageError("没有指定目标平台", '例：publish -c "今天想说的观点" -to zhihu,xhs');
  }

  const adapters: PlatformAdapter[] = platforms.map((p) => {
    const adapter = ctx.registry.get(p);
    if (!adapter) throw new UsageError(describeMissingPlatform(p, ctx.registry.ids()));
    return adapter;
  });

  // ── 1. 内容 ─────────────────────────────────────────────
  // 没有 -c/-f 但 stdin 是管道时，自动读管道（cat note.md | publish -to xhs）
  const contents = flags.all("content");
  const files = flags.all("file");
  if (contents.length === 0 && files.length === 0 && stdinHasData()) files.push("-");
  const loaded = await loadPosts({
    contents,
    files,
    title: flags.str("title"),
    topics: flags.list("topics"),
    images: flags.list("images"),
    combine: flags.bool("combine"),
    cwd: ctx.cwd,
  });
  for (const w of loaded.warnings) ui.warn(w);
  if (loaded.posts.length === 0) {
    throw new UsageError("没有可发布的内容", '用 -c "正文" 或 -f 文件路径 提供内容；也可以从 stdin 读：cat note.md | publish -to xhs');
  }
  const posts = loaded.posts;
  const targetSpecs = parseTargetSpecs(flags.list("target"), platforms);

  // ── 2. 封面兜底 ─────────────────────────────────────────
  await ensureCovers(ctx, posts, adapters);

  // ── 3. 登录预检 ─────────────────────────────────────────
  const auth = new Map<string, AuthState>();
  if (!ctx.dryRun) {
    for (const adapter of adapters) {
      const state = await checkAuth(adapter, ctx);
      auth.set(adapter.id, state);
      if (!state.loggedIn) {
        throw new AuthRequiredError(adapter.id, state.detail);
      }
      ui.detail(`${adapter.id} 登录状态：${state.username ?? "已登录"}`);
    }
  } else {
    ui.info(ui.dim("· dry-run：跳过登录检查"));
  }

  // ── 4. 计划 ─────────────────────────────────────────────
  const steps: Step[] = [];
  const planErrors: string[] = [];
  for (const adapter of adapters) {
    for (const post of posts) {
      const scoped: Post = targetSpecs.get(adapter.id) ? { ...post, target: targetSpecs.get(adapter.id) } : post;
      const prepared = await adapter.prepare(scoped, {
        config,
        ui,
        dryRun: ctx.dryRun,
        run: ctx.run,
        options: { thread: flags.bool("thread"), draft: flags.bool("draft") || config.defaults.draft, allowTruncate: flags.bool("allow-truncate"), force: ctx.force },
      });
      for (const w of prepared.warnings) ui.warn(`[${adapter.id}] ${w}`);
      for (const e of prepared.errors) planErrors.push(`[${adapter.id}] ${post.source} → ${e}`);
      if (prepared.errors.length === 0) steps.push({ post: scoped, adapter, prepared, index: steps.length });
    }
  }
  if (planErrors.length > 0) {
    for (const e of planErrors) ui.fail(e);
    if (!ctx.force) {
      ui.info(ui.dim("· 修正后用 --force 可跳过校验强行发布"));
      return EXIT.usage;
    }
    ui.warn("--force：忽略上面的校验错误继续");
  }
  if (steps.length === 0) {
    throw new PublishError("没有任何可执行的发布动作");
  }

  // ── 5. 护栏 ─────────────────────────────────────────────
  // dry-run 不产生任何写操作，预览不该被频率护栏挡住
  const history = ctx.dryRun ? [] : await readHistory(ctx.historyPath);
  const plannedPerPlatform: Record<string, number> = {};
  for (const s of steps) plannedPerPlatform[s.adapter.id] = (plannedPerPlatform[s.adapter.id] ?? 0) + 1;
  const guard = ctx.dryRun
    ? { violations: [], notes: [] }
    : evaluateGuard({ history, platforms, plannedPerPlatform, config: config.guard });
  for (const n of guard.notes) ui.warn(n);
  if (guard.violations.length > 0) {
    ui.head("风控护栏拦截");
    for (const v of guard.violations) ui.fail(`${v.platform ? "[" + v.platform + "] " : ""}${v.message}`);
    if (!ctx.force) {
      throw new GuardError("发布频率超过安全阈值", "拆成多次、拉长间隔后再发；确认无风险可加 --force");
    }
    ui.warn("--force：已跳过风控护栏（请自行承担账号风险）");
  }

  printPlan(ctx, steps);

  // ── 6. 执行 ─────────────────────────────────────────────
  const rngState = createRng(flags.num("seed"));
  const rng = rngState.rng;
  const waits = planWaits({
    count: steps.length,
    config: config.delay,
    rng,
    includePre: true,
    // dry-run 也照常估算等待时间，只是不会真的 sleep
    disabled: flags.bool("no-delay"),
  });
  const totalWait = waits.reduce((a, b) => a + b.ms, 0);

  if (ctx.dryRun) {
    ui.head("dry-run：以下命令不会真正执行");
    steps.forEach((s, i) => {
      ui.info(`  ${i + 1}. [${s.adapter.id}] ${s.post.source}`);
      for (const args of s.prepared.plan) {
        const display = decorateForDisplay(args, config.opencli.window).join(" ");
        ui.info("     " + ui.dim(args[0]?.startsWith("#") ? display : "opencli " + display));
      }
    });
    emitJson(ctx, {
      ok: true,
      dryRun: true,
      planned: steps.length,
      totalWaitMs: totalWait,
      steps: steps.map((s) => describeStep(s, config.opencli.window)),
    });
    return EXIT.ok;
  }

  const proceed = await confirm(
    `即将向 ${platforms.join(" / ")} 发布 ${posts.length} 篇内容（共 ${steps.length} 次写操作，预计等待 ${formatWait(totalWait)}），继续？`,
    { default: false, assumeYes: ctx.assumeYes || flags.bool("yes") },
  );
  if (!proceed) {
    ui.info("已取消，未做任何发布。");
    return EXIT.ok;
  }

  const controller = new AbortController();
  const onSigint = () => {
    ui.warn("收到中断信号，正在停止后续发布（已提交的内容不受影响）");
    controller.abort();
  };
  process.on("SIGINT", onSigint);

  const runCtx: RunContext = {
    config,
    ui,
    dryRun: false,
    run: ctx.run,
    options: { thread: flags.bool("thread"), draft: flags.bool("draft") || config.defaults.draft, allowTruncate: flags.bool("allow-truncate"), force: ctx.force },
    signal: controller.signal,
  };

  const results: StepResult[] = [];
  const failedPlatforms = new Set<string>();
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const wait = waits[i];
      if (wait && wait.ms > 0) {
        await ui.countdown(wait.ms, `${wait.label}（${i + 1}/${steps.length}）`, controller.signal);
      }
      if (controller.signal.aborted) break;
      if (failedPlatforms.has(step.adapter.id)) {
        ui.warn(`[${step.adapter.id}] 本次运行中该平台已失败过，跳过：${step.post.source}`);
        continue;
      }
      const label = `[${step.adapter.id}] ${truncateDisplay(step.prepared.title ?? step.post.source, 40)}`;
      ui.step(`发布中 ${label}`);
      const started = Date.now();
      const outcome = await step.adapter.publish(step.prepared, runCtx);
      const durationMs = Date.now() - started;
      const result: StepResult = {
        platform: step.adapter.id,
        platformName: step.adapter.name,
        postId: step.post.id,
        title: step.prepared.title,
        ok: outcome.ok,
        url: outcome.url,
        detail: outcome.detail,
        error: outcome.error,
        durationMs,
      };
      results.push(result);
      await appendHistory(ctx.historyPath, {
        platform: step.adapter.id,
        ok: outcome.ok,
        postId: step.post.id,
        title: step.prepared.title,
        source: step.post.source,
        url: outcome.url,
        error: outcome.error,
        durationMs,
      });
      if (outcome.ok) {
        ui.ok(`${label} ✓${outcome.url ? " " + outcome.url : ""}${outcome.detail ? " " + ui.dim(outcome.detail) : ""}`);
      } else {
        failedPlatforms.add(step.adapter.id);
        ui.fail(`${label} 失败：${outcome.error ?? "未知错误"}`);
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
  }

  printSummary(ctx, results);
  emitJson(ctx, {
    ok: results.every((r) => r.ok) && results.length === steps.length,
    dryRun: false,
    results,
  });

  if (results.length === 0) return EXIT.ok;
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === results.length) return EXIT.ok;
  if (okCount === 0) return EXIT.error;
  return EXIT.partial;
}

function describeStep(step: Step, window: string) {
  return {
    platform: step.adapter.id,
    post: step.post.source,
    title: step.prepared.title,
    textLength: [...step.prepared.text].length,
    images: step.prepared.images.length,
    commands: step.prepared.plan.map((a) => ["opencli", ...decorateForDisplay(a, window)].join(" ")),
    notes: step.prepared.notes,
  };
}

async function checkAuth(adapter: PlatformAdapter, ctx: CliContext): Promise<AuthState> {
  const runCtx: RunContext = {
    config: ctx.config,
    ui: ctx.ui,
    dryRun: ctx.dryRun,
    run: ctx.run,
    options: { thread: false, draft: false, allowTruncate: false, force: ctx.force },
  };
  if (adapter.checkAuth) return adapter.checkAuth(runCtx);
  if (!adapter.site) return { loggedIn: true, detail: "自定义 route（跳过登录检查）" };
  const res = await callOpencli(ctx.run, [adapter.site, "whoami", "-f", "json"], {
    binary: ctx.config.opencli.binary,
    timeoutMs: Math.min(ctx.config.opencli.timeoutMs, 60_000),
    window: ctx.config.opencli.window,
    onInvoke: (args) => ctx.ui.detail("opencli " + args.join(" ")),
  });
  if (res.ok) {
    const row = res.rows.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
    const username = row && typeof row.username === "string" ? row.username : undefined;
    return { loggedIn: true, username };
  }
  return { loggedIn: false, detail: res.error?.message ?? "whoami 失败" };
}

async function ensureCovers(ctx: CliContext, posts: Post[], adapters: PlatformAdapter[]): Promise<void> {
  const { ui, config, flags } = ctx;
  const coverFlag = (flags.str("cover") ?? "auto").trim();
  if (coverFlag === "none" || !config.cover.enabled) return;
  const needsImage = adapters.some((a) => a.capabilities.images > 0);
  if (!needsImage) return;

  for (const post of posts) {
    if (post.images.length > 0) continue;
    if (coverFlag !== "auto") {
      post.images = [isAbsolute(coverFlag) ? coverFlag : resolve(ctx.cwd, coverFlag)];
      continue;
    }
    if (config.cover.renderer === "card") continue;
    const title = post.title ?? post.body.split("\n").map((l) => l.trim()).find(Boolean) ?? post.id;
    const bodyExcerpt = post.body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== title)
      .join(" ")
      .slice(0, 46)
      .replace(/[。，、；：！？,.!?;:\s]+$/, "");
    const cover = await generateCover(
      ctx.run,
      {
        title: title.slice(0, 60),
        subtitle: bodyExcerpt || (post.topics.length > 0 ? post.topics.map((t) => "#" + t).join("  ") : "publish"),
        style: config.cover.style,
        scale: config.cover.scale,
        width: config.cover.width,
        height: config.cover.height,
        python: config.cover.python,
      },
      Math.min(config.opencli.timeoutMs, 90_000),
    );
    if (cover) {
      post.images = [cover.path];
      ui.info(
        `  ${ui.dim("封面")} ${cover.path}${cover.cached ? ui.dim("（缓存）") : ""} ${ui.dim(`[${config.cover.style} × ${config.cover.scale}]`)}`,
      );
    } else {
      ui.warn("封面生成失败，将退化为平台自带的文字卡片");
    }
  }
}

function printPlan(ctx: CliContext, steps: Step[]): void {
  const { ui } = ctx;
  ui.head("发布计划");
  ui.table(
    ["#", "平台", "内容", "标题", "字数", "图片", "备注"],
    steps.map((s, i) => [
      String(i + 1),
      s.adapter.name,
      s.post.source === "-c" ? "(命令行)" : s.post.source.split("/").pop() ?? s.post.source,
      s.prepared.title ? truncateDisplay(s.prepared.title, 24) : "—",
      String([...s.prepared.text].length),
      s.prepared.images.length > 0 ? String(s.prepared.images.length) : "—",
      [...s.prepared.notes, ...s.prepared.warnings].join("；") || "",
    ]),
  );
}

function printSummary(ctx: CliContext, results: StepResult[]): void {
  const { ui } = ctx;
  if (results.length === 0) return;
  ui.head("结果");
  ui.table(
    ["平台", "标题", "状态", "耗时", "链接"],
    results.map((r) => [
      r.platformName,
      truncateDisplay(r.title ?? r.postId, 22),
      r.ok ? "✔ 成功" : "✖ 失败",
      (r.durationMs / 1000).toFixed(1) + "s",
      r.url ?? (r.error ? truncateDisplay(r.error, 40) : "—"),
    ]),
  );
  const ok = results.filter((r) => r.ok).length;
  ui.info(`\n共 ${results.length} 次，成功 ${ok}，失败 ${results.length - ok}`);
}

function emitJson(ctx: CliContext, payload: unknown): void {
  if (!ctx.ui.json) return;
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}
