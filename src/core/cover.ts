/** 封面生成：无配图时自动造一张 3:4 卡片，避免小红书因缺少图片而失败。 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { coverCacheDir } from "./paths.ts";
import type { Runner } from "./types.ts";

const PY_SCRIPT = String.raw`
import sys, os

def find_font(size):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

PALETTES = {
    "简约": ((247,248,250), (22,24,30), (86,110,255)),
    "科技": ((10,13,22), (238,242,255), (72,196,255)),
    "光影": ((28,18,34), (252,244,250), (255,138,178)),
    "几何": ((248,214,74), (26,26,26), (26,26,26)),
    "清新": ((233,246,238), (24,44,34), (40,160,110)),
}

def wrap(draw, text, font, maxw, maxlines):
    lines = []
    cur = ""
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
    return lines[:maxlines]

def main():
    out, title, sub, style, w, h = sys.argv[1:7]
    w, h = int(w), int(h)
    bg, fg, accent = PALETTES.get(style, PALETTES["简约"])
    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)
    steps = h
    for y in range(steps):
        t = y / float(steps)
        c = (
            int(bg[0] + (accent[0] - bg[0]) * t * 0.22),
            int(bg[1] + (accent[1] - bg[1]) * t * 0.22),
            int(bg[2] + (accent[2] - bg[2]) * t * 0.22),
        )
        draw.line([(0, y), (w, y)], fill=c)
    draw.rectangle([0, 0, w, 14], fill=accent)
    pad = int(w * 0.09)
    f_title = find_font(int(w * 0.082))
    f_sub = find_font(int(w * 0.034))
    lines = wrap(draw, title, f_title, w - pad * 2, 8)
    line_h = int(w * 0.082 * 1.42)
    total = len(lines) * line_h
    y = max(int(h * 0.16), int((h - total) / 2) - int(h * 0.06))
    for ln in lines:
        draw.text((pad, y), ln, font=f_title, fill=fg)
        y += line_h
    draw.line([(pad, y + 26), (pad + int(w * 0.12), y + 26)], fill=accent, width=6)
    sub_lines = wrap(draw, sub, f_sub, w - pad * 2, 3)
    sy = h - pad - len(sub_lines) * int(w * 0.034 * 1.5)
    for ln in sub_lines:
        draw.text((pad, sy), ln, font=f_sub, fill=fg)
        sy += int(w * 0.034 * 1.5)
    img.save(out, "PNG")
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
  style: string;
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
  h.update([o.title, o.subtitle, o.style, String(o.width), String(o.height)].join("\u0000"));
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
      const size = existing.size;
      if (size > 1024) return { path, cached: true, renderer: "pillow" };
    }
  } catch {
    /* ignore */
  }
  await run(["mkdir", "-p", dir]).catch(() => undefined);
  const args = [o.python, "-c", PY_SCRIPT, path, o.title, o.subtitle, o.style, String(o.width), String(o.height)];
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
