/** 配置 / 数据 / 缓存目录。 */

import { homedir } from "node:os";
import { join } from "node:path";

function envPath(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function homeDir(): string {
  return envPath("PUBLISH_HOME") ?? homedir();
}

export function configDir(): string {
  return envPath("PUBLISH_CONFIG_DIR") ?? join(envPath("XDG_CONFIG_HOME") ?? join(homeDir(), ".config"), "publish");
}

export function dataDir(): string {
  return envPath("PUBLISH_DATA_DIR") ?? join(envPath("XDG_DATA_HOME") ?? join(homeDir(), ".local", "share"), "publish");
}

export function cacheDir(): string {
  return envPath("PUBLISH_CACHE_DIR") ?? join(envPath("XDG_CACHE_HOME") ?? join(homeDir(), ".cache"), "publish");
}

export function historyFile(): string {
  return envPath("PUBLISH_HISTORY") ?? join(dataDir(), "history.jsonl");
}

export function coverCacheDir(): string {
  return join(cacheDir(), "covers");
}

export function userRouteDir(): string {
  return join(configDir(), "routes");
}

export function globalConfigFile(): string {
  return join(configDir(), "config.json");
}
