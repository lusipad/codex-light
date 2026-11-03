import React, { useEffect, useRef, useState } from "react";
import { checkPrivateReviewAvailability, type PrivateReviewAvailability } from "../privateReview";

export function PrivateReviewPanel({ url, scope, snapshotId, commitSha, disabled = false }: {
  url: string; scope: string; snapshotId: string; commitSha: string | null; disabled?: boolean;
}) {
  const binding = JSON.stringify([url, scope, snapshotId, commitSha]);
  const current = useRef(binding);
  current.current = binding;
  const operation = useRef<AbortController | null>(null);
  const [view, setView] = useState<{ binding: string; busy: boolean; message: string; error: string; result?: PrivateReviewAvailability }>(
    { binding, busy: false, message: "", error: "" });
  useEffect(() => {
    operation.current?.abort(); operation.current = null;
    setView({ binding, busy: false, message: "", error: "" });
    return () => { operation.current?.abort(); operation.current = null; };
  }, [binding]);
  const start = async () => {
    if (operation.current || disabled) return;
    const controller = new AbortController(); operation.current = controller;
    const valid = () => operation.current === controller && current.current === binding && !controller.signal.aborted;
    setView({ binding, busy: true, message: "正在核对账号和审查工具…", error: "" });
    try {
      const result = await checkPrivateReviewAvailability(url, snapshotId, commitSha, crypto.randomUUID(), controller.signal, event => {
        if (valid() && event.state === "running") setView(previous => ({ ...previous, message: "正在检查所选账号的源码能力…" }));
      });
      if (valid()) setView({ binding, busy: false, result, message: "完整私人审查的前置尚未确认", error: "" });
    } catch (cause) {
      if (valid()) setView({ binding, busy: false, message: "", error: String(cause) });
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const cancel = () => {
    operation.current?.abort(); operation.current = null;
    setView({ binding, busy: false, message: "已请求停止检查", error: "" });
  };
  const visible = view.binding === binding ? view : null;
  return <section className="card-section" aria-label="私人审查">
    <div className="remote-review-comparison-header"><h3>私人审查</h3>
      {visible?.busy ? <button type="button" className="secondary-btn-sm" onClick={cancel}>停止检查</button>
        : <button type="button" className="secondary-btn-sm" disabled={disabled} onClick={() => void start()}>检查审查可用性</button>}
    </div>
    <p className="remote-review-revision">先确认所选账号、固定比较和源码覆盖；本次检查不会启动模型任务。</p>
    {visible?.message && <p role="status">{visible.message}</p>}
    {visible?.error && <p role="alert" className="error-banner">{visible.error}</p>}
    {visible?.result && <>
      <p>{visible.result.reason}</p>
      <ul>{visible.result.missing.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
    </>}
  </section>;
}
