import { describe, expect, test } from "bun:test";
import { createTwitterAdapter } from "../src/adapters/twitter.ts";
import { buildPublishArgs, createXiaohongshuAdapter, deriveTitle, joinCardText, splitIntoCards } from "../src/adapters/xiaohongshu.ts";
import { createZhihuAdapter, extractQuestionId, findQuestion, toZhihuPayload } from "../src/adapters/zhihu.ts";
import type { Post, PrepareContext, PublishRunOptions, RunContext } from "../src/core/types.ts";
import { UI } from "../src/core/ui.ts";
import { fakeRunner, testConfig } from "./helpers.ts";

const ui = new UI({ quiet: true, color: false, sink: () => {} });

function post(over: Partial<Post> = {}): Post {
  return { id: "1-test", body: "正文", topics: [], images: [], source: "-c", overrides: {}, ...over };
}

function ctx(run = fakeRunner().run, options: Partial<PublishRunOptions> = {}): PrepareContext {
  return {
    config: testConfig(),
    ui,
    dryRun: false,
    run,
    options: { thread: false, draft: false, allowTruncate: false, force: false, longform: "off", ...options } as PublishRunOptions,
  };
}

describe("X / Twitter 适配器", () => {
  test("没有独立标题字段时把标题并进正文", async () => {
    const prepared = await createTwitterAdapter().prepare(post({ title: "我的标题", body: "正文内容" }), ctx());
    expect(prepared.text.startsWith("我的标题")).toBe(true);
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.plan).toHaveLength(1);
    expect(prepared.args[0]).toBe("twitter");
    expect(prepared.args[1]).toBe("post");
  });

  test("超过 280 加权字数且没开 --thread 时报错（CJK 记 2）", async () => {
    const long = "这".repeat(200);
    const prepared = await createTwitterAdapter().prepare(post({ body: long }), ctx());
    expect(prepared.errors.length).toBe(1);
    expect(prepared.errors[0]).toContain("280");
  });

  test("开了 --thread 会拆成 post + reply 序列", async () => {
    const long = "第一段内容。".repeat(40) + "\n\n第二段内容。" + "很".repeat(150);
    const prepared = await createTwitterAdapter().prepare(post({ body: long }), ctx(fakeRunner().run, { thread: true }));
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.plan.length).toBeGreaterThan(1);
    expect(prepared.plan[0]![1]).toBe("post");
    expect(prepared.plan[1]![1]).toBe("reply");
  });

  test("话题会补成 hashtag，图片上限 4 张", async () => {
    const prepared = await createTwitterAdapter().prepare(
      post({ body: "正文", topics: ["AI", "#Agent"] }),
      ctx(),
    );
    expect(prepared.text).toContain("#AI");
    expect(prepared.text).toContain("#Agent");
    expect(prepared.text.match(/#AI/g)).toHaveLength(1);
  });

  test("线程模式下逐条 reply 并返回首条 URL", async () => {
    const runner = fakeRunner();
    const adapter = createTwitterAdapter();
    const prepared = await adapter.prepare(
      post({ body: "第一段。".repeat(30) + "\n\n" + "第二段。".repeat(30) }),
      ctx(runner.run, { thread: true }),
    );
    const runCtx: RunContext = { ...ctx(runner.run, { thread: true }) };
    const outcome = await adapter.publish(prepared, runCtx);
    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe("https://x.com/i/status/111");
    const subs = runner.args().map((a) => a[1]);
    expect(subs.filter((s) => s === "post")).toHaveLength(1);
    expect(subs.filter((s) => s === "reply").length).toBeGreaterThanOrEqual(1);
  });
});

describe("小红书适配器", () => {
  test("deriveTitle 优先标题字段，其次首行", () => {
    expect(deriveTitle(post({ title: "显式标题" }))).toBe("显式标题");
    expect(deriveTitle(post({ body: "# 井号标题\n\n正文" }))).toBe("井号标题");
  });

  test("标题超过 20 字会被截断并告警", async () => {
    const prepared = await createXiaohongshuAdapter().prepare(
      post({ title: "这是一个特别特别长的标题超过二十个字了真的很长很长" }),
      ctx(),
    );
    expect([...prepared.title!].length).toBeLessThanOrEqual(20);
    expect(prepared.warnings.some((w) => w.includes("20"))).toBe(true);
  });

  test("没有配图时改用 --card-text 文字配图", async () => {
    const prepared = await createXiaohongshuAdapter().prepare(post({ title: "标题", body: "正文" }), ctx());
    const joined = prepared.args.join(" ");
    expect(joined).toContain("--card-text");
    expect(joined).not.toContain("--images");
    expect(prepared.notes.join()).toContain("文字配图");
  });

  test("有配图走 --images，--draft 会带上", async () => {
    const args = buildPublishArgs({ body: "正文", title: "标题", images: ["/tmp/a.png", "/tmp/b.png"], topics: ["生活"], draft: true });
    expect(args.join(" ")).toContain("--images /tmp/a.png,/tmp/b.png");
    expect(args).toContain("--draft");
    expect(args.join(" ")).toContain("--topics 生活");
  });

  test("正文超 1000 字默认报错，--allow-truncate 才截断", async () => {
    const body = "字".repeat(1200);
    const strict = await createXiaohongshuAdapter().prepare(post({ title: "标题", body }), ctx());
    expect(strict.errors.length).toBe(1);
    const lenient = await createXiaohongshuAdapter().prepare(post({ title: "标题", body }), ctx(fakeRunner().run, { allowTruncate: true }));
    expect(lenient.errors).toHaveLength(0);
    expect([...lenient.text].length).toBeLessThanOrEqual(1000);
  });

  test("文字配图用 cover.cardStyle，而不是封面渲染样式", async () => {
    const withStyles = ctx();
    withStyles.config = testConfig((c) => {
      c.cover.style = "纸感";
      c.cover.cardStyle = "科技";
    });
    const prepared = await createXiaohongshuAdapter().prepare(post({ title: "标题", body: "正文" }), withStyles);
    const joined = prepared.args.join(" ");
    expect(joined).toContain("--card-style 科技");
    expect(joined).not.toContain("纸感");
  });

  test("超长正文 + --xhs-longform cards 会切成多张文字卡片", async () => {
    const body = "这是段落。".repeat(400); // 2000 字
    const prepared = await createXiaohongshuAdapter().prepare(
      post({ title: "标题", body }),
      ctx(fakeRunner().run, { longform: "cards" }),
    );
    expect(prepared.errors).toHaveLength(0);
    const joined = prepared.args.join(" ");
    expect(joined).toContain("--card-text");
    expect(joined).toContain("|||");
    expect(prepared.notes.join()).toContain("文字卡片");
    expect([...prepared.text].length).toBeLessThanOrEqual(1000);
  });

  test("默认超长仍报错，并给出三条出路", async () => {
    const prepared = await createXiaohongshuAdapter().prepare(post({ title: "标题", body: "字".repeat(1200) }), ctx());
    expect(prepared.errors).toHaveLength(1);
    expect(prepared.errors[0]).toContain("--xhs-longform cards");
    expect(prepared.errors[0]).toContain("--allow-truncate");
    expect(prepared.errors[0]).toContain("写长文");
  });

  test("splitIntoCards 卡在 9 张以内，换行转义为字面量", () => {
    const cards = splitIntoCards("很长的一段话。".repeat(2000));
    expect(cards.length).toBeLessThanOrEqual(9);
    expect(cards.length).toBeGreaterThan(1);
    const joined = joinCardText(["第一行\n第二行", "第二张"]);
    expect(joined).toBe("第一行\\n第二行|||第二张");
  });

  test("auto 模式只在超长时才切卡片", async () => {
    const adapter = createXiaohongshuAdapter();
    const short = await adapter.prepare(post({ title: "标题", body: "短正文" }), ctx(fakeRunner().run, { longform: "auto" }));
    expect(short.args.join(" ")).not.toContain("|||");
    const long = await adapter.prepare(
      post({ title: "标题", body: "这是段落。".repeat(400) }),
      ctx(fakeRunner().run, { longform: "auto" }),
    );
    expect(long.args.join(" ")).toContain("|||");
  });

  test("没有标题会报错", async () => {
    const prepared = await createXiaohongshuAdapter().prepare(post({ body: "" }), ctx());
    expect(prepared.errors.length).toBeGreaterThan(0);
  });
});

describe("知乎适配器", () => {
  test("extractQuestionId 支持 URL / typed / 纯数字", () => {
    expect(extractQuestionId("https://www.zhihu.com/question/123456")).toBe("123456");
    expect(extractQuestionId("question:98765")).toBe("98765");
    expect(extractQuestionId("12345678")).toBe("12345678");
    expect(extractQuestionId("随便一段话")).toBeUndefined();
  });

  test("findQuestion 能从搜索结果里挖出问题", () => {
    const found = findQuestion([
      { rank: 1, title: "AI 会取代程序员吗？", type: "question", url: "https://www.zhihu.com/question/456" },
    ]);
    expect(found.id).toBe("456");
    expect(found.title).toBe("AI 会取代程序员吗？");
  });

  test("纯文本会转成 HTML 段落，已是 HTML 则原样保留", () => {
    expect(toZhihuPayload("第一段\n\n第二段").payload).toBe("<p>第一段</p><p>第二段</p>");
    expect(toZhihuPayload("<p>已有</p>").payload).toBe("<p>已有</p>");
    expect(toZhihuPayload("段落内换行\n下一行").converted).toBe(true);
  });

  test("显式 target 直接用，不带搜索调用", async () => {
    const runner = fakeRunner();
    const prepared = await createZhihuAdapter().prepare(
      post({ body: "我的观点", target: "https://www.zhihu.com/question/123456" }),
      ctx(runner.run),
    );
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.args[2]).toBe("question:123456");
    expect(prepared.args).toContain("--execute");
    expect(runner.args().some((a) => a[1] === "search")).toBe(false);
  });

  test("没有 target 时会自动搜索匹配并给出提醒", async () => {
    const runner = fakeRunner();
    const prepared = await createZhihuAdapter().prepare(post({ body: "AI Agent 会重构软件行业吗？" }), ctx(runner.run));
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.args[2]).toBe("question:123456");
    expect(prepared.notes.join()).toContain("自动匹配");
    expect(runner.args().some((a) => a[1] === "search")).toBe(true);
  });

  test("搜索失败（未登录）时给出登录提示", async () => {
    const { authFail } = await import("./helpers.ts");
    const runner = fakeRunner((cmd) => (cmd[1] === "zhihu" && cmd[2] === "search" ? authFail() : undefined));
    const prepared = await createZhihuAdapter().prepare(post({ body: "随便" }), ctx(runner.run));
    expect(prepared.errors[0]).toContain("publish login -to zhihu");
  });
});
