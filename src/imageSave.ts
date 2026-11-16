import { tauriInvoke } from "./bridge";
import { bytesToBase64, readFileBase64 } from "./fsClient";

export async function saveGeneratedImageBytes(image: { path?: string; src?: string }): Promise<string | null> {
  let dataBase64: string;
  if (image.path) {
    dataBase64 = await readFileBase64(image.path);
  } else if (image.src) {
    const response = await fetch(image.src);
    if (!response.ok) throw new Error(`无法读取图片（HTTP ${response.status}）`);
    dataBase64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  } else {
    throw new Error("无法读取图片结果");
  }
  return tauriInvoke<string | null>("generated_image_save", { dataBase64 });
}

/** Shared local-history lightbox download; generated-image saving keeps its own dialog. */
export async function savePreviewImageBytes(src: string): Promise<string | null> {
  if (!/^(?:data:image\/|blob:)/i.test(src)) throw new Error("无法读取当前图像");
  const response = await fetch(src);
  if (!response.ok) throw new Error(`无法读取图片（HTTP ${response.status}）`);
  const blob = await response.blob();
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[blob.type];
  if (!extension) throw new Error("暂不支持此图片格式");
  const formattedDate = new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());
  return tauriInvoke<string | null>("preview_image_save", {
    dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    suggestedFileName: `ChatGPT 图像 ${formattedDate}.${extension}`,
  });
}

/** A decoded History preview already owns its validated bytes. */
export async function saveDecodedImage(src: string, suggestedTitle: string): Promise<string | null> {
  const prefix = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/u.exec(src);
  if (!prefix || src.length === prefix[0].length || src.length - prefix[0].length > Math.ceil(8 * 1024 * 1024 / 3) * 4) {
    throw new Error("无法读取当前图像");
  }
  return tauriInvoke<string | null>("generated_image_save", { dataBase64: src.slice(prefix[0].length), suggestedTitle });
}
