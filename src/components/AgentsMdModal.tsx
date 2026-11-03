import React, { useState } from "react";
import { CloseIcon, CheckIcon } from "./Icons";
import { tauriInvoke } from "../bridge";

export interface AgentsMdModalProps {
  cwd: string;
  initialContent: string;
  onClose: () => void;
  onSaved?: (newContent: string) => void;
}

export const AgentsMdModal: React.FC<AgentsMdModalProps> = ({
  cwd,
  initialContent,
  onClose,
  onSaved,
}) => {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const filePath = `${cwd.replace(/[/\\]+$/, "")}/AGENTS.md`;
      await tauriInvoke("fs_write_file", { path: filePath, content });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
      if (onSaved) onSaved(content);
    } catch (e) {
      console.error("Failed to save AGENTS.md:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="codex-modal-overlay" onClick={onClose}>
      <div
        className="codex-modal-dialog"
        style={{ width: 850, height: 600, flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>📜 AGENTS.md 工作区指引规范</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{cwd}/AGENTS.md</span>
          </div>
          <button className="modal-close-btn" style={{ position: "static" }} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column" }}>
          <textarea
            style={{
              flex: 1,
              width: "100%",
              background: "#181818",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              lineHeight: 1.6,
              padding: 14,
              resize: "none",
              outline: "none",
            }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# AGENTS.md 指引规范..."
          />
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          {savedSuccess && (
            <span style={{ fontSize: "calc(12.5px * var(--font-ui-scale, 1))", color: "#22c55e", display: "flex", alignItems: "center", gap: 4 }}>
              <CheckIcon size={14} /> 已保存
            </span>
          )}
          <button
            type="button"
            className="btn-outline"
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border-default)", color: "var(--text-primary)", background: "transparent", cursor: "pointer" }}
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: "6px 18px", borderRadius: 8, background: "var(--accent-blue)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 500 }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存修改"}
          </button>
        </div>
      </div>
    </div>
  );
};
