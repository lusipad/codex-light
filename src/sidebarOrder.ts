export function mergeSidebarOrder(stored: readonly string[], current: readonly string[], newItemsFirst: boolean): string[] {
  const saved = [...new Set(stored)];
  const known = new Set(saved);
  const added = [...new Set(current)].filter((id) => !known.has(id));
  return newItemsFirst ? [...added, ...saved] : [...saved, ...added];
}

export function applySidebarOrder<T extends { id: string }>(items: T[], stored: readonly string[] = [], newItemsFirst = false): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return mergeSidebarOrder(stored, items.map((item) => item.id), newItemsFirst)
    .flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
}

export function moveVisibleSidebarThread(
  stored: readonly string[], current: readonly string[], visible: readonly string[],
  active: string, target: string, after: boolean, newItemsFirst = false,
): string[] {
  if (active === target || !visible.includes(active) || !visible.includes(target)) return [...stored];
  const next = visible.filter((id) => id !== active);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, active);
  const visibleSet = new Set(visible);
  let position = 0;
  return mergeSidebarOrder(stored, current, newItemsFirst)
    .map((id) => visibleSet.has(id) ? next[position++] : id);
}

export function prependSidebarThread(stored: readonly string[] = [], id: string): string[] {
  return [id, ...stored.filter((saved) => saved !== id)];
}

export function sidebarDropTarget(
  visible: readonly string[], active: string, target: string, after: boolean,
): { beforeId: string | null } | null {
  if (active === target || !visible.includes(active) || !visible.includes(target)) return null;
  const remaining = visible.filter((id) => id !== active);
  const position = remaining.indexOf(target) + (after ? 1 : 0);
  const next = [...remaining.slice(0, position), active, ...remaining.slice(position)];
  return next.every((id, index) => id === visible[index])
    ? null : { beforeId: remaining[position] ?? null };
}
