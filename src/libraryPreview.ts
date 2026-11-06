export interface LibraryFile extends Record<string, unknown> {
  id: string;
  file_name: string;
  file_id?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  file_extension?: string | null;
  library_file_category?: string | null;
  library_artifact_type?: string | null;
}

export const LIBRARY_PREVIEW_MAX_BYTES = 41943040;
export type LibraryPreviewKind = "deep-research" | "image" | "pdf" | "artifact" | "markdown" | "html" | "text" | "unsupported";

export function parseLibraryFile(value: unknown, requestedFileId: string): LibraryFile {
  const envelope = value as { requestedFileId?: unknown; file?: Record<string, unknown> } | null;
  const file = envelope?.file;
  if (!file || typeof file !== "object" || Array.isArray(file) || envelope?.requestedFileId !== requestedFileId)
    throw Error("文件信息与请求不符，请重试。");
  const canonical = file.access_kind === "shared" && file.kind === "file"
    && !/^libfile_fde[123]_/u.test(requestedFileId) && file.canonical_file_id === file.id
    && typeof file.id === "string" && /^libfile_fde[123]_[A-Za-z0-9_-]+$/u.test(file.id);
  const name = "file_name" in file ? file.file_name : file.name;
  if (typeof file.id !== "string" || !file.id || (file.id !== requestedFileId && !canonical)
    || typeof name !== "string" || (file.kind !== undefined && file.kind !== "file")
    || (file.file_size_bytes != null && (typeof file.file_size_bytes !== "number"
      || !Number.isFinite(file.file_size_bytes) || file.file_size_bytes < 0)))
    throw Error("文件信息不完整，请重试。");
  for (const key of ["file_id", "mime_type", "file_extension", "library_file_category", "library_artifact_type"])
    if (file[key] != null && typeof file[key] !== "string") throw Error("文件信息格式无效，请重试。");
  return { ...file, id: file.id, file_name: name } as LibraryFile;
}

function extension(name: string): string | null {
  const base = name.toLowerCase().split(/[\\/]/u).at(-1)!;
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : null;
}
const artifacts = new Set(["csv", "docx", "ipynb", "pdf", "pptx", "tex", "tsv", "xlsm", "xlsx"]);
const artifactMimes = new Set(["application/x-ipynb+json", "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/csv", "text/tab-separated-values"]);
const textExtensions = new Set(["c", "conf", "cpp", "css", "go", "h", "hpp", "java", "js", "json", "jsonl", "jsx", "log", "py", "rb", "rs", "sh", "ts", "tsx", "txt", "xml", "yaml", "yml"]);
const textMimes = new Set(["application/javascript", "application/json", "application/ld+json", "application/x-javascript", "application/x-ndjson", "application/xml", "application/yaml", "application/yml", "text/javascript"]);

/** Official kind::s order; a kind describes the file, not our renderer coverage. */
export function libraryPreviewKind(file: LibraryFile): LibraryPreviewKind {
  const mime = file.mime_type?.split(";")[0].trim().toLowerCase();
  const suffix = extension(file.file_name);
  if (file.library_artifact_type === "deep_research_report") return "deep-research";
  if (file.library_file_category === "image" || mime?.startsWith("image/")) return "image";
  if (file.library_file_category === "pdf" || mime === "application/pdf" || suffix === "pdf") return "pdf";
  const explicit = file.file_extension ? extension(`file.${file.file_extension}`) : null;
  const artifact = explicit && artifacts.has(explicit) ? explicit : suffix;
  if ((mime && artifactMimes.has(mime)) || (artifact && artifacts.has(artifact) && !["pdf", "tex"].includes(artifact))) return "artifact";
  if (["markdown", "md", "mdown", "mdx", "mkd"].includes(suffix ?? "") || mime === "text/markdown") return "markdown";
  if (suffix === "html" || suffix === "htm" || mime === "text/html") return "html";
  if (file.library_file_category === "text" || mime?.startsWith("text/") || (mime && textMimes.has(mime))
    || (suffix && textExtensions.has(suffix))) return "text";
  return "unsupported";
}
