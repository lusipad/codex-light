import React, { useEffect, useRef, useState } from "react";
import { CloseIcon } from "./Icons";
import "./RenameThreadDialog.css";

export const RenameThreadDialog: React.FC<{
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}> = ({ initialValue, onClose, onSave }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="rename-thread-dialog"
      aria-label="重命名聊天"
      aria-describedby="rename-thread-description"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.nativeEvent.isComposing || event.keyCode === 229) &&
          (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
      }}
    >
      <button type="button" className="rename-thread-close" aria-label="关闭对话框" onClick={onClose}>
        <CloseIcon size={12} />
      </button>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (submittedRef.current) return;
        submittedRef.current = true;
        onClose();
        onSave(value);
      }}>
        <header>
          <h2>重命名聊天</h2>
          <p id="rename-thread-description">保持简短且易于识别</p>
        </header>
        <input
          ref={inputRef}
          aria-label="聊天标题"
          placeholder="添加标题…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="rename-thread-save">保存</button>
        </footer>
      </form>
    </dialog>
  );
};
