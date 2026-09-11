/** 内容装载：-c / -f / stdin / glob / front-matter → Post[]。 */

import { statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { Post } from "./types.ts";
import { splitList, uniq } from "./util.ts";
import { parseStructured } from "./yaml.ts";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

export interface LoadPostsOptions {
  contents: string[];
  files: string[];
  title?: string;
  topics: string[];
  images: string[];
  target?: string;
  combine: boolean;
  cwd: string;
  /** 便于测试注入；默认读 Bun.stdin。 */
  stdinText?: string;
}

export interface LoadPostsResult {
  posts: Post[];
  warnings: string[];
}

interface RawPost {
  raw: string;
  source: string;
}

/**
 * 判断 stdin 里是否真的有数据。
 * Bun.stdin.size 在管道有数据时是有限数字，在 /dev/null 或终端继承 stdin 时是 Infinity，
 * 因此可以安全地自动读取管道输入而不会在交互场景卡住。
 */
export function stdinHasData(): boolean {
  const size = (Bun.stdin as { size?: number }).size;
  return typeof size === "number" && Number.isFinite(size) && size > 0;
}

export function expandInputs(files: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f === "-") {
      out.push(f);
      continue;
    }
    if (/[*?[\]{}]/.test(f)) {
      const glob = new Bun.Glob(f);
      const matched: string[] = [];
      for (const m of glob.scanSync({ cwd, dot: false })) matched.push(m);
      if (matched.length === 0) out.push(f);
      else out.push(...matched.sort());
      continue;
    }
    out.push(f);
  }
  return out;
}

/** 拆分 front-matter（--- 包裹的 YAML/JSON）。 */
export function splitFrontMatter(raw: string): { body: string; meta: Record<string, unknown> } {
  const text = raw.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(text);
  if (!m) return { body: text, meta: {} };
  let meta: Record<string, unknown> = {};
  try {
    const parsed = parseStructured(m[1]!, "front-matter");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return { body: text.slice(m[0].length), meta };
}

function toStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return splitList(v);
  return [];
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** 从正文里取出用作标题的首个 # 标题行。 */
export function extractHeading(body: string): { title?: string; body: string } {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) {
      const next = [...lines.slice(0, i), ...lines.slice(i + 1)];
      return { title: m[1]!.trim(), body: next.join("\n") };
    }
    return { body };
  }
  return { body };
}

function resolveImages(images: string[], cwd: string, warnings: string[]): string[] {
  const out: string[] = [];
  for (const img of images) {
    const abs = isAbsolute(img) ? img : resolve(cwd, img);
    if (!IMAGE_EXT.has(extname(abs).toLowerCase())) {
      warnings.push(`忽略不支持的图片格式：${img}`);
      continue;
    }
    if (!existsSyncSafe(abs)) {
      warnings.push(`图片不存在，已忽略：${abs}`);
      continue;
    }
    out.push(abs);
  }
  return uniq(out);
}

function existsSyncSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function slugOf(source: string, title: string | undefined, index: number): string {
  const base = title ? title.slice(0, 24) : basename(source).replace(/\.[^.]+$/, "");
  return `${index + 1}-${base}`.slice(0, 40);
}

export async function loadPosts(opts: LoadPostsOptions): Promise<LoadPostsResult> {
  const warnings: string[] = [];
  const cwd = opts.cwd;
  const raws: RawPost[] = [];

  for (const text of opts.contents) raws.push({ raw: text, source: "-c" });
  const files = expandInputs(opts.files, cwd);
  for (const f of files) {
    if (f === "-") {
      const stdin = opts.stdinText ?? (await Bun.stdin.text());
      raws.push({ raw: stdin, source: "<stdin>" });
      continue;
    }
    const abs = isAbsolute(f) ? f : resolve(cwd, f);
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      warnings.push(`文件不存在，已跳过：${f}`);
      continue;
    }
    raws.push({ raw: await file.text(), source: abs });
  }

  if (raws.length === 0) return { posts: [], warnings };

  const cliImages = resolveImages(opts.images, cwd, warnings);
  const cliTopics = uniq(opts.topics.map((t) => t.replace(/^#+/, "").trim()).filter(Boolean));
  const single = raws.length === 1;

  const posts: Post[] = [];
  if (opts.combine && raws.length > 1) {
    const merged = mergeRawPosts(raws);
    posts.push(
      buildPost(merged, {
        index: 0,
        cwd,
        warnings,
        cliTitle: opts.title,
        cliTopics,
        cliImages,
        cliTarget: opts.target,
        forceCliTitle: true,
      }),
    );
  } else {
    if (opts.title && !single) {
      warnings.push("--title 只对单篇生效；多篇请用每篇文件里的 front-matter title");
    }
    raws.forEach((raw, index) => {
      posts.push(
        buildPost(raw, {
          index,
          cwd,
          warnings,
          cliTitle: single ? opts.title : undefined,
          cliTopics,
          cliImages,
          cliTarget: opts.target,
          forceCliTitle: single,
        }),
      );
    });
  }

  const kept = posts.filter((p) => p.body.trim().length > 0);
  for (const p of posts) {
    if (!p.body.trim()) warnings.push(`${p.source} 内容为空，已跳过`);
  }
  return { posts: kept, warnings };
}

function mergeRawPosts(raws: RawPost[]): RawPost {
  return {
    raw: raws.map((r) => r.raw).join("\n\n"),
    source: raws.map((r) => basename(r.source)).join("+"),
  };
}

interface BuildOptions {
  index: number;
  cwd: string;
  warnings: string[];
  cliTitle?: string;
  cliTopics: string[];
  cliImages: string[];
  cliTarget?: string;
  forceCliTitle: boolean;
}

function buildPost(raw: RawPost, o: BuildOptions): Post {
  const { body: withoutMeta, meta } = splitFrontMatter(raw.raw);
  const heading = extractHeading(withoutMeta);
  const metaTitle = asString(meta.title);
  const title = (o.forceCliTitle ? o.cliTitle : undefined) ?? metaTitle ?? heading.title;
  const body = heading.title ? heading.body : withoutMeta;
  const metaTopics = toStringList(meta.topics ?? meta.tags);
  const metaImages = toStringList(meta.images);
  const images = o.cliImages.length > 0 ? o.cliImages : resolveImages(metaImages, o.cwd, o.warnings);
  const overrides: Record<string, Record<string, unknown>> = {};
  const platformMeta = meta.platforms;
  if (platformMeta && typeof platformMeta === "object" && !Array.isArray(platformMeta)) {
    for (const [k, v] of Object.entries(platformMeta as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) overrides[k] = v as Record<string, unknown>;
    }
  }
  return {
    id: slugOf(raw.source, title, o.index),
    title: title?.trim() || undefined,
    body: body.replace(/^\s*\n/, "").replace(/\s+$/, ""),
    topics: uniq([...metaTopics.map((t) => t.replace(/^#+/, "")), ...o.cliTopics]),
    images,
    target: o.cliTarget ?? asString(meta.target),
    source: raw.source,
    overrides,
  };
}

/** 解析 --target：既支持 "zhihu=question:1" 也支持裸 URL（单平台时）。 */
export function parseTargetSpecs(specs: string[], platforms: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const bare: string[] = [];
  for (const spec of specs) {
    const eq = spec.indexOf("=");
    if (eq > 0) {
      const key = spec.slice(0, eq).trim();
      const value = spec.slice(eq + 1).trim();
      if (key && value) map.set(key, value);
      continue;
    }
    bare.push(spec.trim());
  }
  if (bare.length > 0) {
    if (platforms.length === 1) map.set(platforms[0]!, bare[bare.length - 1]!);
    else if (bare.length === platforms.length) platforms.forEach((p, i) => map.set(p, bare[i]!));
  }
  return map;
}

export function describedPath(p: string, cwd: string): string {
  const rel = p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p;
  return rel.length <= p.length ? rel : p;
}
