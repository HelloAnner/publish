/** CLI 运行时上下文。 */

import type { Flags } from "./args.ts";
import type { Registry } from "../core/registry.ts";
import type { PublishConfig, Runner } from "../core/types.ts";
import type { UI } from "../core/ui.ts";

export interface CliContext {
  ui: UI;
  flags: Flags;
  command: string;
  rest: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  config: PublishConfig;
  registry: Registry;
  run: Runner;
  historyPath: string;
  dryRun: boolean;
  assumeYes: boolean;
  force: boolean;
}

export const VERSION = "0.1.0";
