/** 知乎适配器：回答指定问题（opencli zhihu answer 走官方 API，需要 --execute）。 */

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
import { looksLikeHtml, textToHtmlParagraphs } from "../core/util.ts";
import { textLength, truncateTo } from "./helpers.ts";

const CAPS: PlatformCapabilities = {
  text: true,
  images: 0,
  requiresImage: false,
  title: false,
  maxTextLength: 60_000,
  lengthMode: "chars",
  topics: false,
  draft: false,
};

/** 从任意字符串里挖出知乎问题 id。 */
export function extractQuestionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = /zhihu\.com\/question\/(\d+)/.exec(value);
  if (url) return url[1];
  const typed = /(?:^|\s)question:(\d+)/.exec(value);
  if (typed) return typed[1];
  if (/^\d{5,}$/.test(value.trim())) return value.trim();
  return undefined;
}

/** 在 opencli 任意输出结构里递归找问题 id / 标题。 */
export function findQuestion(rows: unknown[]): { id?: string; title?: string } {
  let id: string | undefined;
  let title: string | undefined;
  const visit = (node: unknown): void => {
    if (id && title) return;
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (!id) id = extractQuestionId(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (!id) {
        for (const key of ["url", "link", "target", "id", "question_id", "questionId"]) {
          id = extractQuestionId(obj[key]);
          if (id) break;
        }
      }
      if (!title) {
        for (const key of ["title", "question_title", "name", "text"]) {
          const v = obj[key];
          if (typeof v === "string" && v.trim()) {
            title = v.trim();
            break;
          }
        }
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  for (const row of rows) visit(row);
  return { id, title };
}

export function toZhihuPayload(body: string): { payload: string; converted: boolean } {
  if (looksLikeHtml(body)) return { payload: body, converted: false };
  return { payload: textToHtmlParagraphs(body), converted: true };
}

export function searchKeywordFor(post: Post): string {
  if (post.title?.trim()) return post.title.trim().slice(0, 40);
  const firstLine = post.body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? post.body;
  return firstLine.slice(0, 40);
}

export function createZhihuAdapter(): PlatformAdapter {
  return {
    id: "zhihu",
    name: "知乎",
    site: "zhihu",
    capabilities: CAPS,
    requirements: [
      "知乎发布 = 回答问题，需要问题目标：--target zhihu=https://www.zhihu.com/question/123",
      "未指定目标时会用正文首行自动搜索并匹配第一个问题，请确认后再发布",
    ],

    async prepare(post: Post, ctx: PrepareContext): Promise<PreparedPublish> {
      const warnings: string[] = [];
      const errors: string[] = [];
      const notes: string[] = [];

      const { payload, converted } = toZhihuPayload(post.body);
      if (converted) notes.push("正文已转换成知乎可接受的 HTML 段落");

      const len = textLength(post.body, CAPS);
      if (len > CAPS.maxTextLength!) {
        warnings.push(`正文 ${len} 字，非常长（知乎上限约 ${CAPS.maxTextLength} 字），请确认`);
      }

      let targetId = extractQuestionId(post.target);
      if (post.target && !targetId) {
        errors.push(`无法解析知乎目标 "${post.target}"，示例：--target zhihu=https://www.zhihu.com/question/123456`);
      }

      if (!targetId) {
        const keyword = searchKeywordFor(post);
        const search = await callOpencli(
          ctx.run,
          ["zhihu", "search", keyword, "--type", "question", "--limit", "5", "-f", "json"],
          {
            binary: ctx.config.opencli.binary,
            timeoutMs: ctx.config.opencli.timeoutMs,
            window: ctx.config.opencli.window,
            onInvoke: (args: string[]) => ctx.ui.detail("opencli " + args.join(" ")),
          },
        );
        if (!search.ok) {
          const hint = search.error?.exitCode === 77 ? "（先运行 publish login -to zhihu）" : "";
          errors.push(`知乎搜索失败，无法自动匹配问题${hint}：${search.error?.message ?? "unknown"}`);
        } else {
          const found = findQuestion(search.rows);
          if (found.id) {
            targetId = found.id;
            notes.push(
              `自动匹配到问题：${found.title ?? "(无标题)"} → https://www.zhihu.com/question/${found.id}`,
            );
            warnings.push("自动匹配的问题请务必确认；下次可用 --target zhihu=<问题URL> 精确指定");
          } else {
            errors.push(`未能用 "${keyword}" 匹配到知乎问题，请用 --target zhihu=<问题URL> 指定`);
          }
        }
      }

      const args = targetId
        ? ["zhihu", "answer", `question:${targetId}`, payload, "--execute", "-f", "json"]
        : ["zhihu", "answer", "<未确定的问题>", payload, "--execute", "-f", "json"];

      return {
        platform: "zhihu",
        platformName: "知乎",
        postId: post.id,
        postSource: post.source,
        title: post.title,
        text: post.body,
        images: [],
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
        return { ok: false, error: res.error?.message ?? "知乎回答失败", raw: res.raw };
      }
      const row = firstRowObject(res);
      return {
        ok: true,
        url: pickString(row, ["created_url", "url"]),
        detail: pickString(row, ["message", "outcome", "status"]) ?? "已发布回答",
        raw: res.raw,
      };
    },
  };
}
