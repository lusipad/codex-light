import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function tauriInvoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri runtime required for command: ${cmd}`);
  }
  return invoke<T>(cmd, args);
}

export async function tauriListen<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<T>(event, (ev) => handler(ev.payload));
}

export async function callAppServer<T = any>(
  method: string,
  params?: any
): Promise<T> {
  return tauriInvoke<T>("app_server_call", {
    method,
    params: params === undefined ? null : params,
  });
}
