/** 结构化文件解析：JSON 优先，回退 YAML（Bun.YAML）。 */

export function parseStructured(text: string, source: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试 YAML */
  }
  try {
    const yaml = (Bun as unknown as { YAML?: { parse(s: string): unknown } }).YAML;
    if (yaml?.parse) return yaml.parse(trimmed);
  } catch (err) {
    throw new Error(`${source} 解析失败：${(err as Error).message}`);
  }
  throw new Error(`${source} 解析失败：既不是合法 JSON 也不是合法 YAML`);
}

export async function readStructuredFile(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`文件不存在：${path}`);
  return parseStructured(await file.text(), path);
}
