import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { WorkModelCatalog, WorkModelSelection } from "../workModelCatalog";
import { projectWorkModelPickerState, type WorkModelPickerState } from "../workModelPickerState";
import "./WorkModelPicker.css";

export interface WorkModelPickerProps {
  catalog: WorkModelCatalog | null;
  selection: WorkModelSelection | null;
  loading: boolean;
  error?: string | null;
  pending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (selection: WorkModelSelection) => Promise<boolean>;
  onVersionPreference?: (value: { versionId: string; selectionMode: "default" | "model" }) => Promise<boolean | void>;
  versionPreference?: { versionId: string; selectionMode: "default" | "model" } | null;
  refresh: () => void;
  /** Account/host/home-entry identity supplied by the actual consumer. */
  contextKey?: string | null;
}
const key = (selection: WorkModelSelection | null) => JSON.stringify(selection && [selection.slug, selection.thinkingEffort, selection.versionId ?? null]);

export function WorkModelPicker(props: WorkModelPickerProps) {
  const { catalog, selection, loading, pending, open, onOpenChange, onCommit, refresh, contextKey = null } = props;
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const olderTrigger = useRef<HTMLButtonElement>(null), slider = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"simple" | "advanced">("simple"), [older, setOlder] = useState(false);
  const [draft, setDraft] = useState<{ selection: WorkModelSelection; base: string; context: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [versionPending, setVersionPending] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 316, subLeft: 0, subTop: 0 });
  const base = key(selection), effectiveDraft = draft?.base === base && draft.context === contextKey ? draft.selection : null;
  const state = useMemo<WorkModelPickerState>(() => catalog && selection
    ? projectWorkModelPickerState({ catalog, selection: effectiveDraft ?? selection, versionPreference: props.versionPreference })
    : { label: "模型", powerOptions: [], selectedPowerId: null, rows: [], defaultSelection: null, activeVersionId: null, selectionMode: "default" }, [catalog, effectiveDraft, selection, props.versionPreference]);
  const unavailable = loading || pending || catalog === null || selection === null;
  const active = open && !unavailable, simple = view === "simple" && state.powerOptions.length > 1;
  const live = useRef({ mounted: true, contextKey, base, active, draft: effectiveDraft, onCommit, onOpenChange });
  const sending = useRef(false), sequence = useRef(0), pointerBase = useRef<WorkModelSelection | null>(null);
  const versionSequence = useRef(0), versionSaving = useRef(false);
  useLayoutEffect(() => {
    if (live.current.contextKey !== contextKey || live.current.base !== base) pointerBase.current = null;
    if (live.current.contextKey !== contextKey) { sequence.current++; versionSequence.current++; sending.current = false; versionSaving.current = false; setVersionPending(false); setDraft(null); setFailure(null); setOlder(false); }
    live.current = { mounted: true, contextKey, base, active, draft: effectiveDraft, onCommit, onOpenChange };
  });
  useLayoutEffect(() => () => { live.current.mounted = false; sequence.current++; versionSequence.current++; }, []);
  const stage = (next: WorkModelSelection) => { setDraft({ selection: next, base, context: contextKey }); setFailure(null); };
  const close = (focus = true) => {
    const current = live.current;
    if (!current.mounted || sending.current) return;
    current.onOpenChange(false); setOlder(false);
    if (focus && document.hasFocus()) trigger.current?.focus({ preventScroll: true });
    if (versionSaving.current) return;
    if (!current.draft || key(current.draft) === current.base) return;
    sending.current = true;
    const ticket = ++sequence.current, scope = current.contextKey;
    void Promise.resolve().then(() => live.current.mounted && live.current.contextKey === scope && sequence.current === ticket
      ? current.onCommit(current.draft!) : false).then(ok => {
      if (live.current.mounted && live.current.contextKey === scope && sequence.current === ticket) {
        if (ok) setDraft(null); else setFailure("无法应用所选设置。请重试");
      }
    }, () => {
      if (live.current.mounted && live.current.contextKey === scope && sequence.current === ticket) setFailure("无法应用所选设置。请重试");
    }).finally(() => { if (sequence.current === ticket) sending.current = false; });
  };

  useEffect(() => {
    if (open) return;
    const timeout = window.setTimeout(() => { setView("simple"); setOlder(false); }, 350);
    return () => window.clearTimeout(timeout);
  }, [open]);
  useLayoutEffect(() => {
    if (!active) return;
    const positionMenu = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = menu.current?.offsetWidth || 254, height = menu.current?.offsetHeight || 180;
      const above = rect.top - 8, below = window.innerHeight - rect.bottom - 8, upward = below < height && above > below;
      const maxHeight = Math.max(32, Math.min(316, upward ? above : below));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const top = upward ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4;
      const sub = olderTrigger.current?.getBoundingClientRect();
      setPosition({ left, top, maxHeight, subLeft: left + width + 237 < window.innerWidth ? left + width + 4 : Math.max(8, left - 237),
        subTop: Math.max(8, Math.min(sub?.top ?? top, window.innerHeight - Math.min(316, height) - 8)) });
    };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    positionMenu(); document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", positionMenu); window.addEventListener("scroll", positionMenu, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); };
  }, [active, view, older]);
  useLayoutEffect(() => {
    if (!active) return;
    const region = older ? menu.current?.querySelector<HTMLElement>("[data-work-older]") : menu.current;
    if (simple && !older) { slider.current?.focus({ preventScroll: true }); return; }
    const selected = region?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)');
    (selected ?? region?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)'))?.focus({ preventScroll: true });
    if (!older) region?.querySelector<HTMLElement>(".work-model-picker-list")?.scrollTo({ top: 0 });
  }, [active, simple, older]);
  const keys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape" || older && event.key === "ArrowLeft") {
      event.preventDefault(); event.stopPropagation();
      if (older) { setOlder(false); olderTrigger.current?.focus(); } else close();
      return;
    }
    if (event.target === slider.current) {
      if (event.key === "Enter") { event.preventDefault(); close(); }
      return;
    }
    if (!["Tab", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const region = older ? menu.current?.querySelector<HTMLElement>("[data-work-older]") : menu.current;
    const items = Array.from(region?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])
      .filter(item => !item.closest("[inert]") && (older || !item.closest("[data-work-older]")));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey ? -1 : 1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus();
  };
  const selectRow = async (item: (typeof state.rows)[number]) => {
    if (!item.selection || item.disabled || versionSaving.current) return;
    if (item.selected) { close(); return; }
    const choice = item;
    if ((choice.kind === "version" || choice.kind === "default") && choice.versionId != null && props.onVersionPreference) {
      const ticket = ++versionSequence.current, scope = contextKey;
      versionSaving.current = true; setVersionPending(true); setFailure(null);
      try {
        const ok = await props.onVersionPreference({ versionId: choice.versionId, selectionMode: choice.kind === "default" ? "default" : "model" });
        if (!live.current.mounted || live.current.contextKey !== scope || versionSequence.current !== ticket || !live.current.active) return;
        if (ok === false) { setFailure("无法应用所选设置。请重试"); return; }
      } catch {
        if (live.current.mounted && live.current.contextKey === scope && versionSequence.current === ticket) setFailure("无法应用所选设置。请重试");
        return;
      } finally {
        if (live.current.mounted && live.current.contextKey === scope && versionSequence.current === ticket) {
          versionSaving.current = false; setVersionPending(false);
        }
      }
    }
    stage(item.selection); setOlder(false); setView("simple");
  };
  const row = (item: (typeof state.rows)[number]) => <button type="button" key={item.id} role="menuitemradio" aria-checked={item.selected}
    disabled={item.disabled || !item.selection || versionPending} className="work-model-picker-row" onClick={() => {
      if (!item.selection || item.disabled) return;
      void selectRow(item);
    }}><span><span>{item.label}</span>{item.description && <small>{item.description}</small>}</span>{item.selected && <Check size={16} aria-hidden="true" />}</button>;
  const selectedPower = Math.max(0, state.powerOptions.findIndex(option => option.id === state.selectedPowerId));
  return <span className="work-model-picker">
    <button type="button" ref={trigger} className="work-model-picker-trigger" aria-label="选择 ChatGPT 模型" aria-haspopup="menu"
      aria-expanded={active} aria-controls={active ? `${id}-menu` : undefined} disabled={unavailable} title={failure ?? props.error ?? "选择 ChatGPT 模型"}
      onClick={() => { if (active) close(); else if (!unavailable && !sending.current) { setFailure(null); onOpenChange(true); } }}
      onKeyDown={event => { if (!event.nativeEvent.isComposing && ["ArrowDown", "ArrowUp"].includes(event.key) && !unavailable) { event.preventDefault(); onOpenChange(true); } }}>
      <span>{loading ? "正在加载模型…" : state.label || "模型"}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {props.error && !catalog && <button type="button" className="work-model-picker-retry" onClick={refresh}>重试加载模型</button>}
    {failure && <span role="alert" className="sr-only">{failure}</span>}
    {active && createPortal(<div ref={menu} id={`${id}-menu`} role="menu" aria-label="选择模型" className="work-model-picker-menu"
      onKeyDown={keys} style={{ left: position.left, top: position.top, "--work-model-max-height": `${position.maxHeight}px` } as React.CSSProperties}>
      <div aria-hidden={!simple} inert={!simple} hidden={!simple} className="work-model-picker-simple">
        <button type="button" role="menuitem" className="work-model-picker-model" onClick={() => setView("advanced")}>
          <span>{state.label}</span><ChevronDown size={14} aria-hidden="true" />
        </button>
        <div className="work-model-picker-power">
          <input ref={slider} type="range" min={0} max={Math.max(0, state.powerOptions.length - 1)} step={1} value={selectedPower}
            aria-label="思考强度" aria-valuetext={state.powerOptions[selectedPower]?.label}
            onPointerDown={() => { pointerBase.current = effectiveDraft ?? selection; }}
            onPointerCancel={() => { if (pointerBase.current) stage(pointerBase.current); pointerBase.current = null; }}
            onPointerUp={() => { if (pointerBase.current) { pointerBase.current = null; close(); } }}
            onChange={event => { const option = state.powerOptions[Number(event.target.value)]; if (option && !option.disabled) stage(option.selection); }} />
          <div className="work-model-picker-endpoints"><span>{state.powerOptions[0]?.label}</span><span>{state.powerOptions.at(-1)?.label}</span></div>
          <div className="work-model-picker-power-label">{state.powerOptions[selectedPower]?.label}</div>
        </div>
      </div>
      <div aria-hidden={simple} inert={simple} hidden={simple}>
        <div className="work-model-picker-heading">选择模型</div>
        <div className="work-model-picker-list">{state.rows.filter(item => item.group !== "older").map(row)}
          {state.rows.some(item => item.group === "older") && <button type="button" ref={olderTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={older}
            className="work-model-picker-row" onClick={() => setOlder(!older)} onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); setOlder(true); } }}>
            <span>旧版模型</span><ChevronRight size={16} aria-hidden="true" /></button>}
        </div>
      </div>
      {failure && <div role="alert" className="work-model-picker-error">{failure}</div>}
      {older && <div role="menu" aria-label="旧版模型" data-work-older="" className="work-model-picker-older" style={{ left: position.subLeft, top: position.subTop }}>{state.rows.filter(item => item.group === "older").map(row)}</div>}
    </div>, document.body)}
  </span>;
}
