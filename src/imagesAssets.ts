import type { ImagesAssetRef } from "./chatgptService";
import type { ImagesCatalogResult, ImagesHistoryResult } from "./imagesClient";
import { imageThumbnail, type CloudImage, type ImagePrompt, type ImagePromptGroup } from "./imagesData";

/** Match source roles before IDs: a style and its suggestion can share an ID. */
export function selectPromptAsset(group: ImagePromptGroup, item: ImagePrompt, result: ImagesCatalogResult): ImagesAssetRef | null {
  const styles = result.styles;
  const ids = new Set(styles?.styles.map(style => style.id));
  const replaced = styles?.image_suggestions.length ? result.catalog?.groups.find(candidate =>
    (candidate.kind == null || candidate.kind === "prompt_collection") && candidate.items.some(prompt => ids.has(prompt.id))) : undefined;
  if (replaced?.id === group.id) return result.stylesAssets.find(ref => ref.role === "image_suggestions" && ref.id === item.id) ?? null;
  return result.catalogAssets.find(ref => ref.role === "init_group" && ref.groupId === group.id && ref.id === item.id) ?? null;
}

export function selectHistoryAsset(image: CloudImage, pages: ImagesHistoryResult[]): ImagesAssetRef | null {
  if (!imageThumbnail(image) || pages.some(page => page.items.some(item => item.id === image.id && (item.is_archived || item.output_blocked)))) return null;
  // Ordinary duplicates keep the first item and its originating request's grant.
  const page = pages.find(page => page.items.some(item => item.id === image.id));
  return page?.assets.find(ref => ref.role === "recent" && ref.id === image.id) ?? null;
}
