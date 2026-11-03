import { useEffect, useRef, useState } from "react";
import { tauriListen } from "./bridge";
import { serviceErrorMessage, type ServiceIdentity } from "./chatgptService";
import { checkProfileUsername, decodeAccountMe, decodePublicProfile, loadAccountProfile, normalizeUsername, updateAccountName, updateProfileUsername, usernameValidationMessage, type AccountProfileSnapshot } from "./accountProfile";

type Editor = "name" | "username";
type NavigationGuard = (action: () => void) => boolean;
const localUsername = (value: string | null | undefined) => (value ?? "").split("~")[0];
const valueOf = (data: AccountProfileSnapshot, kind: Editor) => kind === "name" ? data.me?.name ?? "" : localUsername(data.profile?.username);
const sameIdentity = (a: ServiceIdentity | null | undefined, b: ServiceIdentity | null | undefined) => Boolean(a && b && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);

export function useAccountDetails({ accountIdentity, connectionIdentity, onNavigationGuardChange }: {
  accountIdentity?: string; connectionIdentity: string; onNavigationGuardChange?: (guard: NavigationGuard | null) => void;
}) {
  const context = JSON.stringify([accountIdentity, connectionIdentity]);
  const [snapshot, setSnapshot] = useState<AccountProfileSnapshot | null>(null);
  const [viewContext, setViewContext] = useState(context);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editor | null>(null), [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [editorError, setEditorError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"discard" | "reload" | null>(null), [externalChange, setExternalChange] = useState(false);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "unavailable" | "error">("idle");
  const [checkRevision, setCheckRevision] = useState(0);
  const current = useRef({ context, mounted: false }); current.current.context = context;
  const epoch = useRef(0), revision = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null);
  const data = useRef(snapshot); data.current = snapshot;
  const editor = useRef(editing); editor.current = editing;
  const text = useRef(draft); text.current = draft;
  const initial = useRef("");
  const operation = useRef(false), intent = useRef<{ kind: Editor; value: string } | null>(null);
  const navigation = useRef<{ context: string; action: () => void } | null>(null), queued = useRef(false);
  const checked = useRef<{ value: string; available: boolean; identity: ServiceIdentity } | null>(null);
  const valid = (version: number, captured: string) => current.current.mounted && epoch.current === version && current.current.context === captured;
  const dirty = () => editor.current !== null && (editor.current === "name" ? text.current !== initial.current : normalizeUsername(text.current) !== initial.current);
  const closeEditor = () => { editor.current = null; setEditing(null); intent.current = null; setPending(false); setEditorError(null); setConfirmation(null); setExternalChange(false); checked.current = null; };
  const reload = async (replaceDraft = false) => {
    if (operation.current) { queued.current = true; return; }
    const version = epoch.current, captured = context, request = ++revision.current;
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    setLoading(true); setError(null);
    try {
      const next = await loadAccountProfile(controller.signal);
      if (!valid(version, captured) || request !== revision.current || controller.signal.aborted) return;
      const previous = data.current?.identity;
      data.current = next; setSnapshot(next); setViewContext(captured);
      if (next.account.account?.type !== "chatgpt" || previous && next.identity && (previous.accountId !== next.identity.accountId || previous.userId !== next.identity.userId)) {
        navigation.current = null; closeEditor(); initial.current = ""; text.current = ""; setDraft("");
        setError("账户已更改，请重新读取后编辑。"); return;
      }
      const waiting = intent.current;
      if (waiting && valueOf(next, waiting.kind) === waiting.value) closeEditor();
      else if (editor.current && replaceDraft) {
        const value = valueOf(next, editor.current); initial.current = value; text.current = value; setDraft(value); setExternalChange(false);
      } else if (editor.current && valueOf(next, editor.current) !== initial.current) setExternalChange(true);
    } catch (cause) { if (valid(version, captured) && request === revision.current && !controller.signal.aborted) setError(serviceErrorMessage(cause)); }
    finally { if (valid(version, captured) && request === revision.current) setLoading(false); }
  };
  const latestReload = useRef(reload); latestReload.current = reload;
  const guard: NavigationGuard = action => {
    if (!current.current.mounted || current.current.context !== context) return true;
    if (operation.current) return false;
    if (!dirty() && !intent.current) return true;
    navigation.current = { context, action }; setConfirmation("discard"); return false;
  };
  const requestClose = () => { if (!operation.current && guard(closeEditor)) closeEditor(); };
  const requestReload = () => {
    if (operation.current) return;
    if (dirty() && !intent.current) setConfirmation("reload"); else void reload(true);
  };
  const confirmDiscard = () => {
    const action = navigation.current; navigation.current = null;
    if (confirmation === "reload") { setConfirmation(null); void reload(true); return; }
    closeEditor();
    if (action?.context === current.current.context) action.action();
  };
  const open = (kind: Editor) => {
    const selected = data.current;
    if (!selected?.identity || operation.current || selected.account.account?.type !== "chatgpt") return;
    if (kind === "name" ? !selected.me : selected.profile?.canEditUsername !== true) return;
    const value = valueOf(selected, kind); initial.current = value; text.current = value; editor.current = kind;
    setEditing(kind); setDraft(value); setEditorError(null); setExternalChange(false); intent.current = null; setPending(false);
  };
  const changeDraft = (value: string) => { if (!operation.current && !intent.current) { text.current = value; setDraft(value); checked.current = null; setEditorError(null); } };
  const save = async () => {
    const kind = editor.current, selected = data.current;
    if (!kind || !selected?.identity || operation.current || intent.current || !dirty()) return;
    const value = kind === "name" ? text.current : normalizeUsername(text.current);
    if (kind === "name" ? !value.trim() || !selected.me : selected.profile?.canEditUsername !== true || usernameValidationMessage(value) || checked.current?.value !== value || !checked.current.available || !sameIdentity(checked.current.identity, selected.identity)) return;
    const version = epoch.current, captured = context, identity = selected.identity;
    operation.current = true; revision.current++; reading.current?.abort(); setLoading(false); setBusy(true); setEditorError(null);
    const controller = new AbortController(); writing.current = controller;
    try {
      const result = await (kind === "name" ? updateAccountName(value, identity, controller.signal) : updateProfileUsername(value, identity, controller.signal));
      if (!valid(version, captured)) return;
      intent.current = { kind, value };
      const me = kind === "name" ? decodeAccountMe(result.readback, identity) : null;
      const profile = kind === "username" ? decodePublicProfile(result.readback) : null;
      const actual = kind === "name" ? me?.name : localUsername(profile?.username);
      if (result.verification !== "confirmed" || actual !== value) { intent.current = { kind, value }; setPending(true); setEditorError("已提交，等待资料同步。请重新读取核验。"); }
      else {
        const next = { ...selected, me: me ?? selected.me, profile: profile ?? selected.profile };
        data.current = next; setSnapshot(next); closeEditor(); queued.current = true;
      }
    } catch (cause) {
      if (valid(version, captured)) {
        if (intent.current || (cause as { code?: string })?.code === "profile_write_unknown") { intent.current = { kind, value }; setPending(true); }
        setEditorError(serviceErrorMessage(cause));
      }
    } finally {
      if (valid(version, captured)) {
        operation.current = false; setBusy(false);
        if (queued.current) { queued.current = false; void latestReload.current(); }
      }
    }
  };
  useEffect(() => {
    const selected = data.current, value = normalizeUsername(draft);
    checked.current = null; setAvailability("idle");
    if (editing !== "username" || !selected?.identity || value === initial.current || usernameValidationMessage(value) || pending) return;
    const controller = new AbortController(), version = epoch.current, captured = context;
    setAvailability("checking");
    const timer = setTimeout(() => {
      void checkProfileUsername(value, selected.identity!, controller.signal).then(result => {
        if (controller.signal.aborted || !valid(version, captured) || normalizeUsername(text.current) !== value || !sameIdentity(data.current?.identity, selected.identity)) return;
        checked.current = { value, available: result.available, identity: selected.identity! }; setAvailability(result.available ? "available" : "unavailable");
      }).catch(() => { if (!controller.signal.aborted && valid(version, captured) && normalizeUsername(text.current) === value) setAvailability("error"); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editing, draft, context, checkRevision, pending, snapshot?.identity?.accountId, snapshot?.identity?.userId, snapshot?.identity?.generation]);
  useEffect(() => {
    current.current.mounted = true; epoch.current++; revision.current++; operation.current = false; intent.current = null; navigation.current = null;
    setSnapshot(null); setViewContext(context); closeEditor(); setBusy(false); setLoading(false); setError(null);
    let disposed = false; const stops: (() => void)[] = [];
    const listen = <T,>(event: string, handler: (payload: T) => void) => void tauriListen<T>(event, handler)
      .then(stop => { if (disposed) stop(); else stops.push(stop); }).catch(() => { if (!disposed) setError("无法监听资料更新，请重新读取。"); });
    listen<{identity: ServiceIdentity}>("account-profile-changed", event => {
      if (disposed) return;
      const selected = data.current?.identity;
      if (!selected || selected.accountId === event.identity?.accountId && selected.userId === event.identity?.userId) void latestReload.current();
    });
    listen<{method: string}>("app-server:notification", event => { if (!disposed && event.method === "account/updated") void latestReload.current(); });
    listen<{connected: boolean}>("app-server:status", status => {
      if (disposed) return;
      if (status.connected) void latestReload.current();
      else { epoch.current++; revision.current++; reading.current?.abort(); writing.current?.abort(); operation.current = false; closeEditor(); setSnapshot(null); setBusy(false); setLoading(false); setError("连接已断开，请重新连接后重试。"); }
    });
    void latestReload.current();
    return () => { disposed = true; current.current.mounted = false; epoch.current++; revision.current++; reading.current?.abort(); writing.current?.abort(); stops.forEach(stop => stop()); };
  }, [context]);
  useEffect(() => { onNavigationGuardChange?.(guard); return () => onNavigationGuardChange?.(null); }, [context, onNavigationGuardChange]);
  const visible = viewContext === context;
  return { snapshot: visible ? snapshot : null, loading: visible && loading, error: visible ? error : null,
    editing: visible ? editing : null, draft: visible ? draft : "", busy: visible && busy, pending: visible && pending,
    editorError: visible ? editorError : null, availability, externalChange, confirmation: visible ? confirmation : null,
    open, changeDraft, save, requestClose, requestReload, confirmDiscard, keepEditing: () => { navigation.current = null; setConfirmation(null); },
    retryCheck: () => setCheckRevision(value => value + 1), dirty: dirty() };
}
