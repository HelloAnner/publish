/** 封面生成：无配图时自动造一张 3:4 卡片，避免小红书因缺少图片而失败。 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { coverCacheDir } from "./paths.ts";
import type { Runner } from "./types.ts";

/** 渲染器版本：改动绘制逻辑时 +1，让旧缓存失效。 */
const COVER_VERSION = 4;

export const COVER_STYLES = ["纸感", "简约", "科技", "光影", "清新", "几何"] as const;

const PY_SCRIPT = String.raw`
import sys, os

def build_font(size, family):
    serif = [
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/System/Library/Fonts/Supplemental/STSong.ttf",
        "/System/Library/Fonts/Supplemental/Kaiti.ttc",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    ]
    sans = [
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    order = (serif + sans) if family == "serif" else (sans + serif)
    for path in order:
        if not os.path.exists(path):
            continue
        indexes = (4, 3, 1, 0) if "Songti" in path else (0, 1, 2)
        for index in indexes:
            try:
                return ImageFont.truetype(path, size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()

# kind: paper = 白底黑字纸感；gradient = 渐变底
# grain = (sigma, blend, shrink)，shrink 越大颗粒越细、文件越小
STYLES = {
    "纸感": dict(kind="paper", bg=(252, 252, 250), fg=(23, 23, 26), sub=(128, 128, 134),
                 rule=(23, 23, 26), family="serif", grain=(9, 0.022, 2), bar=None,
                 title=0.052, subtitle=0.0225, lead=1.68, pad=0.135, wrap=0.72, rule_w=0.09),
    "简约": dict(kind="gradient", bg=(246, 247, 249), fg=(22, 24, 30), sub=(120, 124, 136),
                 rule=(86, 110, 255), family="sans", grain=None, bar=(86, 110, 255),
                 title=0.070, subtitle=0.028, lead=1.46, pad=0.09, wrap=0.84, rule_w=0.12),
    "科技": dict(kind="gradient", bg=(10, 13, 22), fg=(238, 242, 255), sub=(150, 168, 200),
                 rule=(72, 196, 255), family="sans", grain=None, bar=(72, 196, 255),
                 title=0.066, subtitle=0.027, lead=1.5, pad=0.09, wrap=0.84, rule_w=0.12),
    "光影": dict(kind="gradient", bg=(28, 18, 34), fg=(252, 244, 250), sub=(180, 150, 175),
                 rule=(255, 138, 178), family="serif", grain=None, bar=(255, 138, 178),
                 title=0.060, subtitle=0.026, lead=1.6, pad=0.11, wrap=0.78, rule_w=0.10),
    "清新": dict(kind="paper", bg=(240, 248, 243), fg=(22, 44, 34), sub=(96, 132, 112),
                 rule=(40, 160, 110), family="serif", grain=(9, 0.020, 2), bar=None,
                 title=0.056, subtitle=0.024, lead=1.62, pad=0.13, wrap=0.74, rule_w=0.09),
    "几何": dict(kind="flat", bg=(248, 214, 74), fg=(26, 26, 26), sub=(70, 60, 20),
                 rule=(26, 26, 26), family="sans", grain=None, bar=None,
                 title=0.072, subtitle=0.028, lead=1.4, pad=0.10, wrap=0.82, rule_w=0.14),
}

NO_LINE_START = "。，、；：？！）』」》〉”’…·,.!?;:)]}%"

def fix_kinsoku(lines):
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in NO_LINE_START:
            lines[i - 1] = lines[i - 1] + lines[i][0]
            lines[i] = lines[i][1:]
    return [ln for ln in lines if ln]

def wrap(draw, text, font, maxw, maxlines):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if draw.textlength(cur + ch, font=font) <= maxw:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    lines = fix_kinsoku(lines)
    if len(lines) > maxlines:
        lines = lines[:maxlines]
        lines[-1] = lines[-1][:-1] + "…"
    return lines

def render(out, title, sub, style_name, w, h, scale):
    st = STYLES.get(style_name) or STYLES["纸感"]
    img = Image.new("RGB", (w, h), st["bg"])
    if st["kind"] == "gradient":
        d = ImageDraw.Draw(img)
        acc = st["rule"]
        for y in range(h):
            t = y / float(h) * 0.22
            d.line([(0, y), (w, y)], fill=(int(st["bg"][0] + (acc[0] - st["bg"][0]) * t),
                                          int(st["bg"][1] + (acc[1] - st["bg"][1]) * t),
                                          int(st["bg"][2] + (acc[2] - st["bg"][2]) * t)))
    elif st["grain"]:
        sigma, blend, shrink = st["grain"]
        noise = Image.effect_noise((max(1, w // shrink), max(1, h // shrink)), sigma).convert("L")
        if shrink > 1:
            noise = noise.resize((w, h), Image.BICUBIC)
        img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), blend)
    draw = ImageDraw.Draw(img)
    if st["bar"]:
        draw.rectangle([0, 0, w, max(6, int(h * 0.009))], fill=st["bar"])

    pad = int(w * st["pad"])
    maxw = int(w * st["wrap"])
    f_title = build_font(max(20, int(w * st["title"] * scale)), st["family"])
    f_sub = build_font(max(14, int(w * st["subtitle"] * scale)), st["family"])

    lines = wrap(draw, title, f_title, maxw, 9)
    line_h = int(f_title.size * st["lead"])
    block = len(lines) * line_h
    y = max(int(h * 0.13), int((h - block) / 2) - int(h * 0.055))
    for ln in lines:
        draw.text((pad, y), ln, font=f_title, fill=st["fg"])
        y += line_h

    rule_y = y + int(line_h * 0.30)
    draw.line([(pad, rule_y), (pad + int(w * st["rule_w"]), rule_y)], fill=st["rule"], width=max(2, int(w * 0.0024)))

    sub_lines = wrap(draw, sub, f_sub, w - pad * 2, 3)
    step = int(f_sub.size * 1.62)
    sy = h - pad - len(sub_lines) * step
    for ln in sub_lines:
        draw.text((pad, sy), ln, font=f_sub, fill=st["sub"])
        sy += step

    img.save(out, "PNG", optimize=True)

def main():
    out, title, sub, style_name, w, h, scale = sys.argv[1:8]
    render(out, title, sub, style_name, int(w), int(h), float(scale))
    print("ok:" + out)

try:
    from PIL import Image, ImageDraw, ImageFont
    main()
except Exception as exc:
    sys.stderr.write("cover-error: " + str(exc))
    sys.exit(1)
`;

export interface CoverOptions {
  title: string;
  subtitle: string;
  /** 纸感(默认) / 简约 / 科技 / 光影 / 清新 / 几何 */
  style: string;
  /** 字号缩放：1 为标准，0.9 更小，1.1 更大 */
  scale?: number;
  width: number;
  height: number;
  python: string;
  outDir?: string;
}

export interface CoverResult {
  path: string;
  cached: boolean;
  renderer: "pillow";
}

function cacheKey(o: CoverOptions): string {
  const h = createHash("sha1");
  h.update(
    [String(COVER_VERSION), o.title, o.subtitle, o.style, String(o.scale ?? 1), String(o.width), String(o.height)].join("\u0000"),
  );
  return h.digest("hex").slice(0, 16);
}

/**
 * 生成（或复用缓存的）封面图。
 * 失败时返回 null，调用方应退化为 opencli 的 --card-text 模式。
 */
export async function generateCover(run: Runner, o: CoverOptions, timeoutMs = 60_000): Promise<CoverResult | null> {
  const dir = o.outDir ?? coverCacheDir();
  const path = join(dir, `cover-${cacheKey(o)}.png`);
  try {
    const existing = Bun.file(path);
    if (await existing.exists()) {
      if (existing.size > 1024) return { path, cached: true, renderer: "pillow" };
    }
  } catch {
    /* ignore */
  }
  await run(["mkdir", "-p", dir]).catch(() => undefined);
  const args = [
    o.python,
    "-c",
    PY_SCRIPT,
    path,
    o.title,
    o.subtitle,
    o.style,
    String(o.width),
    String(o.height),
    String(o.scale ?? 1),
  ];
  const res = await run(args, { timeoutMs });
  if (res.code !== 0) return null;
  try {
    const f = Bun.file(path);
    if ((await f.exists()) && f.size > 1024) return { path, cached: false, renderer: "pillow" };
  } catch {
    /* ignore */
  }
  return null;
}
