/** 小工具：宽度计算、字符串处理、hash、shell 转义。 */

/** 东亚宽字符判定（用于终端表格对齐 + 平台字数权重）。 */
export function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** 终端显示宽度：宽字符算 2 列。 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0) continue;
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

/** 按显示宽度截断（不破坏代理对）。 */
export function truncateDisplay(s: string, max: number): string {
  if (displayWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

const URL_RE = /https?:\/\/\S+/g;

/**
 * 平台「加权字数」。
 * - X/Twitter: 拉丁 1、CJK 与 emoji 2、链接一律 23。
 * - 其他平台传 { urlWeight: 0 } 即退化为普通字符数（CJK 仍算 2，符合小红书/知乎的直观字数）。
 */
export function weightedLength(text: string, opts: { urlWeight?: number } = {}): number {
  const urlWeight = opts.urlWeight ?? 0;
  let urls = 0;
  let rest = text;
  if (urlWeight > 0) {
    rest = text.replace(URL_RE, () => {
      urls += 1;
      return "";
    });
  }
  let w = urls * urlWeight;
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

/** 基于显示宽度的换行，保留原有段落。 */
export function wrapDisplay(s: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of s.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let cur = "";
    let w = 0;
    for (const ch of para) {
      const cw = isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
      if (w + cw > max) {
        lines.push(cur);
        cur = ch;
        w = cw;
      } else {
        cur += ch;
        w += cw;
      }
    }
    lines.push(cur);
  }
  return lines;
}

/** shell 转义，仅用于「展示」将要执行的命令。 */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function shellLine(cmd: string[]): string {
  return cmd.map(shellQuote).join(" ");
}

/** 稳定 hash（用于缓存文件名）。 */
export function shortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
    h2 = (h2 ^ (h2 >>> 7)) >>> 0;
  }
  return h1.toString(36).padStart(7, "0") + h2.toString(36).padStart(6, "0");
}

export function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  if (unit === "ms") return n;
  if (unit === "m") return n * 60_000;
  return n * 1000;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\u3001]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 把纯文本转成知乎可接受的 HTML 段落。 */
export function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const html = block
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .split(/\n/)
        .join("<br/>");
      return "<p>" + html + "</p>";
    })
    .join("");
}

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = now.getTime() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return min + " 分钟前";
  const h = Math.round(min / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.round(h / 24);
  return d + " 天前";
}
