#!/usr/bin/env bun
/**
 * publish — 把观点快速发布到小红书 / X / 知乎 / 任意站点。
 *
 * 入口只做三件事：解析 argv、分发命令、把退出码交给 shell。
 */
import { runCli } from "./cli/main.ts";

const code = await runCli(process.argv.slice(2));
process.exit(code);
