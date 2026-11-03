import { tauriInvoke } from "./bridge";
import { configRead } from "./config";

export function resolveWebLinkTarget(preference: unknown, browserPaneEnabled: boolean) {
  const target = preference ?? "in-app-browser";
  if (target !== "in-app-browser" && target !== "external-browser") throw Error("浏览器链接设置无效，请检查桌面配置。");
  return browserPaneEnabled && target === "in-app-browser" ? "in-app-browser" : "external-browser";
}

export async function openWebLink(url: string, isCurrent: () => boolean) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw Error("链接必须为无凭据的 HTTPS 地址。");
  const { config } = await configRead();
  if (!isCurrent()) return;
  const desktop = config.desktop;
  if (desktop != null && (typeof desktop !== "object" || Array.isArray(desktop))) throw Error("桌面配置格式无效。");
  // The iframe preview is not a native browser pane. Use the official unavailable-pane fallback.
  resolveWebLinkTarget((desktop as Record<string, unknown> | undefined)?.["open-link-in-target-preference"], false);
  await tauriInvoke("review_link_open", { url: parsed.href });
}
