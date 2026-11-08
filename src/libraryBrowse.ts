import type { ServiceIdentity } from "./chatgptService";
import type { LibraryItem } from "./libraryData";
import { isLibraryNavigationRoot } from "./libraryData";

export type LibraryBrowseTab = "suggested" | "folders" | "images" | "all";
export type LibraryBrowseCategory = "images" | "documents" | "spreadsheets" | "presentations" | "pdfs";
export type LibraryBrowseSource = "uploaded" | "generated";
export type LibraryBrowseMode = "grid" | "list";
export interface LibraryBrowseScope {
  tab: LibraryBrowseTab;
  directoryId: string | null;
  search: string;
  categories: LibraryBrowseCategory[];
  sources: LibraryBrowseSource[];
}
export interface LibraryBrowseSort { key: "name" | "date" | "size"; direction: "asc" | "desc" }
export interface LibraryBrowsePreferences { viewMode?: LibraryBrowseMode; lastTab: LibraryBrowseTab }
export const libraryBrowseTabs = ["suggested", "folders", "images", "all"] as const;
export const libraryBrowseCategories: Record<LibraryBrowseCategory, string> = {
  images: "图像", documents: "文档", spreadsheets: "电子表格", presentations: "演示文稿", pdfs: "PDF 文件",
};

const libraryPath = /^\/library(?:\/d\/([^/]+))?\/?$/;
const browseQueryKeys = ["tab", "search", "category", "source"] as const;

export function isNativeLibraryDirectory(id: string): boolean {
  return !id.startsWith("library:") && !/^external-(?:gdrive|box|dropbox|sharepoint|onedrive|imanage):/u.test(id);
}

export function parseLibraryFileLocation(value: string | URL): string | null {
  const url = new URL(value, "http://localhost");
  const match = /^\/library\/file\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || url.searchParams.has("account_id") || url.searchParams.has("review_access_requests")) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^libfile[_-][A-Za-z0-9_-]+$/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function parseLibraryLocation(value: string | URL): LibraryBrowseScope | null {
  const url = new URL(value, "http://localhost");
  const match = libraryPath.exec(url.pathname);
  if (!match) return null;
  const query = url.searchParams;
  if (query.get("deleted") === "true" || query.get("storage_cleanup") === "true" || query.get("entry_point") === "settings" ||
    query.has("view") || query.has("file_id") || query.has("account_id") || query.get("review_access_requests") === "1") return null;
  const tab = (query.get("tab") ?? "suggested") as LibraryBrowseTab;
  if (!libraryBrowseTabs.includes(tab)) return null;
  let directoryId: string | null = null;
  if (match[1]) {
    try { directoryId = decodeURIComponent(match[1]); } catch { return null; }
    if (!directoryId.trim() || directoryId === "." || directoryId === ".." || /[\u0000-\u001f\u007f]/u.test(directoryId) ||
      new TextEncoder().encode(directoryId).length > 2048 || !isNativeLibraryDirectory(directoryId)) return null;
  }
  const categories = [...new Set(query.getAll("category"))].filter((category): category is LibraryBrowseCategory => Object.hasOwn(libraryBrowseCategories, category));
  const sources = [...new Set(query.getAll("source"))].filter((source): source is LibraryBrowseSource => source === "uploaded" || source === "generated");
  return { directoryId, tab, search: query.get("search")?.trim() ?? "", categories, sources };
}

export function libraryLocationUrl(current: string | URL, scope: LibraryBrowseScope | null): string {
  const url = new URL(current, "http://localhost");
  for (const key of browseQueryKeys) url.searchParams.delete(key);
  if (scope) {
    if (!libraryPath.test(url.pathname)) {
      url.searchParams.delete("view");
      if (url.pathname === "/code-review") url.hash = "";
    }
    url.pathname = scope.directoryId === null ? "/library" : `/library/d/${encodeURIComponent(scope.directoryId)}`;
    if (scope.tab !== "suggested") url.searchParams.set("tab", scope.tab);
    if (scope.search.trim()) url.searchParams.set("search", scope.search.trim());
    for (const category of scope.categories) url.searchParams.append("category", category);
    for (const source of scope.sources) url.searchParams.append("source", source);
  } else url.pathname = "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function libraryBrowsePreferenceKey(identity: Pick<ServiceIdentity, "accountId" | "userId">): string | null {
  return identity.userId == null ? null : `library-display-preferences:${JSON.stringify([identity.accountId, identity.userId])}`;
}
export function decodeLibraryBrowsePreferences(value: unknown): LibraryBrowsePreferences {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { lastTab: libraryBrowseTabs.includes(data.lastTab as LibraryBrowseTab) ? data.lastTab as LibraryBrowseTab : "suggested",
    ...((data.viewMode === "grid" || data.viewMode === "list") ? { viewMode: data.viewMode } : {}) };
}
export function nextLibraryBrowseSort(current: LibraryBrowseSort | null, key: LibraryBrowseSort["key"]): LibraryBrowseSort | null {
  const first = key === "name" ? "asc" : "desc";
  return current?.key !== key ? { key, direction: first } : current.direction === first
    ? { key, direction: first === "asc" ? "desc" : "asc" } : null;
}
export function libraryBrowseDate(item: LibraryItem, suggested = false): number {
  const date = Date.parse(String(item.node.updated_at ?? item.node.file_upload_time ?? ""));
  if (suggested && item.lastUsedAt != null) {
    const used = Date.parse(String(item.lastUsedAt));
    if (!Number.isFinite(date) || used > date) return used;
  }
  return date;
}
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function sortLibraryBrowseItems(items: readonly LibraryItem[], sort: LibraryBrowseSort | null, suggested = false): LibraryItem[] {
  if (!sort) return [...items];
  return [...items].sort((left, right) => {
    const leftRoot = isLibraryNavigationRoot(left), rightRoot = isLibraryNavigationRoot(right);
    const priority = Number(rightRoot) - Number(leftRoot)
      || Number(right.node.kind === "directory") - Number(left.node.kind === "directory");
    if (priority) return priority;
    if (leftRoot && rightRoot) return 0;
    let comparison: number;
    if (sort.key === "name") comparison = names.compare(left.node.name, right.node.name);
    else {
      const a = sort.key === "date" ? libraryBrowseDate(left, suggested) : left.node.file_size_bytes;
      const b = sort.key === "date" ? libraryBrowseDate(right, suggested) : right.node.file_size_bytes;
      const invalidA = typeof a !== "number" || !Number.isFinite(a) || (sort.key === "size" && a < 0);
      const invalidB = typeof b !== "number" || !Number.isFinite(b) || (sort.key === "size" && b < 0);
      if (invalidA !== invalidB) return invalidA ? 1 : -1;
      comparison = invalidA || invalidB ? 0 : (a as number) - (b as number);
    }
    return (sort.direction === "asc" ? comparison : -comparison) || names.compare(left.node.name, right.node.name);
  });
}
