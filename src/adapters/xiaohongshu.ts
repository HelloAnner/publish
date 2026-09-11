/** 小红书适配器：图文笔记（creator center UI 自动化）。 */

import { callOpencli, firstRowObject, pickString } from "../core/opencli.ts";
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PrepareContext,
  PreparedPublish,
  PublishOutcome,
  Post,
  RunContext,
} from "../core/types.ts";
import { inspectImageSizes, limitImages, splitByWeight, textLength, truncateTo } from "./helpers.ts";

const CAPS: PlatformCapabilities = {
  text: true,
  images: 9,
  requiresImage: true,
  title: true,
  maxTitleLength: 20,
  maxTextLength: 1000,
  lengthMode: "chars",
  topics: true,
  draft: true,
};

const MAX_TITLE = 20;
const MAX_BODY = 1000;

/** 从正文推导标题：取第一行有内容的文本。 */
export function deriveTitle(post: Post): string {
  if (post.title?.trim()) return post.title.trim().replace(/\s+/g, " ");
  const first = post.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (first ?? "").replace(/^#+\s*/, "");
}

/** 单张文字卡片建议承载的字符数。 */
const CARD_CHARS = 420;
/** 小红书图文笔记最多 9 张图，文字卡片同理。 */
const MAX_CARDS = 9;

/**
 * 把长正文切成最多 9 张文字卡片（对应 opencli 的 --card-text，多张用 ||| 分隔）。
 * 超出容量时保留前 8 张 + 截断的收尾，并在调用方给出告警。
 */
export function splitIntoCards(text: string, perCard = CARD_CHARS, maxCards = MAX_CARDS): string[] {
  const chunks = splitByWeight(text, perCard, (s) => [...s].length).filter((c) => c.trim());
  if (chunks.length <= maxCards) return chunks;
  const head = chunks.slice(0, maxCards - 1);
  const tail = chunks.slice(maxCards - 1).join("");
  head.push(truncateTo(tail, perCard));
  return head;
}

/** 卡片文本里的换行要写成字面量 \n（opencli 的约定），多张卡片用 ||| 分隔。 */
export function joinCardText(cards: string[]): string {
  return cards.map((c) => c.replace(/\n/g, "\\n")).join("|||");
}

export function buildPublishArgs(o: {
  body: string;
  title: string;
  images: string[];
  topics: string[];
  draft: boolean;
  cardText?: string;
  cardStyle?: string;
}): string[] {
  const args = ["xiaohongshu", "publish", o.body, "--title", o.title];
  if (o.images.length > 0) args.push("--images", o.images.join(","));
  else {
    args.push("--card-text", o.cardText ?? o.title);
    args.push("--card-style", o.cardStyle ?? "简约");
  }
  if (o.topics.length > 0) args.push("--topics", o.topics.join(","));
  if (o.draft) args.push("--draft");
  args.push("-f", "json");
  return args;
}

export function createXiaohongshuAdapter(): PlatformAdapter {
  return {
    id: "xiaohongshu",
    name: "小红书",
    site: "xiaohongshu",
    capabilities: CAPS,
    requirements: [
      "必须带图片或文字卡片：没有配图时会自动生成封面，或用 --card-text 走文字配图模式",
      "标题上限 20 字",
    ],

    async prepare(post: Post, ctx: PrepareContext): Promise<PreparedPublish> {
      const warnings: string[] = [];
      const errors: string[] = [];
      const notes: string[] = [];

      let title = deriveTitle(post);
      if ([...title].length > MAX_TITLE) {
        warnings.push(`标题 ${[...title].length} 字，超过小红书上限 ${MAX_TITLE} 字，已截断`);
        title = truncateTo(title, MAX_TITLE);
      }
      if (!title) {
        errors.push("小红书需要标题：请用 --title，或在正文首行写标题");
      }

      let body = post.body.trim();
      const bodyLen = textLength(body, CAPS);
      const longform = ctx.options.longform ?? "off";
      const useCards = longform === "cards" || (longform === "auto" && bodyLen > MAX_BODY);

      let cards: string[] = [];
      if (useCards) {
        cards = splitIntoCards(body);
        const total = splitIntoCards(post.body.trim()).length;
        if (total > MAX_CARDS) {
          warnings.push(`正文 ${bodyLen} 字需要 ${total} 张卡片，超过 9 张上限，结尾已截断`);
        }
        notes.push(`正文切成 ${cards.length} 张文字卡片`);
        if (bodyLen > MAX_BODY) {
          warnings.push(`笔记正文 ${bodyLen} 字超过 ${MAX_BODY} 字，已截断；完整内容在卡片图里`);
          body = truncateTo(body, MAX_BODY);
        }
      } else if (bodyLen > MAX_BODY) {
        if (ctx.options.allowTruncate || ctx.options.force) {
          warnings.push(`正文 ${bodyLen} 字，超过 ${MAX_BODY} 字，已截断`);
          body = truncateTo(body, MAX_BODY);
        } else {
          errors.push(
            `正文 ${bodyLen} 字，超过小红书图文笔记 ${MAX_BODY} 字上限。\n` +
              "  · 加 --xhs-longform cards：把全文切成最多 9 张文字卡片一起发\n" +
              `  · 加 --allow-truncate：截断到 ${MAX_BODY} 字（会丢失结尾）\n` +
              "  · 小红书「写长文」入口目前无法自动化（opencli 访问 target=article 会被重定向到登录页）",
          );
        }
      }

      const images = limitImages(post.images, CAPS.images, warnings);
      inspectImageSizes(images, ctx.config, warnings);
      if (images.length === 0) {
        notes.push("没有配图，改用小红书「文字配图」模式");
      }

      const topics = post.topics.map((t) => t.replace(/^#+/, "").trim()).filter(Boolean);
      const draft = ctx.options.draft || post.overrides.xiaohongshu?.draft === true;
      const args = buildPublishArgs({
        body,
        title,
        images,
        topics,
        draft,
        cardText: cards.length > 0 ? joinCardText(cards) : title || truncateTo(body, MAX_TITLE),
        cardStyle: ctx.config.cover.cardStyle,
      });

      if (draft) notes.push("将保存为草稿，不直接发布");

      return {
        platform: "xiaohongshu",
        platformName: "小红书",
        postId: post.id,
        postSource: post.source,
        title,
        text: body,
        images,
        args,
        plan: [args],
        warnings,
        errors,
        notes,
      };
    },

    async publish(prepared: PreparedPublish, ctx: RunContext): Promise<PublishOutcome> {
      const res = await callOpencli(ctx.run, prepared.args, {
        binary: ctx.config.opencli.binary,
        timeoutMs: ctx.config.opencli.timeoutMs,
        window: ctx.config.opencli.window,
        onInvoke: (args: string[]) => ctx.ui.detail("opencli " + args.join(" ")),
      });
      if (!res.ok) {
        return { ok: false, error: res.error?.message ?? "小红书发布失败", raw: res.raw };
      }
      const row = firstRowObject(res);
      return {
        ok: true,
        url: pickString(row, ["url", "note_url", "link"]),
        detail: pickString(row, ["detail", "message", "status"]) ?? "已提交",
        raw: res.raw,
      };
    },
  };
}
