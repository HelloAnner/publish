/** 内置平台 + 用户 route 的注册装配。 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { userRouteDir } from "../core/paths.ts";
import { Registry } from "../core/registry.ts";
import { createTwitterAdapter } from "./twitter.ts";
import { createXiaohongshuAdapter } from "./xiaohongshu.ts";
import { createZhihuAdapter } from "./zhihu.ts";
import { createRouteAdapter, loadRoutes, type RouteDefinition } from "./route.ts";

export function builtinRouteDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "..", "routes"), userRouteDir()];
}

export interface BuildRegistryOptions {
  /** 额外 / 覆盖的 route 目录，优先级最高。 */
  extraRouteDirs?: string[];
  routeDirs?: string[];
  onWarning?: (msg: string) => void;
}

/** 只装配内置平台，便于测试与 doctor 复用。 */
export function builtinRegistry(): Registry {
  const registry = new Registry();
  registry.add(createTwitterAdapter());
  registry.add(createXiaohongshuAdapter());
  registry.add(createZhihuAdapter());
  return registry;
}

export async function buildRegistry(opts: BuildRegistryOptions = {}): Promise<Registry> {
  const registry = builtinRegistry();

  const dirs = [...(opts.extraRouteDirs ?? []), ...(opts.routeDirs ?? []), ...builtinRouteDirs()];
  const { routes, warnings } = await loadRoutes(dirs);
  for (const w of warnings) opts.onWarning?.(w);
  for (const route of routes) {
    if (registry.has(route.id)) {
      opts.onWarning?.(`route "${route.id}" 与内置平台同名，已跳过（${route.path}）`);
      continue;
    }
    registry.add(createRouteAdapter(route));
  }
  return registry;
}

export type { RouteDefinition };
