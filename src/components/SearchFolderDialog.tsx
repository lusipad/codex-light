import React, { useEffect, useMemo, useRef, useState } from "react";
import { homeDir, normalize } from "@tauri-apps/api/path";
import { ArrowUp, Folder } from "lucide-react";
import { tauriInvoke } from "../bridge";
import { baseNameFsPath, parentFsPath } from "../fsClient";

type FolderEntry = { name: string; path: string; isDirectory: boolean };

function folderLocation(value: string, editing: boolean) {
  const path = value.trim();
  if (!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path) || /[\r\n\0]/.test(path)) return null;
  const isRoot = /^(?:[a-z]:[\\/]|\/|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?)$/i.test(path);
  const parent = isRoot ? null : parentFsPath(path);
  return editing && parent && !/[\\/]$/.test(path)
    ? { directory: parent, prefix: baseNameFsPath(path), parent }
    : { directory: path, prefix: "", parent };
}

export function SearchFolderDialog({ initialPath, onClose }: { initialPath?: string; onClose: (path?: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [value, setValue] = useState(initialPath ?? "");
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [homeError, setHomeError] = useState(false);
  const location = useMemo(() => folderLocation(value, editing), [value, editing]);
  const directory = location?.directory;
  const [listing, setListing] = useState<{ directory: string; path?: string; entries?: FolderEntry[] }>();
  const current = listing?.directory === directory ? listing : undefined;
  const rows = current?.entries?.filter(entry => entry.name.toLocaleLowerCase().startsWith((location?.prefix ?? "").toLocaleLowerCase())) ?? [];
  const exact = location?.prefix && rows.find(row => row.name.toLocaleLowerCase() === location.prefix.toLocaleLowerCase());
  const confirmed = exact ? exact.path : !editing && selection && current?.entries ? current.path : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (initialPath) return;
    let live = true;
    void homeDir().then(path => { if (live) setValue(current => current || path); }, () => { if (live) setHomeError(true); });
    return () => { live = false; };
  }, [initialPath]);

  useEffect(() => {
    if (!directory) return;
    let live = true;
    void (async () => {
      try {
        const path = await normalize(directory);
        if (!live) return;
        const entries = await tauriInvoke<FolderEntry[]>("fs_list_dir", { path, showHidden: true });
        if (live) setListing({ directory, path, entries: entries.filter(entry => entry.isDirectory)
          .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })) });
      } catch { if (live) setListing({ directory }); }
    })();
    return () => { live = false; };
  }, [directory]);

  const browse = (path: string) => {
    setValue(path);
    setEditing(false);
    setSelection(path);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return <dialog ref={dialogRef} className="search-folder-dialog" aria-label="选择要搜索的文件夹"
    onCancel={event => { event.preventDefault(); if (!composingRef.current) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}>
    <form onSubmit={event => { event.preventDefault(); if (confirmed && !composingRef.current) onClose(confirmed); }}>
      <h2>选择要搜索的文件夹</h2>
      <div className="search-folder-path">
        <button type="button" aria-label="转到上一级文件夹" title="转到上一级文件夹" disabled={!location?.parent}
          onClick={() => { if (location?.parent) browse(location.parent); }}><ArrowUp size={16} /></button>
        <input ref={inputRef} value={value} aria-label="所选文件夹路径" role="combobox" aria-autocomplete="list"
          aria-expanded={rows.length > 0} aria-controls="search-folder-entries" aria-activedescendant={rows[activeIndex] ? `search-folder-option-${activeIndex}` : undefined}
          spellCheck={false} onChange={event => { setValue(event.target.value); setEditing(true); setSelection(undefined); setActiveIndex(-1); }}
          onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Enter") event.stopPropagation(); return; }
            if (rows.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setActiveIndex(index => index < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
                : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
            } else if (event.key === "Enter" && rows[activeIndex]) {
              event.preventDefault(); browse(rows[activeIndex].path);
            }
          }} />
      </div>
      {!editing && !selection && current?.entries && current.path && <button type="button" className="search-folder-current"
        onClick={() => setSelection(current.path)}>选择当前文件夹</button>}
      <div className="search-folder-entries" id="search-folder-entries" role="listbox" aria-label="文件夹">
        {rows.map((row, index) => <button key={row.path} id={`search-folder-option-${index}`} type="button" role="option"
          aria-selected={index === activeIndex} onClick={() => browse(row.path)}><Folder size={16} />{row.name}</button>)}
        {!rows.length && <span role="status">{!location ? (homeError ? "无法加载此文件夹" : "输入完整文件夹路径以进行浏览")
          : !current ? "正在加载文件夹内容…" : !current.entries ? "无法加载此文件夹" : "此目录下没有找到任何文件夹。"}</span>}
      </div>
      <footer><button type="button" onClick={() => onClose()}>取消</button><button type="submit" disabled={!confirmed}>选择</button></footer>
    </form>
  </dialog>;
}
