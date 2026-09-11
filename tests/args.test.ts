import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  test("默认命令是 publish；正文里出现 history 不会被误判", () => {
    const p = parseArgs(["-c", "history", "-to", "xhs"]);
    expect(p.command).toBe("publish");
    expect(p.flags.str("content")).toBe("history");
    expect(p.flags.list("platform")).toEqual(["xhs"]);
  });

  test("子命令只认 argv[0]", () => {
    expect(parseArgs(["platforms"]).command).toBe("platforms");
    const routes = parseArgs(["routes", "init", "weibo"]);
    expect(routes.command).toBe("routes");
    expect(routes.rest).toEqual(["init", "weibo"]);
    expect(parseArgs(["pub", "-c", "hi", "-to", "x"]).command).toBe("publish");
  });

  test("-to 可重复、支持逗号与中文别名", () => {
    const p = parseArgs(["-to", "zhihu,x", "-to", "小红书"]);
    expect(p.flags.list("platform")).toEqual(["zhihu", "x", "小红书"]);
  });

  test("支持 --x=y、-c=y、-cx 三种写法", () => {
    expect(parseArgs(["--content=你好", "-to=x"]).flags.str("content")).toBe("你好");
    expect(parseArgs(["-c=你好"]).flags.str("content")).toBe("你好");
    expect(parseArgs(["-c你好"]).flags.str("content")).toBe("你好");
    expect(parseArgs(["-c", "a", "-c", "b"]).flags.all("content")).toEqual(["a", "b"]);
  });

  test("多字符短选项 -to 不会被拆成 -t o", () => {
    const p = parseArgs(["-to", "zhihu"]);
    expect(p.flags.list("platform")).toEqual(["zhihu"]);
    expect(p.flags.has("title")).toBe(false);
  });

  test("组合布尔与否定形式", () => {
    const p = parseArgs(["-vy", "--no-color", "--no-guard"]);
    expect(p.flags.bool("verbose")).toBe(true);
    expect(p.flags.bool("yes")).toBe(true);
    expect(p.flags.bool("no-color")).toBe(true);
    expect(p.flags.bool("no-guard")).toBe(true);
    // 通用取反：--no-draft => draft=false
    const q = parseArgs(["--no-draft", "--draft"]);
    expect(q.flags.bool("draft")).toBe(true);
    const r = parseArgs(["--draft", "--no-draft"]);
    expect(r.flags.bool("draft")).toBe(false);
  });

  test("-- 之后当成位置参数", () => {
    const p = parseArgs(["explore", "--", "-weird-url"]);
    expect(p.rest).toEqual(["-weird-url"]);
  });

  test("未知参数被收集", () => {
    expect(parseArgs(["--nope", "-to", "x"]).unknown).toEqual(["--nope"]);
  });

  test("数字参数非法时报错", () => {
    const p = parseArgs(["--max-per-day", "abc"]);
    expect(() => p.flags.num("max-per-day")).toThrow();
  });
});
