import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AttachedFileItem, FilePreviewResult } from "../types";
import { CloseIcon, PaperclipIcon } from "./Icons";

interface ComposerAttachmentChipProps {
  file: AttachedFileItem;
  onRemove: () => void;
}

export const ComposerAttachmentChip: React.FC<ComposerAttachmentChipProps> = ({
  file,
  onRemove,
}) => {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file.kind !== "image") {
      setPreview(null);
      return;
    }
    let cancelled = false;
    invoke<FilePreviewResult>("fs_read_preview", {
      path: file.path,
      maxBytes: 8 * 1024 * 1024,
    })
      .then((result) => {
        if (!cancelled && result.isImage && result.base64DataUrl) {
          setPreview(result.base64DataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, file.kind]);

  return (
    <div className={`composer-attachment-chip ${preview ? "has-preview" : ""}`} title={file.path}>
      {preview ? (
        <img className="composer-attachment-thumb" src={preview} alt={`${file.name} 附件预览`} />
      ) : (
        <PaperclipIcon size={12} />
      )}
      <span className="attachment-chip-name">{file.name}</span>
      {file.persisted && (
        <span className="attachment-persisted" title="已保存到当前会话" aria-label="已保存到当前会话">
          ✓
        </span>
      )}
      <button
        type="button"
        className="attachment-chip-remove"
        onClick={onRemove}
        aria-label={`移除附件 ${file.name}`}
        title={`移除附件 ${file.name}`}
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
};
