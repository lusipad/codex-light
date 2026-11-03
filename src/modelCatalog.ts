import { callAppServer } from "./bridge";
import type { ModelInfo } from "./types";

export async function loadModelCatalog(): Promise<ModelInfo[]> {
  const models = new Map<string, ModelInfo>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { data: ModelInfo[]; nextCursor?: string | null } = await callAppServer("model/list", {
      cursor, includeHidden: true, limit: 100,
    });
    if (!Array.isArray(page?.data)) throw Error("模型目录返回格式无效");
    for (const model of page.data) {
      if (!model || typeof model.id !== "string" || !model.id.trim()
        || model.model !== undefined && (typeof model.model !== "string" || !model.model.trim())) {
        throw Error("模型目录条目格式无效");
      }
      models.set(model.id, model);
    }
    cursor = page.nextCursor ?? null;
    if (cursor !== null && (typeof cursor !== "string" || !cursor)) throw Error("模型目录分页格式无效");
    if (cursor !== null) {
      if (cursors.has(cursor)) throw Error("模型目录分页重复，请重新读取");
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return [...models.values()];
}
