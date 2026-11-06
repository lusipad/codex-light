export interface ImagePrompt extends Record<string, unknown> {
  id: string;
  title?: string;
  section?: string;
}
export interface ImagePromptGroup extends Record<string, unknown> {
  id: string;
  kind?: string;
  presentation?: string;
  items: ImagePrompt[];
}
export interface ImagesCatalog extends Record<string, unknown> { groups: ImagePromptGroup[] }
export interface ImagesStyles extends Record<string, unknown> { styles: { id: string }[]; image_suggestions: ImagePrompt[] }
export interface CloudImage extends Record<string, unknown> {
  id: string;
  title?: string;
  is_archived?: boolean;
  output_blocked?: boolean;
  url?: string;
  asset_pointer?: string;
  encodings?: { thumbnail?: { path?: string | null } };
}
export interface ImagesHistoryPage extends Record<string, unknown> { items: CloudImage[]; cursor: string | null }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function record(value: unknown) {
  if (!object(value)) throw Error("图像服务数据格式无效，请重试。");
  return value;
}
function text(value: unknown, required = false): string | undefined {
  if (value === undefined || value === null) { if (required) throw Error("图像服务数据缺少必要字段。"); return; }
  if (typeof value !== "string" || (required && !value)) throw Error("图像服务文字字段格式无效。");
  return value;
}
function prompt(value: unknown): ImagePrompt {
  const item = record(value);
  const id = text(item.id, true)!, title = text(item.title);
  text(item.section); text(item.image_alt); text(item.image_url); text(item.prompt_text);
  for (const field of ["image_variant_urls", "image_variants"]) if (item[field] != null
    && (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(value => typeof value === "string")))
    throw Error("图像提示资源格式无效。");
  if (item.action != null) record(item.action);
  return { ...item, id, title } as ImagePrompt;
}
export function parseImagesCatalog(value: unknown): ImagesCatalog {
  const data = record(value);
  if (data.groups == null) return { ...data, groups: [] };
  if (!Array.isArray(data.groups)) throw Error("图像目录格式无效。");
  return { ...data, groups: data.groups.map(value => {
    const group = record(value), id = text(group.id, true)!;
    const kind = text(group.kind), presentation = text(group.presentation);
    text(group.title);
    if (group.action != null) record(group.action);
    if (group.items != null && !Array.isArray(group.items)) throw Error("图像目录条目格式无效。");
    return { ...group, id, kind, presentation, items: (group.items ?? []).map(prompt) } as ImagePromptGroup;
  }) };
}
export function parseImagesStyles(value: unknown): ImagesStyles {
  const data = record(value);
  if (data.styles != null && !Array.isArray(data.styles)) throw Error("图像样式格式无效。");
  if (data.image_suggestions != null && !Array.isArray(data.image_suggestions)) throw Error("图像建议格式无效。");
  return { ...data, styles: (data.styles ?? []).map(value => {
    const style = record(value); return { ...style, id: text(style.id, true)! };
  }), image_suggestions: (data.image_suggestions ?? []).map(prompt) };
}
export function mergeImagesCatalog(catalog: ImagesCatalog, styles?: ImagesStyles): ImagePromptGroup[] {
  if (!styles?.image_suggestions.length) return catalog.groups;
  const ids = new Set(styles.styles.map(style => style.id));
  const target = catalog.groups.find(group => (group.kind == null || group.kind === "prompt_collection")
    && group.items.some(item => ids.has(item.id)));
  return catalog.groups.map(group => group === target ? { ...group, items: styles.image_suggestions } : group);
}
export function imagesSections(groups: ImagePromptGroup[], order: string[] = []): string[] {
  return [...new Set(groups.flatMap(group => group.kind == null || group.kind === "prompt_collection"
    ? group.items.map(item => item.section || "") : []))].sort((left, right) => {
      const a = order.indexOf(left || "trending"), b = order.indexOf(right || "trending");
      return (a < 0 ? order.length : a) - (b < 0 ? order.length : b);
    });
}
export function parseImagesHistory(value: unknown): ImagesHistoryPage {
  const data = record(value);
  if (!Array.isArray(data.items) || (data.cursor !== null && typeof data.cursor !== "string"))
    throw Error("图像历史分页格式无效。");
  const items = data.items.map(value => {
    const image = record(value), id = text(image.id, true)!;
    for (const key of ["title", "url", "asset_pointer", "conversation_id", "message_id", "transformation_id"]) text(image[key]);
    for (const key of ["is_archived", "output_blocked"]) if (image[key] != null && typeof image[key] !== "boolean")
      throw Error("图像历史状态格式无效。");
    if (image.encodings != null) {
      const encodings = record(image.encodings);
      if (encodings.thumbnail != null) text(record(encodings.thumbnail).path);
    }
    return { ...image, id } as CloudImage;
  });
  return { ...data, items, cursor: data.cursor };
}
export function mergeImagesHistory(pages: ImagesHistoryPage[]): CloudImage[] {
  const images = new Map<string, CloudImage>();
  const archived = new Set<string>(), blocked = new Set<string>();
  // Keep ordinary first-id data, but do not let deduplication swallow a later deny.
  // These sets belong only to this pages snapshot; replacing pages allows recovery.
  for (const page of pages) for (const image of page.items) {
    if (!images.has(image.id)) images.set(image.id, image);
    if (image.is_archived) archived.add(image.id);
    if (image.output_blocked) blocked.add(image.id);
  }
  return [...images.values()].filter(image => !archived.has(image.id))
    .map(image => blocked.has(image.id) ? { ...image, output_blocked: true } : image);
}
export function imagesNextCursor(page: ImagesHistoryPage, used: (string | null)[]): string | null {
  return page.cursor && !used.includes(page.cursor) ? page.cursor : null;
}
export function imageThumbnail(image: CloudImage): string | null {
  return image.output_blocked || image.is_archived ? null : image.encodings?.thumbnail?.path ?? image.url ?? null;
}
