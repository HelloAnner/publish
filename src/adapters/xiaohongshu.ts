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
import { inspectImageSizes, limitImages, textLength, truncateTo } from "./helpers.ts";

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
      if (bodyLen > MAX_BODY) {
        if (ctx.options.allowTruncate || ctx.options.force) {
          warnings.push(`正文 ${bodyLen} 字，超过 ${MAX_BODY} 字，已截断`);
          body = truncateTo(body, MAX_BODY);
        } else {
          errors.push(`正文 ${bodyLen} 字，超过小红书 ${MAX_BODY} 字上限（加 --allow-truncate 可自动截断）`);
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
        cardText: title || truncateTo(body, MAX_TITLE),
        cardStyle: ctx.config.cover.style,
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
