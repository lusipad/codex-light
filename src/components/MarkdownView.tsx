import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Play, WrapText } from "lucide-react";
import { copyTextToClipboard } from "../clipboard";

interface MarkdownViewProps {
  content: string;
  variant?: "default" | "user-message";
  onRunCommand?: (cmd: string) => void;
  onOpenFile?: (filePath: string) => void;
  remoteContent?: boolean | "no-remote-images";
}

interface ParsedBlock {
  kind: "text" | "code";
  lang: string;
  code: string;
}

function splitMarkdownBlocks(raw: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let text: string[] = [];
  let code: string[] = [];
  let fence: { marker: string; length: number; indent: number; lang: string } | null = null;
  const flushText = () => {
    if (text.length) blocks.push({ kind: "text", lang: "", code: text.join("\n") });
    text = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`).test(line)) {
        blocks.push({ kind: "code", lang: fence.lang, code: code.join("\n") });
        fence = null;
        code = [];
      } else {
        code.push(line.replace(new RegExp(`^ {0,${fence.indent}}`), ""));
      }
      continue;
    }
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && !(opening[2][0] === "`" && opening[3].includes("`"))) {
      flushText();
      fence = {
        marker: opening[2][0], length: opening[2].length, indent: opening[1].length,
        lang: opening[3].trim().split(/\s+/)[0].toLowerCase() || "text",
      };
    } else {
      text.push(line);
    }
  }
  if (fence) blocks.push({ kind: "code", lang: fence.lang, code: code.join("\n") });
  flushText();
  return blocks;
}

function decodeFilePath(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function tokenizeCodeLine(line: string, lang: string): React.ReactNode {
  if (lang === "diff" || lang === "patch") {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return <span className="tok-diff-add">{line}</span>;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return <span className="tok-diff-del">{line}</span>;
    }
    if (line.startsWith("@@")) {
      return <span className="tok-diff-hunk">{line}</span>;
    }
  }

  const tokenRegex =
    /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|import|from|export|default|class|interface|type|enum|async|await|try|catch|finally|throw|new|typeof|instanceof|in|of|true|false|null|undefined|fn|pub|mod|use|struct|impl|trait|match|mut|ref|Self|self|where|crate|super|def|elif|except|lambda|pass|raise|with|yield|None|True|False|package|func|chan|defer|go|select|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|GROUP|ORDER|BY|LIMIT)\b|\b\d+(?:\.\d+)?\b)/g;

  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(line)) !== null) {
    if (m.index > lastIdx) {
      nodes.push(line.slice(lastIdx, m.index));
    }
    const tok = m[0];
    let cls = "tok-kw";
    if (tok.startsWith("//") || tok.startsWith("#") || tok.startsWith("/*")) {
      cls = "tok-comment";
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) {
      cls = "tok-string";
    } else if (/^\d/.test(tok)) {
      cls = "tok-number";
    } else if (/^(true|false|null|undefined|None|True|False)$/.test(tok)) {
      cls = "tok-bool";
    }
    nodes.push(
      <span key={m.index} className={cls}>
        {tok}
      </span>
    );
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < line.length) {
    nodes.push(line.slice(lastIdx));
  }
  return nodes.length > 0 ? nodes : line;
}

function hasUnsafeExternalProtocol(value: string): boolean {
  return /^(?:javascript|vbscript|data):/i.test(value.trim());
}

function hasUnsafeImageProtocol(value: string): boolean {
  return /^(?:javascript|vbscript|data:(?!image\/))/i.test(value.trim());
}

function renderInlineSegments(
  text: string,
  onOpenFile?: (filePath: string) => void,
  userMessage = false,
  remoteContent: boolean | "no-remote-images" = false
): React.ReactNode[] {
  const inlineRegex =
    /(`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|~~[^~]+~~|(?<!\*)\*[^*\s][^*]*\*(?!\*)|(?<!\w)_[^_\s][^_]*_(?!\w))/g;
  const parts = text.split(inlineRegex);
  return parts.map((part, idx) => {
    if (!part) return null;

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const inner = part.slice(1, -1);
      const cleanedPath = inner.replace(/:\d+(?::\d+)?$/, "");
      const looksLikePath =
        cleanedPath.includes("/") ||
        cleanedPath.includes("\\") ||
        /\.[a-zA-Z0-9]{1,6}$/.test(cleanedPath);
      if (looksLikePath && onOpenFile) {
        return (
          <button
            key={idx}
            type="button"
            className="inline-code clickable-code"
            onClick={() => onOpenFile(cleanedPath)}
            title="点击在右侧文件预览中打开"
          >
            {inner}
          </button>
        );
      }
      return (
        <code key={idx} className="inline-code">
          {inner}
        </code>
      );
    }

    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      if (userMessage) {
        return <React.Fragment key={idx}>!{renderInlineSegments(part.slice(1), onOpenFile, true, remoteContent)}</React.Fragment>;
      }
      const [, alt, src] = imgMatch;
      if (remoteContent === "no-remote-images") return <span key={idx} className="md-unsupported-media" title="远程图片">{alt || "图片"}</span>;
      if (hasUnsafeImageProtocol(src) || (remoteContent && !/^https:\/\//i.test(src))) {
        return <span key={idx} className="md-unsupported-media">不支持的图片地址</span>;
      }
      return (
        <img
          key={idx}
          src={src}
          alt={alt}
          className="md-inline-image"
          loading="lazy"
        />
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (hasUnsafeExternalProtocol(href) || (remoteContent && !/^(?:https:\/\/|#)/i.test(href))) {
        return <span key={idx} className="md-unsupported-media">不支持的链接地址</span>;
      }
      if (href.startsWith("file://") && onOpenFile) {
        const cleaned = decodeFilePath(
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
      if (
        onOpenFile &&
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("#")
      ) {
        const cleaned = decodeFilePath(href.replace(/#L\d+.*$/, ""));
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

    if (part.startsWith("***") && part.endsWith("***") && part.length > 6) {
      return (
        <strong key={idx}>
          <em>{renderInlineSegments(part.slice(3, -3), onOpenFile, userMessage, remoteContent)}</em>
        </strong>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx}>
          {renderInlineSegments(part.slice(2, -2), onOpenFile, userMessage, remoteContent)}
        </strong>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return (
        <del key={idx}>
          {renderInlineSegments(part.slice(2, -2), onOpenFile, userMessage, remoteContent)}
        </del>
      );
    }
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      return (
        <em key={idx}>{renderInlineSegments(part.slice(1, -1), onOpenFile, userMessage, remoteContent)}</em>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function parseTableCells(row: string): string[] {
  const trimmed = row.trim();
  const stripped = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return stripped.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  const cells = parseTableCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function renderTextParagraphs(
  text: string,
  onOpenFile?: (filePath: string) => void,
  userMessage = false,
  remoteContent: boolean | "no-remote-images" = false
) {
  const lines = text.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  let ulItems: { text: string; checked?: boolean }[] = [];
  let olItems: { num: number; text: string }[] = [];
  let quoteLines: string[] = [];

  const flushListsAndQuotes = (keyPrefix: string) => {
    if (ulItems.length > 0) {
      elements.push(
        <ul key={`${keyPrefix}-ul`} className="md-list">
          {ulItems.map((item, idx) => (
            <li
              key={idx}
              className={
                typeof item.checked === "boolean" ? "md-task-list-item" : undefined
              }
            >
              {typeof item.checked === "boolean" && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  className="md-task-checkbox"
                />
              )}
              <span>{renderInlineSegments(item.text, onOpenFile, userMessage, remoteContent)}</span>
            </li>
          ))}
        </ul>
      );
      ulItems = [];
    }
    if (olItems.length > 0) {
      const startNum = olItems[0]?.num || 1;
      elements.push(
        <ol key={`${keyPrefix}-ol`} start={startNum} className="md-list md-ol-list">
          {olItems.map((item, idx) => (
            <li key={idx}>{renderInlineSegments(item.text, onOpenFile, userMessage, remoteContent)}</li>
          ))}
        </ol>
      );
      olItems = [];
    }
    if (quoteLines.length > 0) {
      const firstLine = quoteLines[0] || "";
      const alertMatch = firstLine.match(
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i
      );
      const alertType = alertMatch ? alertMatch[1].toLowerCase() : null;
      const bodyLines = alertMatch
        ? [alertMatch[2], ...quoteLines.slice(1)].filter(Boolean)
        : quoteLines;
      elements.push(
        <blockquote
          key={`${keyPrefix}-quote`}
          className={`md-blockquote ${alertType ? `md-alert-${alertType}` : ""}`}
        >
          {alertType && (
            <div className="md-alert-title">{alertType.toUpperCase()}</div>
          )}
          {bodyLines.map((ql, qIdx) => (
            <p key={qIdx} className="md-blockquote-p">
              {renderInlineSegments(ql, onOpenFile, userMessage, remoteContent)}
            </p>
          ))}
        </blockquote>
      );
      quoteLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushListsAndQuotes(`l-${i}`);
      continue;
    }

    // Check for GFM table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushListsAndQuotes(`l-${i}`);
      const headers = parseTableCells(trimmed);
      const alignments = parseTableCells(lines[i + 1]).map((sep) => {
        if (sep.startsWith(":") && sep.endsWith(":")) return "center" as const;
        if (sep.endsWith(":")) return "right" as const;
        return "left" as const;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      i--; // adjust for outer loop increment
      elements.push(
        <div key={`table-${i}`} className="md-table-wrapper">
          <table className="md-table">
            <caption className="sr-only">Markdown 数据表</caption>
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th
                    scope="col"
                    key={hIdx}
                    style={{ textAlign: alignments[hIdx] || "left" }}
                  >
                    {renderInlineSegments(h, onOpenFile, userMessage, remoteContent)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      style={{ textAlign: alignments[cIdx] || "left" }}
                    >
                      {renderInlineSegments(row[cIdx] ?? "", onOpenFile, userMessage, remoteContent)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushListsAndQuotes(`l-${i}`);
      elements.push(<hr key={`hr-${i}`} className="md-hr" />);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      if (ulItems.length > 0 || olItems.length > 0) {
        flushListsAndQuotes(`l-${i}`);
      }
      quoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    } else if (quoteLines.length > 0) {
      flushListsAndQuotes(`l-${i}`);
    }

    // Headings h1-h6
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushListsAndQuotes(`l-${i}`);
      const level = headingMatch[1].length;
      const contentNode = renderInlineSegments(headingMatch[2], onOpenFile, userMessage, remoteContent);
      if (userMessage) {
        elements.push(React.createElement(`h${level}`, { key: i, className: `md-h${level}` }, contentNode));
      } else if (level === 1) {
        elements.push(
          <h2 key={i} className="md-h1">
            {contentNode}
          </h2>
        );
      } else if (level === 2) {
        elements.push(
          <h3 key={i} className="md-h2">
            {contentNode}
          </h3>
        );
      } else if (level === 3) {
        elements.push(
          <h4 key={i} className="md-h3">
            {contentNode}
          </h4>
        );
      } else {
        elements.push(
          <h5 key={i} className={`md-h${level}`}>
            {contentNode}
          </h5>
        );
      }
      continue;
    }

    // Task list item
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      if (olItems.length > 0) flushListsAndQuotes(`l-${i}`);
      ulItems.push({
        checked: taskMatch[1].toLowerCase() === "x",
        text: taskMatch[2],
      });
      continue;
    }

    // Unordered list item
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (olItems.length > 0) flushListsAndQuotes(`l-${i}`);
      ulItems.push({ text: ulMatch[1] });
      continue;
    }

    // Ordered list item
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (ulItems.length > 0) flushListsAndQuotes(`l-${i}`);
      olItems.push({ num: Number(olMatch[1]), text: olMatch[2] });
      continue;
    }

    flushListsAndQuotes(`l-${i}`);
    const paragraph = [line];
    if (userMessage) {
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (!next || /^(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|[-*_]{3,}$)/.test(next) ||
          (next.includes("|") && i + 2 < lines.length && isTableSeparator(lines[i + 2]))) break;
        paragraph.push(lines[++i]);
      }
    }
    elements.push(
      <p key={i} className="md-p">
        {renderInlineSegments(paragraph.join("\n"), onOpenFile, userMessage, remoteContent)}
      </p>
    );
  }

  flushListsAndQuotes("end");
  return elements;
}

export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({ content, variant = "default", onRunCommand, onOpenFile, remoteContent = false }) => {
    if (remoteContent) { onRunCommand = undefined; onOpenFile = undefined; }
    const [copiedBlocks, setCopiedBlocks] = useState<Record<number, boolean>>({});
    const [copyingBlocks, setCopyingBlocks] = useState<Record<number, boolean>>({});
    const copyingRef = useRef(new Set<number>());
    const mountedRef = useRef(true);
    const copyTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        for (const timer of copyTimersRef.current.values()) clearTimeout(timer);
        copyTimersRef.current.clear();
      };
    }, []);
    const [wrappedBlocks, setWrappedBlocks] = useState<Record<number, boolean>>(
      {}
    );
    const userMessage = variant === "user-message";
    const blocks = splitMarkdownBlocks(userMessage
      ? (content || "").replaceAll("](codex-text-link://", "](")
      : content || "");

    const handleCopy = async (code: string, idx: number) => {
      if (copyingRef.current.has(idx)) return;
      copyingRef.current.add(idx);
      setCopyingBlocks((prev) => ({ ...prev, [idx]: true }));
      const copied = await copyTextToClipboard(code);
      copyingRef.current.delete(idx);
      if (!mountedRef.current) return;
      setCopyingBlocks((prev) => ({ ...prev, [idx]: false }));
      if (!copied) return;
      clearTimeout(copyTimersRef.current.get(idx));
      setCopiedBlocks((prev) => ({ ...prev, [idx]: true }));
      copyTimersRef.current.set(idx, setTimeout(() => {
        copyTimersRef.current.delete(idx);
        setCopiedBlocks((prev) => ({ ...prev, [idx]: false }));
      }, 2000));
    };

    const toggleWrap = (idx: number) => {
      setWrappedBlocks((prev) => ({ ...prev, [idx]: !prev[idx] }));
    };

    const isShellLang = (lang: string) =>
      ["bash", "sh", "shell", "zsh", "powershell", "pwsh", "cmd", "bat"].includes(
        lang
      );

    return (
      <div className={`markdown-body${userMessage ? " markdown-body-user-message" : ""}`}>
        {blocks.map((block, idx) => {
          if (block.kind === "code") {
            const codeLines = block.code.split(/\r?\n/);
            const isWrapped = Boolean(wrappedBlocks[idx]);
            return (
              <div key={idx} className="code-block-wrapper" data-markdown-copy="code-block">
                <div className="code-block-header">
                  <div className="code-block-meta">
                    <span className="code-lang">{block.lang || "code"}</span>
                    <span className="code-line-count">
                      {codeLines.length} {codeLines.length === 1 ? "line" : "lines"}
                    </span>
                  </div>
                  <div className="code-block-actions">
                    <button
                      type="button"
                      className={`code-action-btn ${isWrapped ? "active" : ""}`}
                      onClick={() => toggleWrap(idx)}
                      title="切换自动换行"
                    >
                      <WrapText size={12} />
                      <span>换行</span>
                    </button>
                    {!userMessage && onRunCommand && isShellLang(block.lang) && (
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
                      aria-busy={copyingBlocks[idx] || undefined}
                      aria-disabled={copyingBlocks[idx] || undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!copiedBlocks[idx]) void handleCopy(block.code, idx);
                      }}
                    >
                      {copiedBlocks[idx] ? (
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
                <pre className={`code-block-pre ${isWrapped ? "wrapped" : ""}`} tabIndex={0} aria-label={`${block.lang} 代码块`}>
                  <code>
                    {codeLines.map((ln, lIdx) => (
                      <React.Fragment key={lIdx}>
                        {tokenizeCodeLine(ln, block.lang)}
                        {lIdx < codeLines.length - 1 ? "\n" : ""}
                      </React.Fragment>
                    ))}
                  </code>
                </pre>
              </div>
            );
          }
          return (
            <div key={idx} className="md-text-chunk">
              {renderTextParagraphs(block.code, onOpenFile, userMessage, remoteContent)}
            </div>
          );
        })}
      </div>
    );
  }
);
