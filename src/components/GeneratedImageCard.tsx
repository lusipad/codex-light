import React, { useEffect, useRef, useState } from "react";
import type { TurnItem } from "../types";
import { saveGeneratedImageBytes } from "../imageSave";

export function generatedImageState(item: TurnItem, turnStatus?: string) {
  if (item.failure?.type === "usageLimitExceeded") {
    const reset = item.failure.resetsAt;
    const date = typeof reset === "number" ? new Date(reset * 1000) : null;
    return { message: `图片生成额度已用尽（${item.failure.limitId}）${date && Number.isFinite(date.getTime()) ? `，重置时间：${date.toISOString()}` : ""}` };
  }
  if (item.failure || item.status === "failed") {
    return { message: `图片生成失败${item.failure?.message ? `：${item.failure.message}` : ""}` };
  }
  if (["interrupted", "cancelled", "canceled"].includes(item.status || "") ||
    (turnStatus === "interrupted" && item.status !== "completed")) return { message: "图片生成已中断" };
  if (item.status !== "completed") return { message: item.status === "inProgress" ? "图片生成中…" : "图片生成状态尚未确认" };
  const result = typeof item.savedPath === "string" && item.savedPath.trim()
    ? item.savedPath : typeof item.result === "string" ? item.result.trim() : "";
  if (!result) return { message: item.fileId ? "图片已生成，附件内容暂时无法读取" : "图片生成未返回可显示的结果" };
  if (/^(?:[a-z]:[/\\]|\/|\\\\)/i.test(result)) return { message: "生成图片", path: result };
  if (/^(?:https?:\/\/|data:image\/)/i.test(result)) return { message: "生成图片", src: result };
  if (/^[a-z0-9+/\s]+={0,2}$/i.test(result)) return { message: "生成图片", src: `data:image/png;base64,${result.replace(/\s/g, "")}` };
  return { message: "图片结果格式无法识别" };
}

export function GeneratedImageCard({ item, turnStatus, onOpenFile }: {
  item: TurnItem;
  turnStatus?: string;
  onOpenFile: (path: string) => void;
}) {
  const image = generatedImageState(item, turnStatus);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ source: string; message: string; error?: boolean } | null>(null);
  const savingRef = useRef(false);
  const source = image.src || image.path || null;
  const currentSource = useRef(source);
  currentSource.current = source;
  useEffect(() => () => { currentSource.current = null; }, []);
  const save = async () => {
    if (!source || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const path = await saveGeneratedImageBytes(image);
      if (path && currentSource.current === source) setSaveFeedback({ source, message: `已保存：${path}` });
    } catch (error) {
      if (currentSource.current === source) setSaveFeedback({ source, message: `无法保存图片：${String(error)}`, error: true });
    } finally {
      savingRef.current = false;
      if (currentSource.current) setSaving(false);
    }
  };
  return (
    <div className="image-item-card" style={{ flexDirection: "column", alignItems: "flex-start", cursor: "default" }}>
      <span role="status">{image.message}</span>
      {image.path && <button type="button" onClick={() => onOpenFile(image.path!)}>查看图片：{image.path.split(/[/\\]/).pop()}</button>}
      {image.src && (failedSource === image.src
        ? <span role="alert">图片无法加载，请检查结果是否可用。</span>
        : <img src={image.src} alt="生成的图片" style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain" }}
          onError={() => setFailedSource(image.src!)} />)}
      {source && <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存图片…"}</button>}
      {saveFeedback?.source === source && <span role={saveFeedback.error ? "alert" : "status"}>{saveFeedback.message}</span>}
      {item.revisedPrompt && <p>{item.revisedPrompt}</p>}
    </div>
  );
}
