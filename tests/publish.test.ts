import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { runPublish } from "../src/cli/commands/publish.ts";
import { EXIT } from "../src/core/errors.ts";
import { readHistory } from "../src/core/risk.ts";
import { authFail, fakeRunner, makeContext, ok } from "./helpers.ts";

describe("publish 全链路（假 opencli）", () => {
  test("--dry-run 只出计划，不调用任何写操作", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "今天想说的一句话", "-to", "xhs,x", "--dry-run"], run: runner.run });
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.ok);
    expect(runner.args()).toHaveLength(0);
  });

  test("一条内容发到小红书 + X：串行执行并写入历史", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "AI Agent 不是工具，而是同事。", "-to", "xhs,x"], run: runner.run });
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.ok);
    const joined = runner.args().map((a) => a.join(" "));
    expect(joined.some((j) => j.startsWith("xiaohongshu publish"))).toBe(true);
    expect(joined.some((j) => j.startsWith("twitter post"))).toBe(true);
    expect(joined.filter((j) => j.includes("whoami"))).toHaveLength(2);
    const history = await readHistory(ctx.historyPath);
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.ok)).toBe(true);
    expect(history.map((h) => h.platform).sort()).toEqual(["twitter", "xiaohongshu"]);
  });

  test("组合平台支持逗号与重复 -to", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "观点", "-to", "xhs", "-to", "x"], run: runner.run });
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.ok);
    expect((await readHistory(ctx.historyPath)).map((h) => h.platform).sort()).toEqual(["twitter", "xiaohongshu"]);
  });

  test("多篇内容 × 多平台 = 逐个串行发布", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "第一篇", "-c", "第二篇", "-to", "xhs,x"], run: runner.run });
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.ok);
    expect(await readHistory(ctx.historyPath)).toHaveLength(4);
  });

  test("风控护栏：同平台刚发过会被拦下", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "观点", "-to", "xhs"], run: runner.run });
    writeFileSync(
      ctx.historyPath,
      JSON.stringify({ ts: new Date().toISOString(), platform: "xiaohongshu", ok: true, postId: "p", source: "-c" }) + "\n",
    );
    await expect(runPublish(ctx)).rejects.toThrow("发布频率超过安全阈值");
    expect(runner.args().some((a) => a[0] === "xiaohongshu" && a[1] === "publish")).toBe(false);
  });

  test("--force 可以跳过护栏", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "观点", "-to", "xhs", "--force"], run: runner.run });
    ctx.force = true;
    writeFileSync(
      ctx.historyPath,
      JSON.stringify({ ts: new Date().toISOString(), platform: "xiaohongshu", ok: true, postId: "p", source: "-c" }) + "\n",
    );
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.ok);
    expect(runner.args().some((a) => a[0] === "xiaohongshu" && a[1] === "publish")).toBe(true);
  });

  test("未知平台给出已注册列表", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "观点", "-to", "douyin"], run: runner.run });
    await expect(runPublish(ctx)).rejects.toThrow(/未知平台/);
  });

  test("没有内容时报错", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-to", "xhs"], run: runner.run });
    await expect(runPublish(ctx)).rejects.toThrow(/没有可发布的内容/);
  });

  test("X 超长且没开 --thread 时返回 usage 退出码", async () => {
    const runner = fakeRunner();
    const ctx = makeContext({ argv: ["-c", "这".repeat(200), "-to", "x"], run: runner.run });
    const code = await runPublish(ctx);
    expect(code).toBe(EXIT.usage);
    expect(runner.args().some((a) => a[1] === "post")).toBe(false);
  });

  test("未登录时抛出 AUTH_REQUIRED", async () => {
    const runner = fakeRunner((cmd) => (cmd[2] === "whoami" ? authFail("cookie 缺失") : undefined));
    const ctx = makeContext({ argv: ["-c", "观点", "-to", "xhs"], run: runner.run });
    await expect(runPublish(ctx)).rejects.toThrow(/未登录/);
  });

  test("某个平台失败不影响其它平台，但会停止对该平台继续发布", async () => {
    let publishCount = 0;
    const runner = fakeRunner((cmd) => {
      if (cmd[0] === "opencli" && cmd[1] === "xiaohongshu" && cmd[2] === "publish") {
        publishCount += 1;
        return { code: 1, stderr: "creator center 报错" };
      }
      if (cmd[1] === "twitter" && cmd[2] === "post") return ok([{ status: "success", url: "https://x.com/i/status/1" }]);
      return undefined;
    });
    const ctx = makeContext({ argv: ["-c", "第一篇", "-c", "第二篇", "-to", "xhs,x"], run: runner.run });
    const code = await runPublish(ctx);
    expect(publishCount).toBe(1);
    expect(code).toBe(EXIT.partial);
    const history = await readHistory(ctx.historyPath);
    expect(history.filter((h) => h.platform === "twitter" && h.ok)).toHaveLength(2);
    expect(history.filter((h) => h.platform === "xiaohongshu" && !h.ok)).toHaveLength(1);
  });
});
