import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime, tauriListen } from "./bridge";

/**
 * Native shell bridge (Tauri-only): native menu bar / system tray events.
 *
 * Rust side (`src-tauri/src/menu.rs`) emits:
 *  - `native-menu`  → `{ id: string, payload?: any }`
 *  - `native-tray`  → `{ id: "open" | "new-chat" | "quit" | "click" }`
 *
 * Everything here is a no-op outside the Tauri runtime (Vite in a browser),
 * so importing/installing it is always safe.
 */

/** Tauri event name used by the native application menu. */
export const NATIVE_MENU_EVENT = "native-menu";

/** Tauri event name used by the system tray icon/context menu. */
export const NATIVE_TRAY_EVENT = "native-tray";

/** Payload emitted with {@link NATIVE_MENU_EVENT}. */
export interface NativeMenuEventPayload {
  /** kebab-case menu item id, e.g. `new-chat`, `toggle-sidebar`, `zoom-in`. */
  id: string;
  /** Optional extra data (e.g. `open-config-toml` sends `{ path }`). */
  payload?: any;
}

/** Map of menu id → handler. Unknown ids are ignored. */
export interface NativeMenuHandlers {
  [menuId: string]: (payload?: any) => void;
}

/** Map of tray action id → handler. Ids: `open`, `new-chat`, `quit`, `click`. */
export interface TrayHandlers {
  [id: string]: () => void;
}

/**
 * Subscribes to native menu events and dispatches them to `handlers` by id.
 *
 * Returns an unlisten function. Outside Tauri (or if subscription fails) it
 * resolves to a no-op function instead of throwing.
 */
export async function installNativeMenuHandler(
  handlers: NativeMenuHandlers
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  try {
    return await getCurrentWebviewWindow().listen<NativeMenuEventPayload>(
      NATIVE_MENU_EVENT,
      ({ payload: event }) => {
        const id = event?.id;
        if (typeof id !== "string" || !id) return;
        const handler = handlers[id];
        if (typeof handler !== "function") return;
        try {
          handler(event.payload);
        } catch (err) {
          console.error(`[nativeShell] menu handler "${id}" failed:`, err);
        }
      }
    );
  } catch (err) {
    console.warn("[nativeShell] native menu listener unavailable:", err);
    return () => {};
  }
}

/**
 * Subscribes to system tray events (icon click + tray context-menu actions).
 *
 * Returns an unlisten function; safe no-op outside the Tauri runtime.
 */
export async function installTrayHandler(
  handlers: TrayHandlers
): Promise<() => void> {
  try {
    return await tauriListen<{ id: string }>(NATIVE_TRAY_EVENT, (event) => {
      const id = event?.id;
      if (typeof id !== "string" || !id) return;
      const handler = handlers[id];
      if (typeof handler !== "function") return;
      try {
        handler();
      } catch (err) {
        console.error(`[nativeShell] tray handler "${id}" failed:`, err);
      }
    });
  } catch (err) {
    console.warn("[nativeShell] native tray listener unavailable:", err);
    return () => {};
  }
}
