import { useEffect, useRef, useState } from "react";
import { callAppServer, tauriListen } from "./bridge";
import { copyTextToClipboard } from "./clipboard";
import { bytesToBase64 } from "./fsClient";
import { createShareAssetReader } from "./shareAssetReader";
import { decodeShareRecipients, readShareAccess, type ShareAccount, type ShareRecipient } from "./shareAccess";
import {
  discardSharedThread, prepareSharedThread, publishSharedThread, readChatgptService,
  serviceErrorMessage, type SharedThreadAudience, type SharedThreadPreparation,
} from "./chatgptService";
import { prepareShareThread } from "./prepareShareThread";
import type { ShareSnapshot } from "./shareSnapshot";

export type { ShareAccount, ShareRecipient } from "./shareAccess";
type Phase = "loading" | "prepared" | "creating" | "ready" | "error" | "unknown" | "unavailable";

export function useShareThreadSession(threadId: string, onClose: () => void) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [account, setAccount] = useState<ShareAccount | null>(null);
  const [audience, setAudience] = useState<SharedThreadAudience>({ access: "public", principals: [] });
  const [query, setQueryState] = useState("");
  const [selected, setSelected] = useState<ShareRecipient[]>([]);
  const [results, setResults] = useState<ShareRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const preparation = useRef<SharedThreadPreparation | null>(null);
  const controller = useRef<AbortController | null>(null);
  const singleFlight = useRef(false);
  const automaticInvited = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;
    let owned: SharedThreadPreparation | null = null;
    setPhase("loading"); setError(null); setSnapshot(null); setShareUrl(null);
    setCopyFailed(false); setAccount(null); setSelected([]); setQueryState("");
    automaticInvited.current = false;
    const release = () => {
      pending.abort();
      if (owned) {
        void discardSharedThread(owned.preparationId, owned.identity).catch(() => {});
        if (preparation.current === owned) preparation.current = null;
        owned = null;
      }
    };
    const listener = tauriListen("chatgpt-service:invalidated", () => { release(); close.current(); });
    void (async () => {
      try {
        const access = await readShareAccess(pending.signal);
        pending.signal.throwIfAborted();
        if (!access.gate || !access.account) {
          setPhase("unavailable"); setError("当前账号暂不支持分享聊天。"); return;
        }
        setAccount(access.account);
        setAudience({ access: access.account.kind === "workspace" ? "workspace" : "public", principals: [] });
        const prepared = await prepareShareThread({ threadId, signal: pending.signal }, {
          request: callAppServer, readAsset: createShareAssetReader(access.identity),
        });
        pending.signal.throwIfAborted();
        const result = await prepareSharedThread(threadId, prepared.json, prepared.assets.map(asset => ({
          assetId: asset.assetId, mimeType: asset.mimeType, bytesBase64: bytesToBase64(asset.bytes),
        })), access.identity, pending.signal);
        owned = result;
        if (pending.signal.aborted) { release(); return; }
        preparation.current = result;
        setSnapshot(prepared.redactedSnapshot);
        setPhase("prepared");
      } catch (failure) {
        if (!pending.signal.aborted) { setError(serviceErrorMessage(failure)); setPhase("error"); }
      }
    })();
    return () => { release(); void listener.then(unlisten => unlisten()).catch(() => {}); };
  }, [threadId, attempt]);

  useEffect(() => {
    setResults([]); setSearchError(null); setSearching(false);
    const prepared = preparation.current;
    if (phase !== "prepared" || account?.kind !== "workspace" || !prepared || !query.trim()) return;
    const pending = new AbortController();
    const cancel = () => pending.abort();
    const session = controller.current;
    session?.signal.addEventListener("abort", cancel, { once: true });
    let timeout: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setSearching(true);
      timeout = setTimeout(() => {
        pending.abort();
        if (!session?.signal.aborted) { setSearching(false); setSearchError("成员搜索超时，请重新输入。"); }
      }, 15000);
      void Promise.all([
        readChatgptService("share_users", { query: query.trim() }, prepared.identity, pending.signal),
        readChatgptService("share_groups", { query: query.trim() }, prepared.identity, pending.signal),
      ]).then(([users, groups]) => {
        pending.signal.throwIfAborted();
        setResults(decodeShareRecipients(users, groups, account.accountUserId).filter(item => !selected.some(value => value.id === item.id)));
      }).catch(failure => {
        if (!pending.signal.aborted) {
          setSearchError(serviceErrorMessage(failure));
          pending.abort();
          setSearching(false);
        }
      }).finally(() => {
        clearTimeout(timeout);
        if (!pending.signal.aborted) setSearching(false);
      });
    }, 150);
    return () => {
      clearTimeout(timer); clearTimeout(timeout); pending.abort();
      session?.signal.removeEventListener("abort", cancel);
    };
  }, [phase, query, account, selected]);

  const setAccess = (access: SharedThreadAudience["access"]) => {
    if (phase !== "prepared" || account?.kind !== "workspace" || access === "public") return;
    automaticInvited.current = false;
    if (access === "workspace") { setSelected([]); setQueryState(""); }
    setAudience({ access, principals: access === "invited" ? selected.map(item => item.principal) : [] });
  };
  const addRecipient = (recipient: ShareRecipient) => {
    if (phase !== "prepared" || !results.some(item => item.id === recipient.id) || selected.some(item => item.id === recipient.id)) return;
    if (audience.access === "workspace") automaticInvited.current = true;
    const next = [...selected, recipient];
    setSelected(next); setQueryState("");
    setAudience({ access: "invited", principals: next.map(item => item.principal) });
  };
  const removeRecipient = (id: string) => {
    if (phase !== "prepared") return;
    const next = selected.filter(item => item.id !== id);
    setSelected(next);
    setAudience({
      access: !next.length && automaticInvited.current ? "workspace" : audience.access,
      principals: next.map(item => item.principal),
    });
  };
  const publishOrCopy = async () => {
    const pending = controller.current;
    if (!pending || pending.signal.aborted || singleFlight.current) return;
    if (phase !== "ready" && (phase !== "prepared" || query.trim() ||
      (audience.access === "invited" && !selected.length) || !preparation.current)) return;
    singleFlight.current = true;
    try {
      let url = shareUrl;
      if (phase === "prepared") {
        setPhase("creating"); setError(null);
        try {
          const published = await publishSharedThread(threadId, preparation.current!, audience, pending.signal);
          pending.signal.throwIfAborted();
          url = published.shareUrl; setShareUrl(url); setPhase("ready");
        } catch (failure) {
          if (pending.signal.aborted) return;
          const code = (failure as { code?: string })?.code;
          // Only definite rejections permit another publish attempt with the same preparation.
          const rejected = ["forbidden", "unauthorized", "invalid_request", "rate_limited"].includes(code ?? "");
          setPhase(rejected ? "prepared" : "unknown");
          setError(rejected ? serviceErrorMessage(failure) : "无法确认分享是否已发布，请勿重复发布。");
          return;
        }
      }
      if (url) {
        const copied = await copyTextToClipboard(url);
        if (!pending.signal.aborted) {
          setCopyFailed(!copied);
          if (copied) close.current();
        }
      }
    } finally { singleFlight.current = false; }
  };
  return {
    phase, error, snapshot, shareUrl, copyFailed, account, audience, query, selected, results, searching, searchError,
    retry: () => { if (phase === "error") setAttempt(value => value + 1); },
    publishOrCopy, setAccess,
    setQuery: (value: string) => { if (phase === "prepared") setQueryState(value); },
    addRecipient, removeRecipient,
  };
}
