import { callAppServer, tauriInvoke, tauriListen } from "./bridge";

interface PendingLink { generation: number; threadId: string }

/** Install only after main's event subscription and app-server are ready. */
export async function installDeepLinkReceiver(options: {
  signal: AbortSignal;
  navigationRevision: () => string | number;
  selectThread: (threadId: string) => Promise<void>;
  onError: (message: string) => void;
}): Promise<() => void> {
  let observed = 0;
  let operation = 0;
  let epoch = 0;
  let enabled = true;
  const invalidateContext = () => { epoch++; operation++; observed = 0; };
  const stop = () => { enabled = false; invalidateContext(); };
  options.signal.addEventListener("abort", stop, { once: true });
  const wake = async () => {
    let attempt: number | null = null;
    const context = epoch;
    const revision = options.navigationRevision();
    const current = () => enabled && !options.signal.aborted && context === epoch && (attempt === null || attempt === operation);
    try {
      const pending = await tauriInvoke<PendingLink | null>("deep_link_pending");
      if (!current() || !pending || pending.generation <= observed) return;
      observed = pending.generation;
      attempt = ++operation;
      let failure: unknown;
      try {
        const result = await callAppServer("thread/read", { threadId: pending.threadId, includeTurns: false });
        if (result?.thread?.id !== pending.threadId) throw Error("目标会话不存在或不可用。");
      } catch (error) { failure = error; }
      if (!current()) return;
      const accepted = await tauriInvoke<boolean>("deep_link_acknowledge", { generation: pending.generation });
      if (!current()) return;
      if (!accepted) { void wake(); return; }
      // Later manual navigation wins over a URL whose metadata was still loading.
      if (revision !== options.navigationRevision()) return;
      if (failure) { options.onError(`无法打开会话链接：${String(failure)}`); return; }
      await options.selectThread(pending.threadId);
    } catch (error) {
      if (current() && revision === options.navigationRevision()) options.onError(`无法接收会话链接：${String(error)}`);
    }
  };
  let unlisten: (() => void) | undefined;
  let invalidate: (() => void) | undefined;
  try {
    unlisten = await tauriListen("native-deep-link", () => { void wake(); });
    invalidate = await tauriListen("chatgpt-service:invalidated", invalidateContext);
    if (!options.signal.aborted) void wake();
  } catch (error) {
    unlisten?.();
    options.signal.removeEventListener("abort", stop);
    if (!options.signal.aborted) options.onError(`无法监听会话链接：${String(error)}`);
  }
  return () => {
    stop(); unlisten?.(); invalidate?.();
    options.signal.removeEventListener("abort", stop);
  };
}
