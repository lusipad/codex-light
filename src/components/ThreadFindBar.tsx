import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TurnData } from "../types";
import { extractTextFromItem } from "../threadText";
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

export function findThreadMatches(turns: TurnData[], query: string): MatchItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const result: MatchItem[] = [];

    for (const turn of turns) {
      // 1. Check user items
      const userItems = turn.items.filter(
        (i) => i.type === "userMessage" || i.type === "user"
      );
      for (const item of userItems) {
        const text = extractTextFromItem(item);
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
        const command = Array.isArray(item.command) ? item.command.join(" ") : item.command;
        const text = [extractTextFromItem(item), command, item.aggregatedOutput, item.stdout, item.stderr, item.output]
          .filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
        if (text.toLowerCase().includes(q)) {
          result.push({
            turnId: turn.id,
            elementId: item.type === "commandExecution" && item.id ? `command-${item.id}` : `turn-${turn.id}`,
            kind: "assistant",
            preview: text.slice(0, 60),
          });
          break;
        }
      }
    }

    return result;
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
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When find bar opens, focus and select input text
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => {
        clearTimeout(timer);
        if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
        lastHighlightedElementRef.current?.classList.remove("find-highlight-pulse");
      };
    } else {
      if (lastHighlightedElementRef.current) {
        lastHighlightedElementRef.current.classList.remove("find-highlight-pulse");
        lastHighlightedElementRef.current = null;
      }
    }
  }, [open]);

  const matches = useMemo(() => open ? findThreadMatches(turns, query) : [], [query, open, turns]);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const selectedIndex = Math.min(activeMatchIndex, Math.max(0, matches.length - 1));

  // Jump to active match
  const scrollToMatch = useCallback((index: number) => {
    const targetMatch = matchesRef.current[index];
    if (!targetMatch) return;

    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    if (lastHighlightedElementRef.current) {
      lastHighlightedElementRef.current.classList.remove("find-highlight-pulse");
    }

    const targetEl = document.getElementById(targetMatch.elementId);
    if (targetEl) {
      targetEl.querySelector<HTMLButtonElement>("[data-user-message-expand][aria-expanded='false']")?.click();
      targetEl.querySelector<HTMLButtonElement>("[data-command-expand][aria-expanded='false']")?.click();
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEl.classList.add("find-highlight-pulse");
      lastHighlightedElementRef.current = targetEl;

      highlightTimerRef.current = setTimeout(() => {
        targetEl.classList.remove("find-highlight-pulse");
      }, 1600);
    }
  }, []);

  const firstMatchId = matches[0]?.elementId;
  useEffect(() => {
    setActiveMatchIndex(0);
    if (open) scrollToMatch(0);
  }, [query, open, firstMatchId, scrollToMatch]);

  const handleNext = useCallback(() => {
    if (matches.length === 0) return;
    const nextIdx = (selectedIndex + 1) % matches.length;
    setActiveMatchIndex(nextIdx);
    scrollToMatch(nextIdx);
  }, [matches, selectedIndex, scrollToMatch]);

  const handlePrevious = useCallback(() => {
    if (matches.length === 0) return;
    const prevIdx = (selectedIndex - 1 + matches.length) % matches.length;
    setActiveMatchIndex(prevIdx);
    scrollToMatch(prevIdx);
  }, [matches, selectedIndex, scrollToMatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const matchCountText = hasQuery
    ? matches.length > 0
      ? `${selectedIndex + 1} / ${matches.length}`
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
          aria-label={scope === "diff" ? "在代码改动中搜索" : "在会话中搜索"}
          placeholder={scope === "diff" ? "在代码改动中搜索…" : "在会话中搜索…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {hasQuery && (
        <span
          className={`find-match-count ${matches.length === 0 ? "no-results" : ""}`}
          role="status"
          aria-live="polite"
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
