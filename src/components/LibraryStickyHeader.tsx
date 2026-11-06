import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import "./LibraryStickyHeader.css";

interface LibraryStickyHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
  newLayout: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
}

export function LibraryStickyHeader({ title, description, actions, navigation, newLayout, scrollContainerRef, bodyRef }: LibraryStickyHeaderProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useLayoutEffect(() => {
    const shell = shellRef.current, content = contentRef.current;
    if (!shell || !content) return;
    let active = true;
    const resize = new ResizeObserver(() => {
      if (!active) return;
      shell.style.setProperty("--header-content-start", `${content.offsetLeft + parseFloat(getComputedStyle(content).paddingInlineStart)}px`);
      if (!content.querySelector(".library-header-actions")) {
        shell.removeAttribute("data-collapsible");
        return;
      }
      const titleContent = content.querySelector<HTMLElement>(".library-sticky-title-content");
      if (!titleContent) return;
      shell.style.setProperty("--header-collapse-offset", `${(titleContent.parentElement?.offsetHeight ?? 0) + parseFloat(getComputedStyle(shell).paddingTop)}px`);
      shell.toggleAttribute("data-collapsible", true);
    });
    const observe = () => {
      if (!active) return;
      resize.disconnect();
      resize.observe(content);
      content.querySelectorAll(".library-sticky-title").forEach(element => resize.observe(element));
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(content, { childList: true, characterData: true, subtree: true });
    observe();
    return () => { active = false; resize.disconnect(); mutation.disconnect(); };
  }, []);

  // Ancestor host and following body refs are not ready during this child's
  // layout effect; bind after the complete tree has committed.
  useEffect(() => {
    const container = scrollContainerRef.current, shell = shellRef.current;
    if (!container || !shell) return;
    let active = true;
    const backgroundInset = () => {
      if (!active) return;
      // The app has no official windowZoom context; these are current 1x CSS coordinates.
      shell.style.setProperty("--header-background-top-inset", `${Math.max(0, container.getBoundingClientRect().top - shell.getBoundingClientRect().top)}px`);
    };
    const onScroll = () => {
      if (!active) return;
      const body = bodyRef.current;
      if (!newLayout && body) {
        shell.style.setProperty("--header-scroll-position", `${container.scrollTop}px`);
        const rect = shell.getBoundingClientRect();
        shell.style.setProperty("--header-scroll-overlap", `${Math.max(0, (rect.bottom - body.getBoundingClientRect().top) * shell.offsetHeight / rect.height + parseFloat(getComputedStyle(shell).marginBottom))}px`);
      }
      setScrolled(newLayout
        ? container.scrollTop > 0 && shell.getBoundingClientRect().top <= container.getBoundingClientRect().top + parseFloat(getComputedStyle(shell).top)
        : container.scrollTop > 0);
      if (newLayout) backgroundInset();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const resize = newLayout ? new ResizeObserver(backgroundInset) : null;
    resize?.observe(container);
    resize?.observe(shell);
    return () => {
      active = false;
      container.removeEventListener("scroll", onScroll);
      resize?.disconnect();
      shell.style.removeProperty("--header-background-top-inset");
      shell.style.removeProperty("--header-scroll-position");
      shell.style.removeProperty("--header-scroll-overlap");
    };
  }, [newLayout, scrollContainerRef, bodyRef]);

  return <>
    <div ref={shellRef} className="library-sticky-shell" data-scroll-collapse data-sticky data-scrolled={scrolled || undefined} data-library-new-layout={newLayout || undefined}>
      <div ref={contentRef} className="library-sticky-content">
        <div className="library-view-header library-browse-header">
          <div className="library-sticky-title"><div className="library-sticky-title-content"><h1>{title}</h1>{description != null && <div className="library-sticky-description">{description}</div>}</div></div>
          <div className="library-sticky-actions">{actions != null && <div className="library-header-actions">{actions}</div>}</div>
        </div>
        <div className="library-sticky-navigation">{newLayout ? null : navigation}</div>
      </div>
    </div>
    {newLayout && navigation != null && <div className="library-sticky-external-navigation">{navigation}</div>}
  </>;
}
