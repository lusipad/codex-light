import React, { useState, useEffect } from "react";
import {
  DownloadIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  CopyIcon,
  ExternalWindowIcon,
} from "./Icons";
import { MarkdownView } from "./MarkdownView";
import "./LibraryView.css";

export interface LibraryItem {
  id: string;
  name: string;
  type: "markdown" | "image" | "code" | "data";
  size: string;
  folder: string;
  favorite: boolean;
  updatedAt: number;
  content?: string;
  url?: string;
}

const DEFAULT_LIBRARY_ITEMS: LibraryItem[] = [
  {
    id: "lib-1",
    name: "Codex Native 架构设计说明.md",
    type: "markdown",
    size: "4.8 KB",
    folder: "研发文档",
    favorite: true,
    updatedAt: Date.now() - 3600000 * 2,
    content: `# Codex Native 桌面端系统架构

## 核心设计理念
1. **轻量高性能**：采用 Tauri 2.0 (Rust) + React 18 + TypeScript，无 Electron 笨重开销。
2. **1:1 官方工作面对齐**：全量实现 Composer、Worktree、Appshot、Side Chat、Sites、Library、Cloud Environments。
3. **协议真实解算**：原生对接 Codex App Server stdio JSON-RPC，双向支持通知与状态回执。
`,
  },
  {
    id: "lib-2",
    name: "API 接口契约协议规范.md",
    type: "markdown",
    size: "12.4 KB",
    folder: "研发文档",
    favorite: false,
    updatedAt: Date.now() - 3600000 * 24,
    content: `# 接口契约与数据流定义

- \`thread/list\` & \`thread/resume\`
- \`composer/prompt\` & \`turn/interrupt\`
- \`git/worktrees\` & \`git/status\`
`,
  },
  {
    id: "lib-3",
    name: "应用原型图.svg",
    type: "image",
    size: "8.2 KB",
    folder: "设计资源",
    favorite: true,
    updatedAt: Date.now() - 3600000 * 48,
    url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%2319191c'/><circle cx='200' cy='150' r='60' fill='%2310a37f'/><text x='200' y='155' font-size='16' fill='%23ffffff' text-anchor='middle'>Library Spec</text></svg>",
  },
  {
    id: "lib-4",
    name: "benchmarks.json",
    type: "data",
    size: "2.1 KB",
    folder: "测试数据",
    favorite: false,
    updatedAt: Date.now() - 3600000 * 72,
    content: `{\n  "startup_ms": 140,\n  "memory_rss_mb": 62.4,\n  "protocol_probes_passed": 87\n}`,
  },
];

export interface LibraryViewProps {
  onInsertToChat?: (file: LibraryItem) => void;
  onNavigateSites?: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onInsertToChat,
  onNavigateSites,
}) => {
  const [items, setItems] = useState<LibraryItem[]>(() => {
    try {
      const saved = localStorage.getItem("codex_library_items");
      return saved ? JSON.parse(saved) : DEFAULT_LIBRARY_ITEMS;
    } catch {
      return DEFAULT_LIBRARY_ITEMS;
    }
  });

  const [activeCategory, setActiveCategory] = useState<
    "all" | "recommended" | "favorites" | "folders" | "images" | "space"
  >("all");
  const [selectedFolder, setSelectedFolder] = useState<string>("全部");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);

  // New Note Modal
  const [showNewNote, setShowNewNote] = useState<boolean>(false);
  const [newNoteTitle, setNewNoteTitle] = useState<string>("");
  const [newNoteContent, setNewNoteContent] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("codex_library_items", JSON.stringify(items));
  }, [items]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const toggleFavorite = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      )
    );
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    if (selectedItem?.id === id) setSelectedItem(null);
    notify("文件已删除");
  };

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim()) return;

    const newItem: LibraryItem = {
      id: `note-${Date.now()}`,
      name: newNoteTitle.endsWith(".md") ? newNoteTitle : `${newNoteTitle}.md`,
      type: "markdown",
      size: `${(newNoteContent.length / 1024).toFixed(1)} KB`,
      folder: "研发文档",
      favorite: false,
      updatedAt: Date.now(),
      content: newNoteContent,
    };

    setItems([newItem, ...items]);
    setShowNewNote(false);
    setNewNoteTitle("");
    setNewNoteContent("");
    notify(`✓ 笔记「${newItem.name}」已创建`);
  };

  const folders = ["全部", ...Array.from(new Set(items.map((i) => i.folder)))];

  const filteredItems = items.filter((item) => {
    if (activeCategory === "favorites" && !item.favorite) return false;
    if (activeCategory === "images" && item.type !== "image") return false;
    if (activeCategory === "recommended" && !item.favorite && item.type !== "markdown") return false;
    if (selectedFolder !== "全部" && item.folder !== selectedFolder) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.folder.toLowerCase().includes(q) ||
        (item.content && item.content.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="library-view-container">
      {toast && <div className="workbench-toast-banner">{toast}</div>}

      <div className="library-view-header">
        <div>
          <h2>资料库与 Space (Library & Space)</h2>
          <p className="subtitle">
            统一沉淀项目架构文档、生成原型图、会话附录与 Space 协作文件，支持快速检索与会话引用。
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              // Mock quick upload
              const fakeUpload: LibraryItem = {
                id: `upload-${Date.now()}`,
                name: `imported-asset-${Math.floor(Math.random() * 900 + 100)}.json`,
                type: "data",
                size: "3.2 KB",
                folder: "上传文件",
                favorite: false,
                updatedAt: Date.now(),
                content: `{\n  "imported": true,\n  "timestamp": ${Date.now()}\n}`,
              };
              setItems([fakeUpload, ...items]);
              notify(`✓ 已从本地导入「${fakeUpload.name}」`);
            }}
          >
            <DownloadIcon size={14} /> 上传文件
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setShowNewNote(true)}
          >
            <PlusIcon size={14} /> 新建笔记
          </button>
        </div>
      </div>

      {/* Categories Bar */}
      <div className="library-tabs-bar">
        <div className="category-chips">
          {(
            [
              { id: "all", label: "全部文件" },
              { id: "recommended", label: "推荐" },
              { id: "favorites", label: "收藏星标" },
              { id: "images", label: "图像生成" },
              { id: "space", label: "Space 空间" },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              className={`cat-chip ${activeCategory === c.id ? "active" : ""}`}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.label}
              {c.id === "space" && <span className="space-badge">协作</span>}
            </button>
          ))}
        </div>

        <div className="library-search-wrap">
          <SearchIcon size={14} />
          <input
            type="text"
            placeholder="搜索资料库内容、笔记与资源…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="library-layout-toggle">
          <button
            type="button"
            className={`layout-btn ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="网格视图"
          >
            ⊞
          </button>
          <button
            type="button"
            className={`layout-btn ${viewMode === "list" ? "active" : ""}`}
            onClick={() => setViewMode("list")}
            title="列表视图"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Folders filter strip */}
      <div className="folders-filter-strip">
        <span className="folder-label">文件夹：</span>
        {folders.map((f) => (
          <button
            key={f}
            type="button"
            className={`folder-pill ${selectedFolder === f ? "active" : ""}`}
            onClick={() => setSelectedFolder(f)}
          >
            📁 {f}
          </button>
        ))}
      </div>

      {/* Main Content */}
      {filteredItems.length === 0 ? (
        <div className="library-empty">
          <FolderIcon size={36} />
          <p>当前分类下暂无文件</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="library-grid">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="library-card"
              onClick={() => setSelectedItem(item)}
            >
              <div className="library-card-header">
                <span className="file-type-badge">{item.type}</span>
                <button
                  type="button"
                  className={`star-btn ${item.favorite ? "starred" : ""}`}
                  onClick={(e) => toggleFavorite(item.id, e)}
                  title={item.favorite ? "取消收藏" : "加入收藏"}
                >
                  ★
                </button>
              </div>

              {item.type === "image" && item.url ? (
                <div className="library-thumbnail">
                  <img src={item.url} alt={item.name} />
                </div>
              ) : (
                <div className="library-card-icon">
                  <span className="icon-emoji">
                    {item.type === "markdown" ? "📝" : "📄"}
                  </span>
                </div>
              )}

              <div className="library-card-body">
                <strong className="item-name" title={item.name}>
                  {item.name}
                </strong>
                <div className="item-meta">
                  <span>{item.folder}</span>
                  <span>{item.size}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="library-list-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>名称</th>
                <th>类型</th>
                <th>文件夹</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} onClick={() => setSelectedItem(item)}>
                  <td>
                    <button
                      type="button"
                      className={`star-btn ${item.favorite ? "starred" : ""}`}
                      onClick={(e) => toggleFavorite(item.id, e)}
                    >
                      ★
                    </button>
                  </td>
                  <td className="bold-cell">{item.name}</td>
                  <td>{item.type}</td>
                  <td>📁 {item.folder}</td>
                  <td>{item.size}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {onInsertToChat && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          onInsertToChat(item);
                          notify(`✓ 已将「${item.name}」引用至会话输入框`);
                        }}
                      >
                        引用
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-btn danger-link"
                      onClick={() => handleDelete(item.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* File Preview Modal */}
      {selectedItem && (
        <div className="preview-modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <div>
                <h3>{selectedItem.name}</h3>
                <span className="meta-hint">
                  {selectedItem.folder} · {selectedItem.size} ·{" "}
                  {new Date(selectedItem.updatedAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="preview-modal-body">
              {selectedItem.type === "image" && selectedItem.url ? (
                <div className="preview-image-wrap">
                  <img src={selectedItem.url} alt={selectedItem.name} />
                </div>
              ) : selectedItem.content ? (
                <div className="preview-markdown-wrap">
                  <MarkdownView content={selectedItem.content} />
                </div>
              ) : (
                <div className="preview-empty-hint">暂无法渲染该文件预览</div>
              )}
            </div>

            <div className="preview-modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => toggleFavorite(selectedItem.id)}
              >
                {selectedItem.favorite ? "★ 已收藏" : "☆ 收藏"}
              </button>
              {onInsertToChat && (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    onInsertToChat(selectedItem);
                    setSelectedItem(null);
                    notify(`✓ 已将「${selectedItem.name}」引用至输入框`);
                  }}
                >
                  <SparklesIcon size={14} /> 引用此文件至会话
                </button>
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setSelectedItem(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Note Modal */}
      {showNewNote && (
        <div className="preview-modal-overlay" onClick={() => setShowNewNote(false)}>
          <div className="note-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <h3>新建 Markdown 笔记</h3>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowNewNote(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateNote}>
              <div className="note-input-group">
                <input
                  type="text"
                  required
                  placeholder="笔记文件名 (例如：架构决策日志.md)"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                />
              </div>
              <div className="note-input-group">
                <textarea
                  rows={10}
                  placeholder="在此输入 Markdown 正文内容…"
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                />
              </div>
              <div className="preview-modal-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowNewNote(false)}
                >
                  取消
                </button>
                <button type="submit" className="primary-btn">
                  保存笔记
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
