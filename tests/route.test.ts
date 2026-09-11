import { describe, expect, test } from "bun:test";
import {
  buildRouteVars,
  createRouteAdapter,
  evalValue,
  parseRoute,
  renderTemplate,
  stepToAction,
  type RouteDefinition,
} from "../src/adapters/route.ts";
import { createRng } from "../src/core/random.ts";
import { parseStateElements, suggestTarget } from "../src/cli/commands/explore.ts";
import type { Post, RunContext } from "../src/core/types.ts";
import { UI } from "../src/core/ui.ts";
import { fakeRunner, ok, testConfig } from "./helpers.ts";

const ui = new UI({ quiet: true, color: false, sink: () => {} });

function post(over: Partial<Post> = {}): Post {
  return { id: "1-demo", title: "标题", body: "正文内容", topics: ["AI"], images: ["/tmp/a.png"], source: "-c", overrides: {}, ...over };
}

const RAW = {
  id: "demo",
  name: "Demo 站",
  capabilities: { text: true, images: 9 },
  steps: [
    { open: "https://example.com/compose" },
    { wait: { selector: "textarea", timeout: 5000 } },
    { fill: { target: "textarea", text: "{{content}}" } },
    { click: { target: "button.submit" } },
    { expect: { text: "发布成功" } },
  ],
};

function def(): RouteDefinition {
  return parseRoute(RAW, "/tmp/demo.yaml");
}

function runCtx(run = fakeRunner().run): RunContext {
  return {
    config: testConfig(),
    ui,
    dryRun: false,
    run,
    options: { thread: false, draft: false, allowTruncate: false, force: false, longform: "off" },
  };
}

describe("route 定义校验", () => {
  test("缺少 steps 直接报错", () => {
    expect(() => parseRoute({ id: "x" }, "/tmp/x.yaml")).toThrow();
  });

  test("step 有多个动作键时报错", () => {
    expect(() => parseRoute({ id: "x", steps: [{ open: "https://a.com", click: "1" }] }, "/tmp/x.yaml")).toThrow();
  });

  test("未知动作报错", () => {
    expect(() => parseRoute({ id: "x", steps: [{ teleport: 1 }] }, "/tmp/x.yaml")).toThrow();
  });

  test("语义定位（text=发送）在解析阶段就被拦下并给出提示", () => {
    expect(() => parseRoute({ id: "x", steps: [{ click: "text=发送" }] }, "/tmp/x.yaml")).toThrow(/语义定位/);
    expect(() => parseRoute({ id: "x", steps: [{ fill: { target: "label=标题", text: "a" } }] }, "/tmp/x.yaml")).toThrow(
      /语义定位/,
    );
    // 合法写法不应报错
    expect(() => parseRoute({ id: "x", steps: [{ click: "3" }, { click: "button.submit" }] }, "/tmp/x.yaml")).not.toThrow();
  });

  test("模板变量的 target 留到运行时判断", () => {
    const action = stepToAction({ click: { target: "{{image0}}" } }, "s", { image0: ".fab" });
    expect(action.args).toEqual(["browser", "s", "click", ".fab"]);
    expect(() => stepToAction({ click: { target: "{{image0}}" } }, "s", { image0: "text=发送" })).toThrow(/语义定位/);
  });

  test("正常 route 解析出默认能力", () => {
    const d = def();
    expect(d.id).toBe("demo");
    expect(d.steps).toHaveLength(5);
  });
});

describe("模板渲染", () => {
  test("变量替换 + json 过滤器", () => {
    const vars = buildRouteVars(post());
    expect(vars.content).toContain("正文内容");
    expect(vars.content).toContain("#AI");
    expect(vars.image0).toBe("/tmp/a.png");
    expect(renderTemplate("{{title}}/{{body}}", vars)).toBe("标题/正文内容");
    expect(renderTemplate("{{body|json}}", vars)).toBe(JSON.stringify("正文内容"));
    expect(renderTemplate("{{missing}}!", vars)).toBe("!");
  });
});

describe("step → opencli 参数", () => {
  const vars = buildRouteVars(post());

  test("open / eval / click / fill", () => {
    expect(stepToAction({ open: "https://a.com" }, "s", vars).args).toEqual(["browser", "s", "open", "https://a.com"]);
    expect(stepToAction({ eval: "location.href" }, "s", vars).args).toEqual(["browser", "s", "eval", "location.href"]);
    expect(stepToAction({ click: { target: "button.submit" } }, "s", vars).args).toEqual(["browser", "s", "click", "button.submit"]);
    expect(stepToAction({ fill: { target: "textarea", text: "{{body}}" } }, "s", vars).args).toEqual([
      "browser",
      "s",
      "fill",
      "textarea",
      "正文内容",
    ]);
  });

  test("wait / upload / find", () => {
    expect(stepToAction({ wait: { selector: "#a", timeout: 3000 } }, "s", vars).args).toEqual([
      "browser",
      "s",
      "wait",
      "selector",
      "#a",
      "--timeout",
      "3000",
    ]);
    expect(stepToAction({ upload: { target: "input", files: ["/tmp/a.png"] } }, "s", vars).args).toEqual([
      "browser",
      "s",
      "upload",
      "input",
      "/tmp/a.png",
    ]);
    expect(stepToAction({ find: { text: "发布" } }, "s", vars).args).toEqual(["browser", "s", "find", "--text", "发布"]);
  });

  test("pause 落在区间内并叠加人类化抖动（±8%）", () => {
    const rng = createRng(7).rng;
    for (let i = 0; i < 50; i++) {
      const action = stepToAction({ pause: [500, 600] }, "s", vars, rng);
      expect(action.kind).toBe("pause");
      expect(action.pauseMs).toBeGreaterThanOrEqual(Math.round(500 * 0.92));
      expect(action.pauseMs).toBeLessThanOrEqual(Math.round(600 * 1.08));
    }
  });
});

describe("route 适配器执行", () => {
  test("prepare 会渲染出完整命令序列", async () => {
    const adapter = createRouteAdapter(def());
    const prepared = await adapter.prepare(post(), runCtx());
    expect(prepared.errors).toHaveLength(0);
    const rendered = prepared.plan.map((a) => a.join(" ")).join(" | ");
    expect(rendered).toContain("browser publish-demo open https://example.com/compose");
    expect(rendered).toContain("正文内容");
    expect(prepared.vars?.content).toContain("#AI");
  });

  test("publish 串行执行并把当前 URL 作为结果", async () => {
    const runner = fakeRunner((cmd) => {
      if (cmd[1] === "browser" && cmd[3] === "eval") {
        const js = cmd[4] ?? "";
        if (js === "location.href") return ok("https://example.com/posted/1");
        if (js.includes("querySelector")) return ok("true");
        if (js.includes("innerText")) return ok("true");
        return ok("true");
      }
      return ok("{}");
    });
    const adapter = createRouteAdapter(def());
    const ctx = runCtx(runner.run);
    const prepared = await adapter.prepare(post(), ctx);
    const outcome = await adapter.publish(prepared, ctx);
    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe("https://example.com/posted/1");
    const joined = runner.args().map((a) => a.join(" "));
    expect(joined.some((j) => j.includes("fill textarea 正文内容"))).toBe(true);
    expect(joined.some((j) => j.includes("click button.submit"))).toBe(true);
  });

  test("步骤失败时返回真实错误", async () => {
    const runner = fakeRunner((cmd) => (cmd[3] === "click" ? { code: 1, stderr: "找不到元素" } : ok("{}")));
    const adapter = createRouteAdapter(def());
    const ctx = runCtx(runner.run);
    const prepared = await adapter.prepare(post(), ctx);
    const outcome = await adapter.publish(prepared, ctx);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("click");
  });

  test("explore 的建议定位总是合法的（不会给出 text=）", () => {
    const els = parseStateElements(
      [
        "URL: https://x.com/",
        "---",
        "  [1]<a href=https://a.com/x>Learn more</a>",
        "  [2]<button>发送</button>",
        '  [3]<input placeholder="标题" />',
        "---",
      ].join("\n"),
    );
    expect(els.map((e) => e.index)).toEqual([1, 2, 3]);
    for (const el of els) {
      expect(suggestTarget(el)).not.toContain("text=");
    }
    expect(suggestTarget(els[1]!)).toBe("2"); // 没抓到可用属性时退回快照编号
    expect(suggestTarget(els[2]!)).toBe('[placeholder*="标题"]');
  });

  test("evalValue 兼容对象与裸值", () => {
    expect(evalValue({ ok: true, rows: [true], raw: true, exec: { code: 0, stdout: "", stderr: "" } })).toBe(true);
    expect(evalValue({ ok: true, rows: [{ result: "x" }], raw: undefined, exec: { code: 0, stdout: "", stderr: "" } })).toBe("x");
  });
});
