import React, { useEffect, useLayoutEffect, useRef } from "react";

interface LibraryPaginationProps {
  hasNextPage: boolean;
  fetching: boolean;
  onLoadNextPage: () => void;
}

/** Ordinary native Awn: viewport intersection, no Pages-only load-more button. */
export function LibraryPagination({ hasNextPage, fetching, onLoadNextPage }: LibraryPaginationProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef({ hasNextPage, fetching, onLoadNextPage });
  useLayoutEffect(() => { latest.current = { hasNextPage, fetching, onLoadNextPage }; });
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || fetching) return;
    const load = () => {
      const current = latest.current;
      if (current.hasNextPage && !current.fetching) current.onLoadNextPage();
    };
    if (typeof IntersectionObserver === "undefined") { load(); return; }
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active || !entries.some(entry => entry.isIntersecting)) return;
      active = false;
      observer.disconnect();
      load();
    });
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [hasNextPage, fetching]);
  return hasNextPage || fetching ? <div ref={sentinel} data-library-pagination="" aria-hidden="true" style={{ minHeight: 1, width: "100%" }} /> : null;
}
