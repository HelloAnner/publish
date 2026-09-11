/** 各平台适配器共用的准备逻辑。 */

import { statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { PlatformCapabilities, PublishConfig, Runner } from "../core/types.ts";
import { uniq } from "../core/util.ts";

/** 按平台规则计算正文长度。 */
export function textLength(text: string, caps: Pick<PlatformCapabilities, "lengthMode" | "urlWeight">): number {
  if (caps.lengthMode === "chars") return [...text].length;
  let urls = 0;
  const rest = caps.urlWeight
    ? text.replace(/https?:\/\/\S+/g, () => {
        urls += 1;
        return "";
      })
    : text;
  let weight = urls * (caps.urlWeight ?? 0);
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff);
    weight += wide ? 2 : 1;
  }
  return weight;
}

/** 把话题拼成 hashtag 后缀。 */
export function hashtagSuffix(topics: string[], opts: { limit?: number; already?: string } = {}): string {
  const existing = opts.already ?? "";
  const picked = topics
    .map((t) => t.replace(/^#+/, "").replace(/\s+/g, ""))
    .filter((t) => t && !existing.includes("#" + t))
    .slice(0, opts.limit ?? 5);
  if (picked.length === 0) return "";
  return "\n\n" + picked.map((t) => "#" + t).join(" ");
}

export function appendHashtags(body: string, topics: string[], limit = 5): string {
  return body + hashtagSuffix(topics, { limit, already: body });
}

export function limitImages(images: string[], cap: number, warnings: string[]): string[] {
  if (cap <= 0) {
    if (images.length > 0) warnings.push(`该平台不支持图片，已忽略 ${images.length} 张`);
    return [];
  }
  const list = uniq(images);
  if (list.length > cap) {
    warnings.push(`图片超过上限 ${cap} 张，仅使用前 ${cap} 张`);
  }
  return list.slice(0, cap);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

/** 图片体积检查（opencli 的浏览器桥对 base64 载荷敏感）。 */
export function inspectImageSizes(images: string[], config: PublishConfig, warnings: string[]): void {
  for (const img of images) {
    let size = 0;
    try {
      size = statSync(img).size;
    } catch {
      continue;
    }
    if (size > config.images.maxBytesPerImage) {
      warnings.push(
        `${basename(img)} 体积 ${humanSize(size)} 偏大，浏览器桥可能失败；建议压缩：sips -Z 1600 -s format jpeg -s formatOptions 72 "${img}" --out ${img.replace(/\.[^.]+$/, "")}.jpg`,
      );
    }
  }
}

export function isSupportedImage(path: string): boolean {
  return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extname(path).toLowerCase());
}

/** macOS 上用 sips 压缩超大图片；失败则原样返回。 */
export async function maybeCompressImages(
  images: string[],
  config: PublishConfig,
  run: Runner,
  warnings: string[],
): Promise<string[]> {
  if (!config.images.autoCompress) return images;
  const out: string[] = [];
  for (const img of images) {
    let size = 0;
    try {
      size = statSync(img).size;
    } catch {
      out.push(img);
      continue;
    }
    if (size <= config.images.autoCompressOverBytes) {
      out.push(img);
      continue;
    }
    const target = img.replace(/\.[^.]+$/, "") + ".compressed.jpg";
    const res = await run(["sips", "-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "72", img, "--out", target], {
      timeoutMs: 60_000,
    });
    if (res.code === 0 && statSync(target, { throwIfNoEntry: false })?.isFile()) {
      warnings.push(`已自动压缩 ${basename(img)}（${humanSize(size)}）`);
      out.push(target);
    } else {
      out.push(img);
    }
  }
  return out;
}

export function truncateTo(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

/**
 * 按加权长度切分长文本（用于 X 线程）。
 * 依次在「空行 → 换行 → 句号 → 空格 → 硬切」处断开。
 */
export function splitByWeight(text: string, limit: number, weightOf: (s: string) => number): string[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const hardSplit = (piece: string) => {
    const chars = [...piece];
    let buf = "";
    for (const ch of chars) {
      if (weightOf(buf + ch) > limit) {
        if (buf) chunks.push(buf.trim());
        buf = ch;
      } else {
        buf += ch;
      }
    }
    current = buf;
  };

  for (const block of blocks) {
    const candidate = current ? current + "\n\n" + block : block;
    if (weightOf(candidate) <= limit) {
      current = candidate;
      continue;
    }
    push();
    if (weightOf(block) <= limit) {
      current = block;
      continue;
    }
    // 段落本身超长：先按句子切
    const sentences = block.match(/[^。！？.!?\n]+[。！？.!?]?/g) ?? [block];
    for (const sentence of sentences) {
      const c2 = current ? current + sentence : sentence;
      if (weightOf(c2) <= limit) {
        current = c2;
        continue;
      }
      push();
      if (weightOf(sentence) <= limit) current = sentence;
      else hardSplit(sentence);
    }
  }
  push();
  return chunks;
}
