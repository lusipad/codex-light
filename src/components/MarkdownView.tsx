import React, { useState } from "react";
import { Check, Copy, Play } from "lucide-react";

interface MarkdownViewProps {
  content: string;
  onRunCommand?: (cmd: string) => void;
  onOpenFile?: (filePath: string) => void;
}

interface ParsedBlock {
  kind: "text" | "code";
  lang: string;
  code: string;
}

function splitMarkdownBlocks(raw: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        kind: "text",
        lang: "",
        code: raw.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      kind: "code",
      lang: (match[1] || "text").toLowerCase(),
      code: match[2].replace(/\r?\n$/, ""),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    blocks.push({
      kind: "text",
      lang: "",
      code: raw.slice(lastIndex),
    });
  }
  return blocks;
}

function renderInlineSegments(
  text: string,
  onOpenFile?: (filePath: string) => void
): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const inner = part.slice(1, -1);
      const looksLikePath =
        inner.includes("/") ||
        inner.includes("\\") ||
        /\.[a-zA-Z0-9]{1,6}$/.test(inner);
      if (looksLikePath && onOpenFile) {
        return (
          <code
            key={idx}
            className="inline-code clickable-code"
            onClick={() => onOpenFile(inner)}
            title="点击在右侧文件预览中打开"
          >
            {inner}
          </code>
        );
      }
      return (
        <code key={idx} className="inline-code">
          {inner}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (href.startsWith("file://") && onOpenFile) {
        const cleaned = decodeURIComponent(
          href.replace(/^file:\/\/\/?/, "").replace(/#L\d+.*$/, "")
        );
        return (
          <button
            key={idx}
            type="button"
            className="inline-file-link"
            onClick={() => onOpenFile(cleaned)}
          >
            {label}
          </button>
        );
      }
      return (
        <a
          key={idx}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-link"
        >
          {label}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderTextParagraphs(
  text: string,
  onOpenFile?: (filePath: string) => void
) {
  const lines = text.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={`${keyPrefix}-list`} className="md-list">
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInlineSegments(item, onOpenFile)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(`l-${i}`);
      return;
    }
    if (trimmed.startsWith("### ")) {
      flushList(`l-${i}`);
      elements.push(
        <h4 key={i} className="md-h3">
          {renderInlineSegments(trimmed.slice(4), onOpenFile)}
        </h4>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList(`l-${i}`);
      elements.push(
        <h3 key={i} className="md-h2">
          {renderInlineSegments(trimmed.slice(3), onOpenFile)}
        </h3>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`l-${i}`);
      elements.push(
        <h2 key={i} className="md-h1">
          {renderInlineSegments(trimmed.slice(2), onOpenFile)}
        </h2>
      );
    } else if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^([-*]|\d+\.)\s+/, ""));
    } else {
      flushList(`l-${i}`);
      elements.push(
        <p key={i} className="md-p">
          {renderInlineSegments(line, onOpenFile)}
        </p>
      );
    }
  });

  flushList("end");
  return elements;
}

export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({ content, onRunCommand, onOpenFile }) => {
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const blocks = splitMarkdownBlocks(content || "");

    const handleCopy = (code: string, idx: number) => {
      navigator.clipboard.writeText(code);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    };

    const isShellLang = (lang: string) =>
      ["bash", "sh", "shell", "zsh", "powershell", "pwsh", "cmd", "bat"].includes(
        lang
      );

    return (
      <div className="markdown-body">
        {blocks.map((block, idx) => {
          if (block.kind === "code") {
            return (
              <div key={idx} className="code-block-wrapper">
                <div className="code-block-header">
                  <span className="code-lang">{block.lang || "code"}</span>
                  <div className="code-block-actions">
                    {onRunCommand && isShellLang(block.lang) && (
                      <button
                        type="button"
                        className="code-action-btn"
                        onClick={() => onRunCommand(block.code)}
                        title="在内置终端中运行"
                      >
                        <Play size={12} />
                        <span>运行</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="code-action-btn"
                      onClick={() => handleCopy(block.code, idx)}
                    >
                      {copiedIdx === idx ? (
                        <>
                          <Check size={12} />
                          <span>已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>复制</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <pre className="code-block-pre">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          }
          return (
            <div key={idx} className="md-text-chunk">
              {renderTextParagraphs(block.code, onOpenFile)}
            </div>
          );
        })}
      </div>
    );
  }
);
