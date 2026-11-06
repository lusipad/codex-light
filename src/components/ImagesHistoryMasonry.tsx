import React, { useLayoutEffect, useRef } from "react";
import "./ImagesHistoryMasonry.css";

/** Non-animated official masonry branch: preserve prefix assignments, measure actual cards. */
export const ImagesHistoryMasonry: React.FC<{ items: { id: string; content: React.ReactNode }[] }> = ({ items }) => {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef({ columns: 0, ids: [] as string[], assignments: new Map<string, number>() });
  const ids = JSON.stringify(items.map(item => item.id));
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const children = [...element.querySelectorAll<HTMLElement>(":scope > [data-masonry-item]")];
    let frame: number | undefined;
    const measure = () => {
      if (!element.clientWidth) return;
      const style = getComputedStyle(element), columns = Number(style.getPropertyValue("--images-masonry-columns")) || 1;
      const gap = parseFloat(style.rowGap) || 0, heights = Array(columns).fill(0);
      const currentIds = children.map(child => child.dataset.masonryItem!);
      const old = previous.current, prefix = currentIds.slice(0, Math.min(currentIds.length, old.ids.length)).every((id, index) => old.ids[index] === id);
      const assignments = new Map<string, number>();
      for (const child of children) {
        const id = child.dataset.masonryItem!;
        const column = (old.columns === columns && prefix ? old.assignments.get(id) : undefined) ?? heights.indexOf(Math.min(...heights));
        child.style.gridColumn = String(column + 1); child.style.gridRow = "1";
        child.style.transform = `translateY(${heights[column]}px)`;
        heights[column] += child.offsetHeight + gap; assignments.set(id, column);
      }
      element.style.height = `${Math.max(0, ...heights) - (children.length ? gap : 0)}px`;
      previous.current = { columns, ids: currentIds, assignments };
    };
    const observer = new ResizeObserver(() => { if (frame !== undefined) cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(element); children.forEach(child => observer.observe(child)); measure();
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [ids]);
  return <div className="images-masonry-container"><div className="images-masonry" ref={container}>
    {items.map(item => <div key={item.id} data-masonry-item={item.id}>{item.content}</div>)}
  </div></div>;
};
