import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";
import type { ThreadActionItem } from "./components/ThreadActionsMenu";

interface OpenTarget {
  id: string;
  label: string;
  executable: string;
  hidden?: boolean;
  available?: boolean;
}

interface OpenTargetsResponse {
  cwd: string;
  targets: OpenTarget[];
  preferredTarget: string | null;
}

interface WorkspaceOpenTargetsOptions {
  threadId?: string | null;
  cwd?: string | null;
  onError: (message: string) => void;
}

function validTargetsResponse(value: unknown): value is OpenTargetsResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as OpenTargetsResponse;
  const text = (input: unknown): input is string => typeof input === "string" && input.trim().length > 0 && !input.includes("\0");
  if (!text(result.cwd) || !(result.preferredTarget === null || text(result.preferredTarget)) || !Array.isArray(result.targets)) return false;
  const ids = new Set<string>();
  return result.targets.every(target => {
    if (!target || !text(target.id) || !text(target.label) || typeof target.executable !== "string"
      || (target.hidden !== undefined && typeof target.hidden !== "boolean")
      || (target.available !== undefined && typeof target.available !== "boolean") || ids.has(target.id)) return false;
    ids.add(target.id);
    return true;
  });
}

export function useWorkspaceOpenTargets({ threadId, cwd, onError }: WorkspaceOpenTargetsOptions) {
  const [state, setState] = useState<{ context: object; status: "loading" | "error" | "ready"; result?: OpenTargetsResponse } | null>(null);
  const contextRef = useRef({ threadId, cwd });
  if (contextRef.current.threadId !== threadId || contextRef.current.cwd !== cwd) {
    contextRef.current = { threadId, cwd };
  }
  const context = contextRef.current;
  const mountedRef = useRef(true);
  const openRef = useRef(false);
  const queryRef = useRef(0);
  const detectedRef = useRef<{ context: object; targets: OpenTarget[] } | null>(null);
  const pendingRef = useRef(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; queryRef.current += 1; };
  }, []);

  const onMenuOpenChange = useCallback((open: boolean) => {
    openRef.current = open;
    const query = ++queryRef.current;
    if (!open) return;
    detectedRef.current = null;
    setState({ context, status: "loading" });
    // A conversation resolves its latest workspace root in the backend, including worktrees.
    const args = { threadId: threadId || null, cwd: threadId ? null : cwd || null };
    void tauriInvoke<OpenTargetsResponse>("desktop_open_targets", args).then(result => {
      if (!mountedRef.current || contextRef.current !== context || !openRef.current || queryRef.current !== query) return;
      if (!validTargetsResponse(result)) throw new Error("Invalid workspace open targets response");
      const targets = result.targets.filter(target => !target.hidden && target.available !== false);
      detectedRef.current = { context, targets };
      setState({ context, status: "ready", result: { ...result, targets } });
    }).catch(() => {
      if (!mountedRef.current || contextRef.current !== context || !openRef.current || queryRef.current !== query) return;
      setState({ context, status: "error" });
    });
  }, [context, threadId, cwd]);

  const openTarget = useCallback(async (targetId: string) => {
    if (!mountedRef.current || contextRef.current !== context || pendingRef.current) return;
    const detected = detectedRef.current;
    if (detected?.context !== context || !detected.targets.some(target => target.id === targetId)) {
      if (mountedRef.current && contextRef.current === context) errorRef.current("打开目标已不可用，请重新打开菜单后重试。");
      return;
    }
    pendingRef.current = true;
    try {
      await tauriInvoke("desktop_open_workspace", { threadId: threadId || null, cwd: threadId ? null : cwd || null, target: targetId });
    } catch (error) {
      if (mountedRef.current && contextRef.current === context) errorRef.current(`无法打开工作区：${String(error)}`);
    } finally {
      pendingRef.current = false;
    }
  }, [context, threadId, cwd]);

  let items: ThreadActionItem[] | null;
  if (!state || state.context !== context || state.status === "loading") {
    items = [{ id: "open_targets_loading", label: "正在加载打开方式…", disabled: true }];
  } else if (state.status === "error") {
    items = [{ id: "open_targets_error", label: "加载失败，请重新打开菜单", disabled: true }];
  } else {
    items = state.result!.targets.map(target => ({
      id: `open_target:${target.id}`, label: target.label,
      type: "radio", checked: state.result!.preferredTarget === target.id,
    }));
    if (!items.length) items = null;
  }
  return { items, onMenuOpenChange, openTarget };
}
