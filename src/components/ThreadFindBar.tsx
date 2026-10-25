import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TurnData } from "../types";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "./Icons";
import "./ThreadFindBar.css";

export interface ThreadFindBarProps {
  open: boolean;
  onClose: () => void;
  turns: TurnData[];
  scope?: "chat" | "diff";
  onScopeChange?: (scope: "chat" | "diff") => void;
  onOpenDiff?: () => void;
}

interface MatchItem {
  turnId: string;
  elementId: string;
  kind: "user" | "assistant";
  preview: string;
}

export const ThreadFindBar: React.FC<ThreadFindBarProps> = ({
  open,
  onClose,
  turns,
  scope = "chat",
  onScopeChange,
  onOpenDiff,
}) => {
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHighlightedElementRef = useRef<HTMLElement | null>(null);

  // When find bar opens, focus and select input text
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    } else {
      if (lastHighlightedElementRef.current) {
        lastHighlightedElementRef.current.classList.remove("find-highlight-pulse");
        lastHighlightedElementRef.current = null;
      }
    }
  }, [open]);

  // Compute all text matches in the active thread
  const matches = useMemo<MatchItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || !open) return [];

    const result: MatchItem[] = [];

    for (const turn of turns) {
      // 1. Check user items
      const userItems = turn.items.filter(
        (i) => i.type === "userMessage" || i.type === "user"
      );
      for (const item of userItems) {
        const text = String((item as any)?.text || (item as any)?.content || "");
        if (text.toLowerCase().includes(q)) {
          result.push({
            turnId: turn.id,
            elementId: `turn-user-${turn.id}`,
            kind: "user",
            preview: text.slice(0, 60),
          });
          break;
        }
      }

      // 2. Check assistant items
      const asstItems = turn.items.filter(
        (i) =>
          i.type === "agentMessage" ||
          i.type === "assistantMessage" ||
          i.type === "assistant" ||
          i.type === "reasoning" ||
          i.type === "commandExecution"
      );
      for (const item of asstItems) {
        const text = String(
          (item as any)?.text ||
            (item as any)?.content ||
            (item as any)?.command ||
            (item as any)?.output ||
            ""
        );
        if (text.toLowerCase().includes(q)) {
          result.push({
            turnId: turn.id,
            elementId: `turn-${turn.id}`,
            kind: "assistant",
            preview: text.slice(0, 60),
          });
          break;
        }
      }
    }

    return result;
  }, [query, open, turns]);

  // Reset or constrain activeMatchIndex when matches change
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [query]);

  // Jump to active match
  const scrollToMatch = useCallback((index: number) => {
    if (matches.length === 0) return;
    const targetMatch = matches[index];
    if (!targetMatch) return;

    if (lastHighlightedElementRef.current) {
      lastHighlightedElementRef.current.classList.remove("find-highlight-pulse");
    }

    const targetEl = document.getElementById(targetMatch.elementId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEl.classList.add("find-highlight-pulse");
      lastHighlightedElementRef.current = targetEl;

      setTimeout(() => {
        targetEl.classList.remove("find-highlight-pulse");
      }, 1600);
    }
  }, [matches]);

  const handleNext = useCallback(() => {
    if (matches.length === 0) return;
    const nextIdx = (activeMatchIndex + 1) % matches.length;
    setActiveMatchIndex(nextIdx);
    scrollToMatch(nextIdx);
  }, [matches, activeMatchIndex, scrollToMatch]);

  const handlePrevious = useCallback(() => {
    if (matches.length === 0) return;
    const prevIdx = (activeMatchIndex - 1 + matches.length) % matches.length;
    setActiveMatchIndex(prevIdx);
    scrollToMatch(prevIdx);
  }, [matches, activeMatchIndex, scrollToMatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const matchCountText = hasQuery
    ? matches.length > 0
      ? `${activeMatchIndex + 1} / ${matches.length}`
      : "0 结果"
    : "";

  return (
    <div className="thread-find-bar" role="search" aria-label="在会话中查找">
      <div className="find-scope-pills">
        <button
          type="button"
          className={`find-scope-btn ${scope === "chat" ? "active" : ""}`}
          onClick={() => onScopeChange?.("chat")}
          title="在会话中搜索"
        >
          会话
        </button>
        <button
          type="button"
          className={`find-scope-btn ${scope === "diff" ? "active" : ""}`}
          onClick={() => {
            onScopeChange?.("diff");
            onOpenDiff?.();
          }}
          title="在代码改动中搜索"
        >
          改动
        </button>
      </div>

      <div className="find-input-wrapper">
        <span style={{ color: "var(--text-tertiary)", display: "flex", alignItems: "center", marginRight: 4 }}>
          <SearchIcon size={13} />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="find-input"
          placeholder={scope === "diff" ? "在代码改动中搜索…" : "在会话中搜索…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {hasQuery && (
        <span
          className={`find-match-count ${matches.length === 0 ? "no-results" : ""}`}
        >
          {matchCountText}
        </span>
      )}

      <div className="find-divider" />

      <button
        type="button"
        className="find-action-btn"
        disabled={matches.length === 0}
        onClick={handlePrevious}
        title="上一处 (Shift+Enter)"
      >
        <ChevronUpIcon size={13} />
      </button>

      <button
        type="button"
        className="find-action-btn"
        disabled={matches.length === 0}
        onClick={handleNext}
        title="下一处 (Enter)"
      >
        <ChevronDownIcon size={13} />
      </button>

      <div className="find-divider" />

      <button
        type="button"
        className="find-action-btn"
        onClick={onClose}
        title="关闭 (Esc)"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
};
