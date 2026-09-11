/** X / Twitter 适配器：post + reply 串成线程。 */

import { callOpencli, firstRowObject, pickString } from "../core/opencli.ts";
import { createRng, humanize } from "../core/random.ts";
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PrepareContext,
  PreparedPublish,
  PublishOutcome,
  Post,
  RunContext,
} from "../core/types.ts";
import { sleep } from "../core/ui.ts";
import { appendHashtags, inspectImageSizes, limitImages, splitByWeight, textLength } from "./helpers.ts";

const CAPS: PlatformCapabilities = {
  text: true,
  images: 4,
  requiresImage: false,
  title: false,
  maxTextLength: 280,
  lengthMode: "weighted",
  urlWeight: 23,
  topics: true,
  draft: false,
};

const LIMIT = 280;
/** 留一点余量给后续补充，避免边界抖动。 */
const CHUNK_LIMIT = 272;

const weightOf = (s: string) => textLength(s, CAPS);

function postArgs(text: string, images: string[]): string[] {
  const args = ["twitter", "post", text];
  if (images.length > 0) args.push("--images", images.join(","));
  args.push("-f", "json");
  return args;
}

function replyArgs(url: string, text: string): string[] {
  return ["twitter", "reply", url, text, "-f", "json"];
}

export function createTwitterAdapter(): PlatformAdapter {
  return {
    id: "twitter",
    name: "X / Twitter",
    site: "twitter",
    capabilities: CAPS,
    requirements: ["正文超过 280 加权字数时，可加 --thread 自动拆成线程"],

    async prepare(post: Post, ctx: PrepareContext): Promise<PreparedPublish> {
      const warnings: string[] = [];
      const errors: string[] = [];
      const notes: string[] = [];
      // X 没有独立标题字段：把标题并进正文首行
      const base =
        post.title && !post.body.trimStart().startsWith(post.title)
          ? `${post.title}\n\n${post.body}`
          : post.body;
      const text = appendHashtags(base, post.topics, 4);
      const images = limitImages(post.images, CAPS.images, warnings);
      inspectImageSizes(images, ctx.config, warnings);

      const weight = weightOf(text);
      const plan: string[][] = [];

      if (weight <= LIMIT) {
        plan.push(postArgs(text, images));
      } else if (ctx.options.thread) {
        const chunks = splitByWeight(text, CHUNK_LIMIT, weightOf);
        notes.push(`正文 ${weight} 字（> ${LIMIT}），将拆成 ${chunks.length} 条线程`);
        chunks.forEach((chunk, i) => {
          if (i === 0) plan.push(postArgs(chunk, images));
          else plan.push(replyArgs("<上一条的 URL>", chunk));
        });
      } else {
        errors.push(
          `X 正文 ${weight} 加权字数超过 ${LIMIT}（CJK 记 2，链接记 23）。\n` +
            "  · 加 --thread 自动拆成线程；\n" +
            "  · 或精简文案后重发。",
        );
      }

      return {
        platform: "twitter",
        platformName: "X / Twitter",
        postId: post.id,
        postSource: post.source,
        text,
        images,
        args: plan[0] ?? postArgs(text, images),
        plan,
        warnings,
        errors,
        notes,
      };
    },

    async publish(prepared: PreparedPublish, ctx: RunContext): Promise<PublishOutcome> {
      const common = {
        binary: ctx.config.opencli.binary,
        timeoutMs: ctx.config.opencli.timeoutMs,
        window: ctx.config.opencli.window,
        onInvoke: (args: string[]) => ctx.ui.detail("opencli " + args.join(" ")),
      };
      const isThread = ctx.options.thread && weightOf(prepared.text) > LIMIT;

      if (!isThread) {
        const res = await callOpencli(ctx.run, prepared.args, common);
        if (!res.ok) return { ok: false, error: res.error?.message ?? "twitter post 失败", raw: res.raw };
        const row = firstRowObject(res);
        return {
          ok: true,
          url: pickString(row, ["url", "tweet_url", "link"]),
          detail: pickString(row, ["message", "status"]) ?? "已发布",
          raw: res.raw,
        };
      }

      const chunks = splitByWeight(prepared.text, CHUNK_LIMIT, weightOf);
      const rng = createRng().rng;
      let prevUrl: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const args = i === 0 ? postArgs(chunk, prepared.images) : replyArgs(prevUrl!, chunk);
        ctx.ui.step(`线程 ${i + 1}/${chunks.length}：${chunk.length > 32 ? chunk.slice(0, 32) + "…" : chunk}`);
        const res = await callOpencli(ctx.run, args, common);
        if (!res.ok) {
          return {
            ok: false,
            url: prevUrl,
            error: `线程第 ${i + 1}/${chunks.length} 条失败：${res.error?.message ?? "unknown"}`,
            raw: res.raw,
          };
        }
        const row = firstRowObject(res);
        const url = pickString(row, ["url", "tweet_url", "link"]);
        const id = pickString(row, ["id", "tweet_id"]);
        if (i === 0) {
          prevUrl = url ?? (id ? `https://x.com/i/status/${id}` : prevUrl);
          if (!prevUrl) {
            return { ok: false, error: "第一条推文没有返回 URL/ID，无法继续串线程（内容已发布，请手动检查）" };
          }
        }
        if (i < chunks.length - 1) {
          await ctx.ui.countdown(humanize(rng, 3_000, 12_000), "线程下一条", ctx.signal);
        }
      }
      return { ok: true, url: prevUrl, detail: `已发布线程 ${chunks.length} 条` };
    },
  };
}
