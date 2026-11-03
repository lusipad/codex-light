import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDownIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";

export const UserMessageBubble: React.FC<{ text: string; onOpenFile?: (path: string) => void }> = ({ text, onOpenFile }) => {
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const [measurement, setMeasurement] = useState({ collapsible: false, clipHeight: 456 });
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const collapsed = !printing && measurement.collapsible && expandedText !== text;

  useLayoutEffect(() => {
    const beforePrint = () => flushSync(() => setPrinting(true));
    const afterPrint = () => setPrinting(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      if (content.clientWidth <= 0) return;
      const style = window.getComputedStyle(content);
      const fontSize = Number.parseFloat(style.fontSize) || 13;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.5;
      const collapsible = Math.ceil(content.scrollHeight) > Math.ceil(lineHeight * 20) + 1;
      let clipHeight = Math.ceil(lineHeight * 19);
      const rect = content.getBoundingClientRect();
      const clipTop = clipRef.current?.getBoundingClientRect().top ?? rect.top;
      const scale = content.offsetHeight === 0 ? 1 : rect.height / content.offsetHeight;
      for (const block of content.querySelectorAll<HTMLElement>('[data-markdown-copy="code-block"]')) {
        const bounds = block.getBoundingClientRect();
        const top = (bounds.top - clipTop) / scale;
        const bottom = (bounds.bottom - clipTop) / scale;
        if (top < clipHeight && bottom > clipHeight) clipHeight = Math.ceil(bottom);
      }
      setMeasurement(current => current.collapsible === collapsible && current.clipHeight === clipHeight
        ? current : { collapsible, clipHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  useLayoutEffect(() => {
    const root = clipRef.current;
    if (!collapsed || !root) return;
    const tracked = new Map<HTMLElement, string | null>();
    const restore = (element: HTMLElement, visible: boolean, previous: string | null) => {
      element.toggleAttribute("inert", !visible);
      if (!visible) element.setAttribute("aria-hidden", "true");
      else if (previous === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", previous);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (tracked.has(element)) {
          const visible = entry.isIntersecting && (element.matches("a[href], area[href]")
            ? entry.intersectionRatio > 0 : entry.intersectionRatio >= 1);
          restore(element, visible, tracked.get(element)!);
        }
      }
    }, { root, threshold: [Number.EPSILON, 1] });
    const scan = () => {
      for (const [element, previous] of tracked) {
        if (root.contains(element)) continue;
        observer?.unobserve(element);
        restore(element, true, previous);
        tracked.delete(element);
      }
      const clip = root.getBoundingClientRect();
      for (const element of root.querySelectorAll<HTMLElement>(
        'a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'
      )) {
        if (tracked.has(element) || element.hasAttribute("inert")) continue;
        const previous = element.getAttribute("aria-hidden");
        const bounds = element.getBoundingClientRect();
        const visible = element.matches("a[href], area[href]")
          ? Math.min(bounds.right, clip.right) > Math.max(bounds.left, clip.left) &&
            Math.min(bounds.bottom, clip.bottom) > Math.max(bounds.top, clip.top)
          : bounds.top >= clip.top && bounds.bottom <= clip.bottom &&
            bounds.left >= clip.left && bounds.right <= clip.right;
        tracked.set(element, previous);
        restore(element, visible, previous);
        observer?.observe(element);
      }
    };
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      for (const [element, previous] of tracked) restore(element, true, previous);
    };
  }, [collapsed, text, measurement.clipHeight]);

  return (
    <div className="user-bubble" data-user-message-bubble>
      <div
        id={contentId}
        ref={clipRef}
        className="user-message-content"
        style={collapsed ? { maxHeight: `${measurement.clipHeight}px`, overflow: "hidden" } : undefined}
      >
        <div ref={contentRef}><MarkdownView content={text} variant="user-message" onOpenFile={onOpenFile} /></div>
      </div>
      {collapsed && <span className="user-message-ellipsis" aria-hidden="true">…</span>}
      {!printing && measurement.collapsible && (
        <button
          type="button"
          className="user-message-expand"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          data-user-message-expand
          data-thread-find-skip
          data-markdown-copy="exclude"
          onClick={() => setExpandedText(current => current === text ? null : text)}
        >
          {collapsed ? "显示更多" : "收起"}
          <ChevronDownIcon size={12} className={collapsed ? "" : "expanded"} />
        </button>
      )}
    </div>
  );
};
