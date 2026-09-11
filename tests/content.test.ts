import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractHeading, loadPosts, parseTargetSpecs, splitFrontMatter } from "../src/core/content.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "publish-content-"));
}

describe("front-matter", () => {
  test("解析 YAML front-matter", () => {
    const { body, meta } = splitFrontMatter("---\ntitle: 标题\ntopics: [a, b]\n---\n正文");
    expect(meta.title).toBe("标题");
    expect(meta.topics).toEqual(["a", "b"]);
    expect(body.trim()).toBe("正文");
  });

  test("没有 front-matter 时原样返回", () => {
    const { body, meta } = splitFrontMatter("就是正文");
    expect(meta).toEqual({});
    expect(body).toBe("就是正文");
  });

  test("# 标题行会被抽出来并保留顺序", () => {
    const r = extractHeading("先来一句\n\n# 我的标题\n\n正文");
    expect(r.title).toBeUndefined();
    const r2 = extractHeading("# 我的标题\n\n正文");
    expect(r2.title).toBe("我的标题");
    expect(r2.body.trim()).toBe("正文");
  });
});

describe("loadPosts", () => {
  test("-c 单条", async () => {
    const r = await loadPosts({ contents: ["今天想说的观点"], files: [], topics: [], images: [], combine: false, cwd: tmp() });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.body).toBe("今天想说的观点");
  });

  test("多个 -c 默认是多篇，--combine 合并成一篇", async () => {
    const cwd = tmp();
    const base = { contents: ["第一条", "第二条"], files: [], topics: [], images: [], cwd };
    expect((await loadPosts({ ...base, combine: false })).posts).toHaveLength(2);
    const merged = await loadPosts({ ...base, combine: true });
    expect(merged.posts).toHaveLength(1);
    expect(merged.posts[0]!.body).toContain("第一条");
    expect(merged.posts[0]!.body).toContain("第二条");
  });

  test("从文件读 front-matter，命令行 --title 只对单篇生效", async () => {
    const cwd = tmp();
    const file = join(cwd, "note.md");
    writeFileSync(file, "---\ntitle: 文件标题\ntopics: 效率,思考\n---\n# 正文里的标题\n\n内容正文");
    const r = await loadPosts({ contents: [], files: ["note.md"], topics: ["额外"], images: [], combine: false, cwd });
    expect(r.posts[0]!.title).toBe("文件标题");
    expect(r.posts[0]!.topics).toEqual(["效率", "思考", "额外"]);
    expect(r.posts[0]!.body).not.toContain("正文里的标题");

    const withCli = await loadPosts({ contents: [], files: ["note.md"], title: "命令行标题", topics: [], images: [], combine: false, cwd });
    expect(withCli.posts[0]!.title).toBe("命令行标题");
  });

  test("glob 展开与不存在文件告警", async () => {
    const cwd = tmp();
    writeFileSync(join(cwd, "a.md"), "AAA");
    writeFileSync(join(cwd, "b.md"), "BBB");
    const r = await loadPosts({ contents: [], files: ["*.md", "missing.md"], topics: [], images: [], combine: false, cwd });
    expect(r.posts.map((p) => p.body).sort()).toEqual(["AAA", "BBB"]);
    expect(r.warnings.some((w) => w.includes("missing.md"))).toBe(true);
  });

  test("空内容被跳过", async () => {
    const r = await loadPosts({ contents: ["   "], files: [], topics: [], images: [], combine: false, cwd: tmp() });
    expect(r.posts).toHaveLength(0);
  });

  test("parseTargetSpecs 支持 key=value 与裸 URL", () => {
    const m1 = parseTargetSpecs(["zhihu=question:1"], ["zhihu", "x"]);
    expect(m1.get("zhihu")).toBe("question:1");
    const m2 = parseTargetSpecs(["https://www.zhihu.com/question/9"], ["zhihu"]);
    expect(m2.get("zhihu")).toBe("https://www.zhihu.com/question/9");
  });
});
