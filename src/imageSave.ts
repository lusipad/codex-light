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
