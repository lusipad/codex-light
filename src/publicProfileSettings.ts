import { useEffect, useRef, useState } from "react";
import { decodePublicProfile, loadAccountProfile, updatePublicProfile } from "./accountProfile";
import { tauriListen } from "./bridge";
import { serviceErrorMessage, type ServiceIdentity } from "./chatgptService";

type ProfileSnapshot = Awaited<ReturnType<typeof loadAccountProfile>>;
export type PublicProfileDraft = { displayName: string; bio: string };
const emptyDraft = (): PublicProfileDraft => ({ displayName: "", bio: "" });
const fields = (data: ProfileSnapshot | null): PublicProfileDraft => {
  const profile = data?.page ?? data?.profile;
  return { displayName: profile?.displayName ?? "", bio: profile?.bio ?? "" };
};
const sameIdentity = (a: ServiceIdentity | null | undefined, b: ServiceIdentity | null | undefined) =>
  Boolean(a && b && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);
const matches = (actual: PublicProfileDraft, edits: Partial<PublicProfileDraft>) =>
  Object.entries(edits).every(([key, value]) => actual[key as keyof PublicProfileDraft] === value);
export function publicProfileEdits(initial: PublicProfileDraft, draft: PublicProfileDraft): Partial<PublicProfileDraft> {
  const result: Partial<PublicProfileDraft> = {};
  for (const key of ["displayName", "bio"] as const) if (draft[key].trim() !== initial[key].trim()) result[key] = draft[key].trim();
  return result;
}

export function usePublicProfileSettings({ accountIdentity, connectionIdentity }: { accountIdentity?: string; connectionIdentity?: string }) {
  const context = JSON.stringify([accountIdentity, connectionIdentity]);
  const [data, setData] = useState<ProfileSnapshot | null>(null);
  const [viewContext, setViewContext] = useState(context);
  const [draft, setDraft] = useState<PublicProfileDraft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const currentContext = useRef(context); currentContext.current = context;
  const generation = useRef(0), revision = useRef(0);
  const currentData = useRef<ProfileSnapshot | null>(null);
  const currentDraft = useRef<PublicProfileDraft>(emptyDraft());
  const baseline = useRef<PublicProfileDraft>(emptyDraft());
  const currentEditing = useRef(false), busy = useRef(false), external = useRef(false);
  const submitted = useRef<Partial<PublicProfileDraft> | null>(null);
  const refreshQueued = useRef(false);
  const readController = useRef<AbortController | null>(null), writeController = useRef<AbortController | null>(null);
  const refresh = useRef<(replace?: boolean) => Promise<void>>(async () => {});
  const dirtyNow = () => currentEditing.current && (currentDraft.current.displayName !== baseline.current.displayName || currentDraft.current.bio !== baseline.current.bio);
  const valid = (version: number, key: string) => generation.current === version && currentContext.current === key;
  const setDraftValue = (value: PublicProfileDraft) => { currentDraft.current = value; setDraft(value); };
  const receive = (value: ProfileSnapshot) => { currentData.current = value; setData(value); setViewContext(currentContext.current); };
  const canEdit = (value: ProfileSnapshot | null) => value?.account.account?.type === "chatgpt" && value.identity !== null && value.page?.canEdit === true;
  const reload = async (replace = false) => {
    if (busy.current) return;
    const request = ++revision.current, version = generation.current, key = currentContext.current;
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    setLoading(true); if (!submitted.current) setError(null);
    try {
      const result = await loadAccountProfile(controller.signal);
      if (!valid(version, key) || request !== revision.current || controller.signal.aborted) return;
      const actual = fields(result), previous = currentData.current;
      receive(result);
      if (previous?.identity && result.identity && (previous.identity.accountId !== result.identity.accountId || previous.identity.userId !== result.identity.userId)) {
        currentEditing.current = false; setEditing(false); baseline.current = actual; setDraftValue(actual);
        submitted.current = null; setPending(false); external.current = false; setExternalChange(false);
        setError("账户已更改，请重新读取后编辑。"); return;
      }
      if (result.account.account?.type !== "chatgpt") {
        currentEditing.current = false; setEditing(false); baseline.current = emptyDraft(); setDraftValue(emptyDraft());
        submitted.current = null; setPending(false); external.current = false; setExternalChange(false); return;
      }
      if (submitted.current && matches(actual, submitted.current)) {
        baseline.current = actual; setDraftValue(actual); submitted.current = null; setPending(false);
        setError(null);
        currentEditing.current = false; setEditing(false); external.current = false; setExternalChange(false);
      } else if (replace || !dirtyNow()) {
        baseline.current = actual; setDraftValue(actual); external.current = false; setExternalChange(false);
      } else if (!matches(actual, baseline.current) || !sameIdentity(previous?.identity, result.identity)) {
        external.current = true; setExternalChange(true);
      }
    } catch (cause) {
      if (valid(version, key) && request === revision.current && !controller.signal.aborted) setError(`无法加载此个人资料：${serviceErrorMessage(cause)}`);
    } finally { if (valid(version, key) && request === revision.current) setLoading(false); }
  };
  refresh.current = reload;
  const discard = () => {
    if (busy.current) return;
    const actual = fields(currentData.current); baseline.current = actual; setDraftValue(actual);
    currentEditing.current = false; setEditing(false); setError(null); external.current = false; setExternalChange(false);
  };
  const save = async () => {
    const initial = currentData.current;
    if (busy.current || submitted.current || external.current || !currentEditing.current || !canEdit(initial) || !initial?.identity) return;
    const next = currentDraft.current;
    if (!next.displayName.trim() || next.displayName.length > 64 || next.bio.length > 140) return;
    const edits = publicProfileEdits(baseline.current, next);
    if (!Object.keys(edits).length) { discard(); return; }
    const key = currentContext.current, version = generation.current;
    busy.current = true; setSaving(true); setError(null);
    readController.current?.abort(); revision.current++; setLoading(false);
    const controller = new AbortController(); writeController.current = controller;
    try {
      const result = await updatePublicProfile(edits, initial.identity, controller.signal);
      if (!valid(version, key) || controller.signal.aborted) return;
      submitted.current = edits; setPending(true);
      const readback = decodePublicProfile(result.readback);
      if (readback) {
        const actual: Partial<PublicProfileDraft> = {};
        for (const field of ["displayName", "bio"] as const) if (typeof readback[field] === "string") actual[field] = readback[field];
        receive({ ...initial, profile: initial.profile ? { ...initial.profile, ...actual } : initial.profile,
          page: initial.page ? { ...initial.page, ...actual } : initial.page });
      }
      if (result.verification === "confirmed" && readback && matches({ displayName: readback.displayName ?? "", bio: readback.bio ?? "" }, edits)) {
        const actual = fields(currentData.current); baseline.current = actual; setDraftValue(actual);
        submitted.current = null; setPending(false);
        currentEditing.current = false; setEditing(false);
      } else { submitted.current = edits; setPending(true); }
    } catch (cause) {
      if (valid(version, key) && !controller.signal.aborted) {
        if ((cause as { code?: string })?.code === "profile_write_unknown") { submitted.current = edits; setPending(true); }
        setError(`无法更新个人资料：${serviceErrorMessage(cause)}`);
      }
    } finally {
      if (valid(version, key)) {
        busy.current = false; setSaving(false);
        if (refreshQueued.current) { refreshQueued.current = false; void refresh.current(); }
      }
    }
  };
  useEffect(() => {
    generation.current++; revision.current++; busy.current = false;
    currentData.current = null; baseline.current = emptyDraft(); currentDraft.current = emptyDraft(); currentEditing.current = false;
    submitted.current = null; external.current = false; refreshQueued.current = false;
    setData(null); setViewContext(context); setDraft(emptyDraft()); setEditing(false); setLoading(false); setSaving(false);
    setError(null); setPending(false); setExternalChange(false);
    let disposed = false; const stops: (() => void)[] = [];
    const subscribe = async () => {
      try {
        const stop = await tauriListen<{ identity: ServiceIdentity }>("account-profile-changed", event => {
          if (disposed || currentContext.current !== context) return;
          const identity = currentData.current?.identity;
          if (!identity || identity.accountId !== event.identity?.accountId || identity.userId !== event.identity?.userId) return;
          if (busy.current) refreshQueued.current = true;
          else if (dirtyNow()) { external.current = true; setExternalChange(true); }
          else void refresh.current();
        });
        if (disposed) stop(); else stops.push(stop);
      } catch (cause) { if (!disposed) setError(`无法接收个人资料变更：${serviceErrorMessage(cause)}`); }
    };
    void subscribe(); void reload();
    const focus = () => { if (!disposed) void refresh.current(); };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true; generation.current++; revision.current++; busy.current = false;
      readController.current?.abort(); writeController.current?.abort(); stops.forEach(stop => stop()); window.removeEventListener("focus", focus);
    };
  }, [context]);
  const visible = viewContext === context;
  return { data: visible ? data : null, profile: visible ? data?.page ?? data?.profile : null,
    draft: visible ? draft : emptyDraft(), editing: visible && editing, loading: visible && loading, saving: visible && saving,
    error: visible ? error : null, pending: visible && pending, externalChange: visible && externalChange,
    dirty: visible && dirtyNow(), canEdit: visible && canEdit(data), isDirty: dirtyNow, canNavigate: () => !busy.current,
    openEditor: () => { if (canEdit(currentData.current) && !busy.current) { baseline.current = fields(currentData.current); setDraftValue(baseline.current); currentEditing.current = true; setEditing(true); external.current = false; setExternalChange(false); } },
    setField: (field: keyof PublicProfileDraft, value: string) => {
      if (busy.current || submitted.current) return;
      setDraftValue({ ...currentDraft.current, [field]: field === "bio" ? value.replace(/\r\n|[\r\n\u2028\u2029]/g, " ") : value });
    }, discard, save, reload };
}
