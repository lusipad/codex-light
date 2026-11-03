import React, { useEffect, useMemo, useRef, useState } from "react";
import { readPinnedReviewFile, serviceIdentity } from "../chatgptService";
import type { PinnedReviewComparison, PinnedReviewFile } from "../remoteReview";
import { matchesRemoteFilePatch, parseRemoteDiffFiles } from "../remoteDiffPaths";
import "./RemoteRevisionFiles.css";

type FileState = { open: boolean; busy: boolean; value?: PinnedReviewFile["file"]; error?: string };

export function RemoteRevisionFiles({ url, scope, value, commitSha, disabled = false }: {
  url: string; scope: string; value: PinnedReviewComparison; commitSha: string | null; disabled?: boolean;
}) {
  const binding = JSON.stringify([url, scope, value.snapshotId, commitSha, value.comparison, value.account, value.diff.unifiedDiff]);
  const current = useRef(binding); current.current = binding;
  const requests = useRef(new Map<number, AbortController>());
  const [loaded, setLoaded] = useState<{ binding: string; files: Record<number, FileState> }>({ binding, files: {} });
  const files = useMemo(() => parseRemoteDiffFiles(value.diff.unifiedDiff), [value.diff.unifiedDiff]);
  const states = loaded.binding === binding ? loaded.files : {};
  useEffect(() => {
    setLoaded({ binding, files: {} });
    return () => { requests.current.forEach(controller => controller.abort()); requests.current.clear(); };
  }, [binding]);
  const update = (index: number, state: FileState) => setLoaded(previous => ({ binding,
    files: { ...(previous.binding === binding ? previous.files : {}), [index]: state } }));
  const load = async (index: number) => {
    const file = files[index], controller = new AbortController();
    requests.current.get(index)?.abort(); requests.current.set(index, controller);
    const valid = () => current.current === binding && !controller.signal.aborted && requests.current.get(index) === controller;
    update(index, { open: true, busy: true });
    try {
      const identity = await serviceIdentity(controller.signal);
      if (!valid()) return;
      const result = await readPinnedReviewFile(url, identity, controller.signal, value.snapshotId, commitSha, file.basePath, file.headPath);
      if (!valid()) return;
      const content = result.file.status === "success" && ((file.basePath === null && result.file.baseContent !== "") ||
        (file.headPath === null && result.file.headContent !== "") || !matchesRemoteFilePatch(file.patch, result.file.baseContent, result.file.headContent))
        ? { status: "unavailable" as const, reason: "完整文件与固定差异不匹配，无法展开上下文。" } : result.file;
      update(index, { open: true, busy: false, value: content });
    } catch (cause) { if (valid()) update(index, { open: true, busy: false, error: String(cause) }); }
    finally { if (requests.current.get(index) === controller) requests.current.delete(index); }
  };
  if (!files.length) return null;
  return <section className="remote-revision-files" aria-label="固定版本完整文件">
    <p className="remote-review-revision">差异中可识别文件；此列表不保证包含被省略的文件。</p>
    {files.map((file, index) => {
      const state = states[index];
      return <article className="remote-revision-file" key={index}>
        <button type="button" className="remote-revision-file-toggle" aria-expanded={state?.open ?? false} disabled={disabled || file.unavailable}
          onClick={() => {
            if (state?.open) { requests.current.get(index)?.abort(); update(index, { ...state, open: false, busy: false }); }
            else if (state?.value) update(index, { ...state, open: true });
            else void load(index);
          }}>{state?.open ? "▾" : "▸"} {file.basePath && file.headPath && file.basePath !== file.headPath ? `${file.basePath} → ${file.headPath}` : file.label}</button>
        {file.unavailable && <p role="status">二进制或路径不完整，无法读取完整文件。</p>}
        {state?.open && <div className="remote-revision-file-content">
          {state.busy && <p role="status">正在读取固定版本完整文件…</p>}
          {state.error && <><p role="alert" className="error-banner">{state.error}</p><button type="button" className="secondary-btn-sm" disabled={disabled} onClick={() => void load(index)}>重试读取文件</button></>}
          {state.value?.status === "unavailable" && <p role="status">完整文件不可用。{state.value.reason}</p>}
          {state.value?.status === "success" && <div className="remote-revision-file-sides">
            {(["base", "head"] as const).map(side => {
              const path = side === "base" ? file.basePath : file.headPath;
              const content = state.value?.status === "success" ? (side === "base" ? state.value.baseContent : state.value.headContent) : "";
              return <section key={side} aria-label={side === "base" ? "原版本完整文件" : "新版本完整文件"}>
                <h4>{side === "base" ? "原版本" : "新版本"} · {path ?? "此版本不存在文件"}</h4>
                {path !== null && (content ? <pre tabIndex={0}>{content}</pre> : <p role="status">空文件</p>)}
              </section>;
            })}
          </div>}
        </div>}
      </article>;
    })}
  </section>;
}
