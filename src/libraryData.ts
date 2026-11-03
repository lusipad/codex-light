export interface LibraryNode extends Record<string, unknown> {
  id: string;
  name: string;
  kind: string;
}

export interface LibraryItem {
  node: LibraryNode;
  currentVersion?: unknown;
  lastUsedAt?: unknown;
}

export interface LibraryPage extends Record<string, unknown> {
  items: LibraryItem[];
  cursor: string | null;
}

export interface LibrarySort {
  key: "size" | "name";
  direction: "asc" | "desc";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("资料库数据格式无效，请重试。");
  return value as Record<string, unknown>;
}

function node(value: unknown): LibraryNode {
  const result = record(value);
  if (typeof result.id !== "string" || !result.id || typeof result.name !== "string"
    || typeof result.kind !== "string" || !result.kind) throw Error("资料库条目数据不完整，请重试。");
  return result as LibraryNode;
}

function page(value: unknown, images: boolean): LibraryPage {
  const result = record(value);
  if (!Array.isArray(result.items) || (result.cursor !== null && typeof result.cursor !== "string"))
    throw Error("资料库分页数据无效，请重试。");
  const items = result.items.map(value => {
    if (!images) return { node: node(value) };
    const file = record(value);
    return {
      node: node({ ...file, kind: "file", name: file.file_name, parent_directory_id: file.directory_id ?? null }),
      currentVersion: file.current_version_number ?? 0,
      lastUsedAt: file.last_used_at ?? undefined,
    };
  });
  return { ...result, items, cursor: result.cursor };
}

export function parseLibraryNodesPage(value: unknown): LibraryPage {
  return page(value, false);
}

export function parseLibraryImagesPage(value: unknown): LibraryPage {
  return page(value, true);
}

export function mergeLibraryPages(pages: readonly LibraryPage[]): LibraryItem[] {
  const items = new Map<string, LibraryItem>();
  for (const page of pages) for (const item of page.items) items.set(item.node.id, item);
  return [...items.values()];
}

export function nextLibraryCursor(page: LibraryPage, usedCursors: readonly (string | null)[]): string | null {
  return page.cursor && !usedCursors.includes(page.cursor) ? page.cursor : null;
}

export function isLibraryNavigationRoot(item: LibraryItem): boolean {
  const node = item.node;
  return node.is_root === true || node.id === "library:collection:shared-with-me"
    || /^external-[a-z0-9-]+:root$/u.test(node.id);
}

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortLibraryItems(items: readonly LibraryItem[], sort: LibrarySort): LibraryItem[] {
  return [...items].sort((left, right) => {
    const leftRoot = isLibraryNavigationRoot(left), rightRoot = isLibraryNavigationRoot(right);
    const priority = Number(rightRoot) - Number(leftRoot)
      || Number(right.node.kind === "directory") - Number(left.node.kind === "directory");
    if (priority) return priority;
    if (leftRoot && rightRoot) return 0;
    let comparison: number;
    if (sort.key === "name") comparison = names.compare(left.node.name, right.node.name);
    else {
      const a = left.node.file_size_bytes, b = right.node.file_size_bytes;
      const invalidA = typeof a !== "number" || !Number.isFinite(a) || a < 0;
      const invalidB = typeof b !== "number" || !Number.isFinite(b) || b < 0;
      if (invalidA !== invalidB) return invalidA ? 1 : -1;
      comparison = invalidA || invalidB ? 0 : (a as number) - (b as number);
    }
    return (sort.direction === "asc" ? comparison : -comparison) || names.compare(left.node.name, right.node.name);
  });
}
