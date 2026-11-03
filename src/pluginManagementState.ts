import { useEffect, useRef, useState } from "react";
import { prepareMarketplaceRemoval, runMarketplaceRemoval, type MarketplaceRemovalPlan } from "./pluginManagement";
import type { PluginMarketplaceEntry } from "./plugins";

export type ManagementTab = "plugins" | "apps" | "mcp" | "skills" | "marketplaces";
export const managementTabOrder: ManagementTab[] = ["plugins", "apps", "mcp", "skills", "marketplaces"];
export function managementTabs(counts: Record<ManagementTab, number>, showNonMcpTabs: boolean) {
  return managementTabOrder.filter(tab => tab === "mcp" || showNonMcpTabs && counts[tab] > 0);
}
export function managementFallback(current: ManagementTab, counts: Record<ManagementTab, number>, loading: boolean, showNonMcpTabs: boolean): ManagementTab {
  if (!showNonMcpTabs) return "mcp";
  if (loading || counts[current] > 0) return current;
  return managementTabOrder.find(tab => counts[tab] > 0) ?? "mcp";
}

// Delivery uncertainty belongs to the operation scope, including after its view closes.
const removalJournal = new Map<string, { plan: MarketplaceRemovalPlan; inFlight: boolean }>();
const removalKey = (context: string, market: PluginMarketplaceEntry) => JSON.stringify([context, market.name, market.path ?? null]);

export function useMarketplaceRemoval(context: string, cwds: string[] | undefined, onRemoved: () => Promise<void>) {
  const [plan, setPlan] = useState<MarketplaceRemovalPlan | null>(null);
  const [target, setTarget] = useState<PluginMarketplaceEntry | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), active = useRef(false), currentPlan = useRef(plan), running = useRef(false);
  const scope = useRef(context); scope.current = context;
  const callbacks = useRef({ onRemoved }); callbacks.current = { onRemoved };
  currentPlan.current = plan;
  useEffect(() => {
    active.current = true; generation.current++; setPlan(null); setTarget(null); setBusy(false); setError(null); running.current = false;
    return () => { active.current = false; generation.current++; };
  }, [context]);
  const valid = (ticket: number) => active.current && generation.current === ticket;
  return { plan, target, busy, error,
    close() { generation.current++; currentPlan.current = null; setPlan(null); setTarget(null); setError(null); },
    async open(marketplace: PluginMarketplaceEntry) {
      if (running.current) return;
      const ticket = ++generation.current, operationScope = context; running.current = true; setTarget(marketplace); setPlan(null); setBusy(true); setError(null);
      try {
        const saved = removalJournal.get(removalKey(context, marketplace));
        if (saved?.inFlight) throw new Error("上次操作仍在处理中，请稍后重新读取；不会重复提交");
        const next = saved?.plan ?? await prepareMarketplaceRemoval(marketplace, cwds);
        if (valid(ticket)) { currentPlan.current = next; setPlan(next); }
      }
      catch (cause) { if (valid(ticket)) setError(String(cause)); }
      finally { if (active.current && scope.current === operationScope) { running.current = false; setBusy(false); } }
    },
    async confirm() {
      const before = currentPlan.current;
      if (!before || running.current) return;
      const key = removalKey(context, before.marketplace);
      if (removalJournal.get(key)?.inFlight) return;
      const ticket = generation.current, operationScope = context; running.current = true; setBusy(true); setError(null);
      removalJournal.set(key, { plan: before, inFlight: true });
      try {
        const next = await runMarketplaceRemoval(before, { cwds, isCurrent: () => valid(ticket), onProgress: value => {
          removalJournal.set(key, { plan: value, inFlight: true });
          if (valid(ticket)) { currentPlan.current = value; setPlan(value); }
        } });
        if (next.removed) removalJournal.delete(key); else removalJournal.set(key, { plan: next, inFlight: false });
        if (!valid(ticket)) return;
        currentPlan.current = next; setPlan(next);
        if (next.removed) await callbacks.current.onRemoved();
        else if (next.error) setError(next.error);
      } catch (cause) { if (valid(ticket)) setError(String(cause)); }
      finally {
        const saved = removalJournal.get(key); if (saved) saved.inFlight = false;
        if (active.current && scope.current === operationScope) { running.current = false; setBusy(false); }
      }
    },
  };
}
