import React, { useEffect, useState } from "react";
import { CopyIcon, MessagePlusIcon, SparklesIcon } from "./Icons";
import "./TextSelectionToolbar.css";

export interface TextSelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onAddToChat: (text: string) => void;
  onAskInSideChat: (text: string) => void;
  onCopy?: (text: string) => void;
}

export const TextSelectionToolbar: React.FC<TextSelectionToolbarProps> = ({
  containerRef,
  onAddToChat,
  onAskInSideChat,
  onCopy,
}) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setPosition(null);
        setSelectedText("");
        return;
      }

      const text = selection.toString().trim();
      if (!text || text.length < 2) {
        setPosition(null);
        setSelectedText("");
        return;
      }

      // Ensure the selection is within our container
      const container = containerRef.current;
      if (container && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const commonAncestor = range.commonAncestorContainer;
        if (!container.contains(commonAncestor)) {
          setPosition(null);
          setSelectedText("");
          return;
        }

        const rect = range.getBoundingClientRect();
        // Position toolbar centered above selection
        const x = rect.left + rect.width / 2;
        const y = Math.max(10, rect.top - 42);
        setPosition({ x, y });
        setSelectedText(text);
        setCopied(false);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // If clicking inside our toolbar, don't clear immediately
      const target = e.target as HTMLElement;
      if (target.closest(".text-selection-toolbar")) {
        return;
      }
      setPosition(null);
      setSelectedText("");
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [containerRef]);

  if (!position || !selectedText) return null;

  return (
    <div
      className="text-selection-toolbar"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="selection-tool-btn"
        onClick={() => {
          onAddToChat(selectedText);
          setPosition(null);
          window.getSelection()?.removeAllRanges();
        }}
        title="将选区内容作为引用插入主聊天输入框"
      >
        <MessagePlusIcon size={13} />
        <span>引用到主聊天</span>
      </button>

      <button
        type="button"
        className="selection-tool-btn"
        onClick={() => {
          onAskInSideChat(selectedText);
          setPosition(null);
          window.getSelection()?.removeAllRanges();
        }}
        title="在侧边独立对话中对此选区深入提问"
      >
        <SparklesIcon size={13} />
        <span>侧边深入提问</span>
      </button>

      <button
        type="button"
        className="selection-tool-btn"
        onClick={async () => {
          if (onCopy) {
            onCopy(selectedText);
          } else {
            await navigator.clipboard.writeText(selectedText);
          }
          setCopied(true);
          setTimeout(() => {
            setPosition(null);
            window.getSelection()?.removeAllRanges();
          }, 800);
        }}
        title="复制选中文本"
      >
        <CopyIcon size={13} />
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
    </div>
  );
};
