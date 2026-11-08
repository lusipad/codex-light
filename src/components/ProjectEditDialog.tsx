import React, { useEffect, useRef, useState } from "react";
import { isTauriRuntime, tauriInvoke } from "../bridge";
import { baseNameFsPath, getMetadata } from "../fsClient";
import type { Project, ProjectPatch } from "../projects";
import { CloseIcon, FolderIcon } from "./Icons";

export function ProjectEditDialog({ project, onSave, onRemove, onClose }: {
  project: Project;
  onSave: (patch: ProjectPatch) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [roots, setRoots] = useState(() => project.roots.map(root => root.path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const composing = useRef(false);
  const mounted = useRef(false);

  function appendRoots(paths: string[]) {
    setRoots(previous => {
      const seen = new Set<string>();
      return [...previous, ...paths].filter(path => {
        const key = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    mounted.current = true;
    dialog?.showModal();
    return () => {
      mounted.current = false;
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const stop = await getCurrentWebview().onDragDropEvent(async ({ payload }) => {
        if (disposed || pending.current || payload.type !== "drop") return;
        const rect = sourcesRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = payload.position.x / window.devicePixelRatio;
        const y = payload.position.y / window.devicePixelRatio;
        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return;
        const folders = await Promise.all(payload.paths.map(async path => {
          try { return (await getMetadata(path)).isDirectory ? path : null; }
          catch { return null; }
        }));
        if (!disposed && !pending.current) appendRoots(folders.filter((path): path is string => path !== null));
      });
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const dismiss = () => { if (!pending.current && !composing.current) onClose(); };
  const run = async (operation: () => Promise<boolean>, message: string) => {
    if (pending.current || composing.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (await operation() && mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(`${message}：${String(reason)}`);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="project-edit-dialog" aria-labelledby="project-edit-title"
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onMouseDown={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}>
    <form onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onSubmit={event => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const patch: ProjectPatch = {};
        if (trimmed !== project.name) patch.name = trimmed;
        if (roots.length !== project.roots.length || roots.some((path, index) => path !== project.roots[index]?.path)) {
          patch.roots = roots.map(path => ({ path }));
        }
        void run(async () => {
          if (patch.name !== undefined || patch.roots !== undefined) await onSave(patch);
          return true;
        }, "项目保存失败");
      }}>
      <h2 id="project-edit-title">编辑项目</h2>
      <fieldset disabled={busy}>
        <label className="form-field">名称
          <input type="text" placeholder="项目名称" autoFocus value={name} onChange={event => setName(event.target.value)} />
        </label>
        <div ref={sourcesRef} className="project-edit-sources" aria-label="源文件夹" role="group">
          <span>源文件夹</span>
          <div className="project-edit-folders">
            {roots.map((path, index) => {
              const label = baseNameFsPath(path) || path;
              return <div className="project-edit-folder" key={path}>
                <FolderIcon size={16} />
                <span title={path}>{label}</span>
                {index === 0 ? <small>主要</small> : <button type="button" className="secondary-pill-action-btn"
                  aria-label={`将 ${label} 设为主要`} onClick={() => setRoots(previous => [path, ...previous.filter(root => root !== path)])}>设为主要</button>}
                <button type="button" className="thread-icon-btn" aria-label={`移除 ${label}`}
                  onClick={() => setRoots(previous => previous.filter(root => root !== path))}><CloseIcon size={14} /></button>
              </div>;
            })}
            <button type="button" className="secondary-pill-action-btn" onClick={() => void run(async () => {
              const paths = await tauriInvoke<string[]>("pick_project_source_folders");
              if (mounted.current) appendRoots(paths);
              return false;
            }, "选择文件夹失败")}>添加文件夹</button>
          </div>
        </div>
      </fieldset>
      {error && <p className="project-edit-error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="secondary-pill-action-btn project-edit-remove" disabled={busy}
          onClick={onRemove}>移除本地项目</button>
        <div>
          <button type="button" className="secondary-pill-action-btn" disabled={busy} onClick={dismiss}>取消</button>
          <button type="submit" className="primary-pill-action-btn" disabled={busy || !name.trim()}>保存</button>
        </div>
      </footer>
    </form>
  </dialog>;
}

export function ProjectRemoveDialog({ name, onRemove, onClose, fallbackRef }: {
  name: string;
  onRemove: () => Promise<void>;
  onClose: () => void;
  fallbackRef: React.RefObject<HTMLInputElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      (trigger?.isConnected ? trigger : fallbackRef.current)?.focus({ preventScroll: true });
    };
  }, [fallbackRef]);
  const dismiss = () => { if (!pending.current) onClose(); };
  return <dialog ref={dialogRef} className="project-edit-dialog project-remove-dialog"
    aria-labelledby="project-remove-title" aria-describedby="project-remove-description" aria-busy={busy}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onMouseDown={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(false);
      try {
        await onRemove();
      } catch {
        setError(true);
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }}>
      <h2 id="project-remove-title">移除 {name}？</h2>
      <p id="project-remove-description">这只会从应用中移除该项目。你电脑上的文件和现有聊天不会被删除。</p>
      {error && <p role="alert" className="project-edit-error">未成功移除 {name}</p>}
      <footer>
        <button ref={cancelRef} type="button" className="secondary-pill-action-btn" disabled={busy} onClick={dismiss}>取消</button>
        <button type="submit" className="secondary-pill-action-btn project-edit-remove" disabled={busy}>{busy ? "移除中…" : "移除项目"}</button>
      </footer>
    </form>
  </dialog>;
}
