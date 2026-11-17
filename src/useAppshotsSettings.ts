import { useEffect, useRef, useState } from "react";
import { isTauriRuntime, tauriListen } from "./bridge";
import { readLocalAppshotsAccess, type AppshotsAccess } from "./appshotsAccess";
import { serviceErrorMessage } from "./chatgptService";
import { readAppshotsSettings, readAppshotsDestination, setAppshotsHotkey, writeAppshotsDestination,
  type AppshotsSettingsSnapshot, type AppshotsHotkey, type AppshotsDestination } from "./appshotsSettings";

interface SettingsView {
  token: object;
  snapshot: AppshotsSettingsSnapshot | null;
  access: AppshotsAccess | null;
  destination: string;
  hotkeyPending: boolean;
  hotkeyError: string | null;
}
interface Actions {
  token: object;
  hotkey: (value: AppshotsHotkey) => void;
  destination: (value: AppshotsDestination) => void;
}

export function useAppshotsSettings({ scope, connected, onError }: {
  scope: string; connected: boolean; onError?: (message: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const enabled = connected && isTauriRuntime() && navigator.platform.startsWith("Win");
  const key = JSON.stringify([scope, enabled, revision]);
  const lifetime = useRef({ key });
  if (lifetime.current.key !== key) lifetime.current = { key };
  const token = lifetime.current;
  const notify = useRef(onError); notify.current = onError;
  const [view, setView] = useState<SettingsView | null>(null);
  const actions = useRef<Actions | null>(null);
  // Keep old and new scopes' writes serialized; cancellation cannot undo a write
  // already delivered to app-server. A new choice always gets a fresh version.
  const destinationQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(), signal = controller.signal;
    let access: AppshotsAccess | null = null, snapshot: AppshotsSettingsSnapshot | null = null;
    let destination = "automatic", confirmedDestination = "automatic", hotkeyPending = false, hotkeyError: string | null = null;
    let destinationWrites = 0, destinationVersion = 0, readVersion = 0, stateVersion = 0;
    const unlisten: (() => void)[] = [];
    const current = () => lifetime.current === token && !signal.aborted;
    const publish = () => { if (current()) setView({ token, access, snapshot, destination, hotkeyPending, hotkeyError }); };
    const report = (cause: unknown) => { if (current()) notify.current?.(serviceErrorMessage(cause)); };
    const reload = async () => {
      if (!current()) return;
      if (hotkeyPending || destinationWrites) { return; }
      const request = ++readVersion;
      try {
        const nextAccess = await readLocalAppshotsAccess(signal, "windows");
        if (!current() || request !== readVersion) return;
        access = nextAccess;
        if (access.enabled !== true) { snapshot = null; publish(); return; }
        const next = await readAppshotsDestination(access.identity, signal);
        if (!current() || request !== readVersion) return;
        snapshot = next; confirmedDestination = next.destination; destination = next.destination; publish();
      } catch (cause) { if (request === readVersion) report(cause); }
    };
    const afterWrite = () => {
      publish();
      if (!hotkeyPending && !destinationWrites) { void reload(); }
    };
    const runtimeSince = (next: AppshotsSettingsSnapshot, started: number) => snapshot && stateVersion !== started
      ? { ...next, supported: snapshot.supported, registration: snapshot.registration } : next;
    const qualified = () => current() && access?.enabled === true && snapshot?.eligible === true
      && snapshot.ownerState === "active" && snapshot.supported === true;
    actions.current = {
      token,
      hotkey: value => {
        if (!qualified() || hotkeyPending || !snapshot || !access) return;
        hotkeyError = null;
        if (snapshot.configuredHotkey === value) { publish(); return; }
        const identity = access.identity, startedState = stateVersion;
        hotkeyPending = true; readVersion++; publish();
        void (async () => {
          try {
            const fresh = await readLocalAppshotsAccess(signal, "windows");
            if (!current()) return;
            if (fresh.enabled !== true || fresh.identity.accountId !== identity.accountId || fresh.identity.userId !== identity.userId || fresh.identity.generation !== identity.generation) {
              access = fresh; snapshot = null; throw Error("应用快照账号或资格已变化。");
            }
            snapshot = runtimeSince(await setAppshotsHotkey(identity, value, signal), startedState);
          } catch (cause) {
            if (!current()) return;
            hotkeyError = serviceErrorMessage(cause);
            try { const startedRead = stateVersion; snapshot = runtimeSince(await readAppshotsSettings(identity, signal), startedRead); } catch { /* Keep the actual error and last confirmed selection. */ }
          } finally {
            if (current()) { hotkeyPending = false; afterWrite(); }
          }
        })();
      },
      destination: value => {
        if (!qualified() || !snapshot || !access) return;
        const identity = access.identity, request = ++destinationVersion, startedState = stateVersion;
        destination = value; destinationWrites++; readVersion++; publish();
        const write = async () => {
          if (!current()) return;
          try {
            const result = await writeAppshotsDestination(identity, value, signal);
            if (!current()) return;
            confirmedDestination = result.effective.destination;
            if (request !== destinationVersion) return;
            const next = runtimeSince(result.effective, startedState);
            // A destination result does not acknowledge a separate hotkey write.
            snapshot = snapshot ? { ...next, configuredHotkey: snapshot.configuredHotkey,
              configuredHotkeyDefaulted: snapshot.configuredHotkeyDefaulted } : next;
            destination = confirmedDestination;
          } catch {
            if (!current() || request !== destinationVersion) return;
            destination = confirmedDestination;
            notify.current?.("无法保存应用快照目标目标");
          } finally {
            destinationWrites--;
            if (current()) afterWrite();
          }
        };
        const queued = destinationQueue.current.then(write, write);
        destinationQueue.current = queued.catch(() => {});
      },
    };
    void (async () => {
      try {
        const entry = await tauriListen<{ type?: string; supported?: boolean; registration?: string }>("appshots:entry", event => {
          if (!current() || event?.type !== "state") return;
          if (typeof event.supported === "boolean" && ["none", "pending", "ready"].includes(event.registration ?? "")) {
            stateVersion++;
            if (snapshot) { snapshot = { ...snapshot, supported: event.supported,
              registration: event.registration as AppshotsSettingsSnapshot["registration"] }; publish(); }
          }
          if (!hotkeyPending && !destinationWrites) void reload();
        });
        if (!current()) { entry(); return; } unlisten.push(entry);
        const identity = await tauriListen("chatgpt-service:invalidated", () => {
          if (!current()) return;
          controller.abort(); setView(null); setRevision(value => value + 1);
        });
        if (!current()) { identity(); return; } unlisten.push(identity);
        const changes = await tauriListen("appshots-settings-changed", () => { if (current()) void reload(); });
        if (!current()) { changes(); return; } unlisten.push(changes);
        await reload();
      } catch (cause) { report(cause); }
    })();
    return () => { controller.abort(); unlisten.forEach(stop => stop()); if (actions.current?.token === token) actions.current = null; };
  }, [key]);

  const current = view?.token === token && enabled ? view : null;
  return {
    available: current?.access?.enabled === true && current.snapshot?.eligible === true
      && current.snapshot.ownerState === "active" && current.snapshot.supported === true,
    configuredHotkey: current?.snapshot?.configuredHotkey ?? null,
    supported: current?.snapshot?.supported ?? null,
    hotkeyPending: current?.hotkeyPending ?? false,
    hotkeyError: current?.hotkeyError ?? null,
    destination: current?.destination ?? "automatic",
    miniFeature: current?.access?.miniFeature ?? null,
    onHotkeyChange: (value: AppshotsHotkey) => { if (actions.current?.token === token) actions.current.hotkey(value); },
    onDestinationChange: (value: AppshotsDestination) => { if (actions.current?.token === token) actions.current.destination(value); },
  };
}
