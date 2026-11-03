import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";

interface EnvironmentSnapshot {
  path: string;
  fileName: string;
  files: string[];
  exists: boolean;
  content: string;
  expectedContent: string | null;
  schemaError: string | null;
  environment: { name: string; actions: { name: string; command: string; platform: string | null }[] } | null;
}

export function LocalEnvironmentSettings({ cwd, onRunCommand }: {
  cwd: string;
  onRunCommand: (cwd: string, command: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const dirty = snapshot !== null && draft !== snapshot.content;
  const load = async (fileName?: string) => {
    if (operation.current || !cwd) return;
    if (dirty && !window.confirm("放弃未保存的环境修改并重新读取？")) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await tauriInvoke<EnvironmentSnapshot>("local_environment_read", { cwd, fileName: fileName ?? null });
      if (version !== generation.current) return;
      setSnapshot(result); setDraft(result.content);
    } catch (error) {
      if (version === generation.current) setError(`读取环境失败：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void load();
    return () => { generation.current += 1; operation.current = false; };
  }, []);
  const save = async () => {
    if (operation.current || !snapshot) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const saved = await tauriInvoke<EnvironmentSnapshot>("local_environment_save", {
        cwd, fileName: snapshot.fileName, content: draft, expectedContent: snapshot.expectedContent,
      });
      if (version !== generation.current) return;
      if (saved.content !== draft) throw Error("保存读回不一致，请重新读取。");
      setSnapshot(saved); setDraft(saved.content); setMessage("已保存并读回核验。");
    } catch (error) {
      if (version === generation.current) setError(`保存环境失败：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  const run = async (index: number) => {
    if (operation.current || !snapshot?.exists || dirty || snapshot.schemaError) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const command = await tauriInvoke<string>("local_environment_action", {
        cwd, fileName: snapshot.fileName, expectedContent: snapshot.content, index,
      });
      if (version !== generation.current) return;
      onRunCommand(cwd, command);
      setMessage("动作已排队，请查看终端中的执行输出。");
    } catch (error) {
      if (version === generation.current) setError(`运行环境动作失败：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>本地环境</h3>
    <p className="card-subtitle-desc">编辑当前项目的环境配置，或在终端运行已保存的环境动作。</p>
    {!cwd && <p>请先选择工作区。</p>}
    {error && <div role="alert" className="error-banner">{error}</div>}
    {message && <div role="status" className="success-banner">{message}</div>}
    <button type="button" className="secondary-btn" disabled={busy || !cwd} onClick={() => void load(snapshot?.fileName)}>重新读取</button>
    {snapshot && <>
      <label>环境文件
        <select aria-label="环境文件" disabled={busy} value={snapshot.fileName} onChange={e => void load(e.target.value)}>
          {[...new Set([...snapshot.files, snapshot.fileName])].map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <p><code>{snapshot.path}</code>{snapshot.exists ? "" : "（尚未创建）"}</p>
      {snapshot.schemaError && <p role="alert">{snapshot.schemaError}</p>}
      <textarea aria-label="环境 TOML" className="code-editor-textarea" style={{ minHeight: 260 }} disabled={busy} value={draft} onChange={e => { setDraft(e.target.value); setMessage(null); }} />
      <button type="button" className="primary-btn" disabled={busy} onClick={() => void save()}>保存环境</button>
      <h3>环境动作</h3>
      {dirty && <p>请先保存修改，再运行动作。</p>}
      {snapshot.environment?.actions.map((action, index) =>
        <div className="item-card" key={index}><div className="item-card-main">
          <strong>{action.name}</strong><p><code>{action.command}</code></p>
          <span>{action.platform || "全部平台"}</span>
          <button type="button" className="secondary-btn" disabled={busy || dirty || !snapshot.exists || !!snapshot.schemaError} onClick={() => void run(index)}>运行 {action.name}</button>
        </div></div>)}
      {snapshot.environment?.actions.length === 0 && <p>尚未配置环境动作。</p>}
    </>}
  </div></div>;
}
