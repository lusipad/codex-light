/**
 * 侧边栏「自定义分区」协议封装 —— `threadSection/*` + `thread/section/move`。
 *
 * 对应的 app-server（codex 0.159.0）协议形状：
 * - `threadSection/list`   {} → { data: ThreadSection[], nextCursor: string | null }
 * - `threadSection/create` { name } → { section: ThreadSection }
 * - `threadSection/update` { sectionId, name } → { section: ThreadSection }
 * - `threadSection/delete` { sectionId } → {}
 * - `thread/section/move`  { threadId, sectionId | null, beforeThreadId? | null } → {}
 *
 * 所有函数在协议不可用（非 Tauri 运行时 / app-server 未连接 / 方法不存在）时都会抛错，
 * 由调用方决定降级策略（侧栏静默隐藏自定义分区区）。
 */

import { callAppServer } from "./bridge";

/** 可扩展的分区视觉呈现（与协议 `ThreadSectionAppearance` 对应）。 */
export interface ThreadSectionAppearance {
  color?: string | null;
  icon?: string | null;
}

/** 独立持久化的、用户可见的会话分区。 */
export interface ThreadSection {
  id: string;
  name: string;
  appearance?: ThreadSectionAppearance | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSection(raw: any): ThreadSection | null {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.sectionId ?? raw.section_id;
  const name = raw.name ?? raw.title;
  if (!isNonEmptyString(id) || !isNonEmptyString(name)) return null;
  const appearance =
    raw.appearance && typeof raw.appearance === "object"
      ? (raw.appearance as ThreadSectionAppearance)
      : null;
  return { id: String(id), name: String(name), appearance };
}

/** 兼容 `{data:[...]}`, `[...]`, `{sections:[...]}` 等返回包装。 */
function extractSectionList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.sections)) return res.sections;
  if (res?.data && typeof res.data === "object") {
    if (Array.isArray(res.data.sections)) return res.data.sections;
    if (Array.isArray(res.data.data)) return res.data.data;
  }
  if (Array.isArray(res?.result)) return res.result;
  return [];
}

/** 兼容 create/update 的 `{section}`, `{data:{...}}`, 直接对象等返回包装。 */
function extractSection(res: any): ThreadSection | null {
  const candidates = [
    res?.section,
    res?.data?.section,
    res?.data,
    res?.threadSection,
    res?.result?.section,
    res?.result,
    res,
  ];
  for (const candidate of candidates) {
    const section = normalizeSection(candidate);
    if (section) return section;
  }
  return null;
}

function dedupeSections(sections: ThreadSection[]): ThreadSection[] {
  const seen = new Set<string>();
  const out: ThreadSection[] = [];
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    out.push(section);
  }
  return out;
}

/** 拉取全部分区（自动跟随 nextCursor，最多 10 页）。失败抛错。 */
export async function listSections(): Promise<ThreadSection[]> {
  const collected: ThreadSection[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const res: any = await callAppServer<any>(
      "threadSection/list",
      cursor ? { cursor } : {}
    );
    collected.push(
      ...extractSectionList(res)
        .map(normalizeSection)
        .filter((section): section is ThreadSection => section !== null)
    );

    const nextCursor: string | null =
      typeof res?.nextCursor === "string" && res.nextCursor.length > 0
        ? res.nextCursor
        : null;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return dedupeSections(collected);
}

/** 新建分区。失败抛错。 */
export async function createSection(name: string): Promise<ThreadSection> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("分区名称不能为空");

  const res = await callAppServer<any>("threadSection/create", { name: trimmed });
  const section = extractSection(res);
  if (section) return section;

  // 服务端已成功创建但返回形状不识别时，重新 list 兜底找到它。
  const created = (await listSections()).filter((s) => s.name === trimmed).pop();
  if (created) return created;
  throw new Error("threadSection/create 未返回可识别的分区数据");
}

/** 重命名分区。失败抛错。 */
export async function updateSection(
  sectionId: string,
  name: string
): Promise<ThreadSection> {
  const trimmed = name.trim();
  if (!sectionId) throw new Error("sectionId 不能为空");
  if (!trimmed) throw new Error("分区名称不能为空");

  const res = await callAppServer<any>("threadSection/update", {
    sectionId,
    name: trimmed,
  });
  const section = extractSection(res);
  // update 成功即已生效；返回形状异常时用请求值兜底，避免误报失败。
  return section ?? { id: sectionId, name: trimmed, appearance: null };
}

/** 删除分区（分区内聊天会由服务端/调用方移出）。失败抛错。 */
export async function deleteSection(sectionId: string): Promise<void> {
  if (!sectionId) throw new Error("sectionId 不能为空");
  await callAppServer<any>("threadSection/delete", { sectionId });
}

/**
 * 把会话移入 / 移出分区，或在分区内排序。
 * - sectionId = null 表示移出分区（回到未分组）
 * - beforeThreadId 省略 / null 表示追加到分区末尾
 */
export async function moveThreadToSection(
  threadId: string,
  sectionId: string | null,
  beforeThreadId?: string | null
): Promise<void> {
  if (!threadId) throw new Error("threadId 不能为空");
  await callAppServer<any>("thread/section/move", {
    threadId,
    sectionId: sectionId ?? null,
    beforeThreadId: beforeThreadId ?? null,
  });
}
