import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { readLocalAppshotsAccess, type AppshotsQualification } from "./appshotsAccess";
import { capturedAppshotContext, type DraftAppshot } from "./appshotContext";
import type { ServiceIdentity } from "./chatgptService";
import { AppshotIntroDialog } from "./components/AppshotIntroDialog";

interface EntryMetadata { appName: string; bundleIdentifier: string; windowTitle: string | null }
interface RouteEvent { type: "route"; id: string; account: string; composer: string; route: "current" | "new-chat"; metadata: EntryMetadata; requestedAt: string }
interface CaptureEvent { type: "capture"; id: string; account: string; composer: string; metadata: EntryMetadata; imageDataUrl: string; axTree: string | null }
type EntryEvent = RouteEvent | CaptureEvent | { type: "retired"; id: string } | { type: "failed"; id?: string; message: string }
  | { type: "state"; supported: boolean; registration: "none" | "pending" | "ready" };
interface Flight { route: RouteEvent; phase: "claiming" | "intro" | "accepting" | "accepted"; capture?: CaptureEvent; captureRequestedAt?: string }
interface EntryProps {
  enabled: boolean;
  scope: string;
  canAccept: boolean;
  isNewChat: boolean;
  contextKey: string;
  captureGeneration: number;
  getCaptureGeneration: () => number;
  onCapture: (appshot: DraftAppshot) => void;
  onError: (message: string) => void;
}
interface Intro { token: object; id: string; isCurrent: () => boolean; accept: () => void; decline: () => void }
const sameIdentity = (left: ServiceIdentity, right: ServiceIdentity) => left.userId === right.userId && left.accountId === right.accountId && left.generation === right.generation;
const metadataValid = (value: EntryMetadata | null | undefined) => value != null && typeof value.appName === "string" && !!value.appName.trim()
  && typeof value.bundleIdentifier === "string" && !!value.bundleIdentifier.trim() && (value.windowTitle === null || typeof value.windowTitle === "string");

/** Main-window current-Composer consumer only. Work/new-chat access is not inferred
 * from Appshots gates, registration, or acceptance of the introduction. */
export function useAppshotsEntry(props: EntryProps): { intro: ReactNode } {
  const latest = useRef(props); latest.current = props;
  const key = JSON.stringify([props.enabled, props.scope, props.contextKey, props.canAccept, props.isNewChat, props.captureGeneration]);
  const lifetime = useRef({ key });
  if (lifetime.current.key !== key) lifetime.current = { key };
  const token = lifetime.current;
  const stopping = useRef<Promise<unknown>>(Promise.resolve());
  const [intro, setIntro] = useState<Intro | null>(null);

  useEffect(() => {
    if (!props.enabled) { setIntro(null); return; }
    const controller = new AbortController(), flights = new Map<string, Flight>(), seen = new Set<string>();
    let identity: ServiceIdentity | null = null, account = "", eligible: AppshotsQualification = null;
    let unlisten: (() => void) | undefined, unlistenIdentity: (() => void) | undefined, introId: string | null = null;
    const current = () => lifetime.current === token && !controller.signal.aborted && latest.current.enabled
      && latest.current.getCaptureGeneration() === props.captureGeneration;
    const report = (message: string) => { if (current()) latest.current.onError(message); };
    const clearIntro = (id: string) => {
      if (introId === id) introId = null;
      if (current()) setIntro(previous => previous?.token === token && previous.id === id ? null : previous);
    };
    const stop = () => {
      const operation = stopping.current.catch(() => {}).then(() => tauriInvoke("appshots_entry_stop"));
      stopping.current = operation;
      return operation;
    };
    const request = (id: string) => ({ identity: identity!, id, composer: props.scope });
    const decline = async (id: string) => {
      if (!identity) return;
      flights.delete(id); clearIntro(id);
      try { await tauriInvoke("appshots_entry_decline", { request: request(id) }); }
      catch { report("无法取消应用快照请求，请重新触发。"); }
    };
    const deliver = (id: string, capture: CaptureEvent) => {
      const flight = flights.get(id);
      if (!current() || !latest.current.canAccept || !flight || flight.phase !== "accepted") return;
      if (!metadataValid(capture.metadata) || capture.metadata.bundleIdentifier !== flight.route.metadata.bundleIdentifier ||
          typeof capture.imageDataUrl !== "string" || !/^data:image\/(?:png|jpeg);base64,/.test(capture.imageDataUrl) ||
          capture.axTree !== null && typeof capture.axTree !== "string") {
        flights.delete(id); report("应用快照结果无效，未附加到消息。"); return;
      }
      if (!flight.captureRequestedAt) { flights.delete(id); report("应用快照请求信息已失效。"); return; }
      const context = capturedAppshotContext({ ...flight.route.metadata, imageDataUrl: capture.imageDataUrl, axTree: capture.axTree }, flight.captureRequestedAt);
      flights.delete(id);
      if (!context) { report("未能获取应用快照图像。"); return; }
      try { latest.current.onCapture({ id, context, capture: { scope: props.scope, generation: props.captureGeneration } }); }
      catch { report("无法附加应用快照，请重新触发。"); }
    };
    const configure = (activeIdentity: ServiceIdentity, value: AppshotsQualification) => tauriInvoke<{
      supported: boolean; registration: "none" | "pending" | "ready"; introAccepted: boolean;
    }>("appshots_entry_configure", { request: { identity: activeIdentity, eligible: value, composer: props.scope,
      canAccept: props.canAccept, isNewChat: props.isNewChat } });
    const accept = async (id: string, acceptIntro: boolean) => {
      const flight = flights.get(id);
      if (!current() || !identity || !latest.current.canAccept || !flight || !["claiming", "intro"].includes(flight.phase)) return;
      flight.phase = "accepting"; clearIntro(id);
      try {
        const access = await readLocalAppshotsAccess(controller.signal, "windows");
        if (!current() || !flights.has(id)) return;
        if (!sameIdentity(identity, access.identity)) throw Error("Changed account");
        eligible = access.enabled;
        if (eligible !== true) {
          report("当前无法使用应用快照。");
          await decline(id);
          if (current()) await configure(identity, eligible);
          return;
        }
        // C02: the filename clock starts in the capture continuation after the
        // intro, not when the shortcut first locked its target.
        flight.captureRequestedAt = new Date().toISOString();
        const accepted = await tauriInvoke<boolean>("appshots_entry_accept", { request: { ...request(id), acceptIntro } });
        if (!current() || !flights.has(id)) return;
        if (accepted !== true) throw Error("Retired request");
        flight.phase = "accepted";
        if (flight.capture) deliver(id, flight.capture);
      } catch {
        if (!current() || !flights.has(id)) return;
        await decline(id);
        report("未能创建应用快照，请重新触发。");
      }
    };
    const route = async (event: RouteEvent) => {
      if (!current() || !identity || seen.has(event.id)) return;
      seen.add(event.id);
      if (!metadataValid(event.metadata) || typeof event.requestedAt !== "string" || !Number.isFinite(Date.parse(event.requestedAt))) return;
      flights.set(event.id, { route: event, phase: "claiming" });
      const blockingDialog = document.querySelector("dialog[open]:not(.appshot-intro-dialog)");
      if (event.route !== "current" || !latest.current.canAccept || eligible !== true || blockingDialog) { await decline(event.id); return; }
      try {
        const claim = await tauriInvoke<{ accepted: boolean; introAccepted: boolean }>("appshots_entry_claim", { request: request(event.id) });
        if (!current() || !flights.has(event.id)) return;
        if (claim.accepted !== true) { flights.delete(event.id); return; }
        if (claim.introAccepted === true) { await accept(event.id, false); return; }
        if (introId && introId !== event.id) void decline(introId);
        flights.get(event.id)!.phase = "intro"; introId = event.id;
        setIntro({ token, id: event.id, isCurrent: current,
          accept: () => { void accept(event.id, true); }, decline: () => { void decline(event.id); } });
      } catch { if (current() && flights.has(event.id)) { await decline(event.id); report("无法处理应用快照请求，请重新触发。"); } }
    };
    const receive = (event: EntryEvent) => {
      if (!current() || !event || typeof event.type !== "string") return;
      if (event.type === "retired") { flights.delete(event.id); clearIntro(event.id); return; }
      if (event.type === "failed") {
        if (event.id && !flights.has(event.id)) return;
        if (event.id) { flights.delete(event.id); clearIntro(event.id); }
        if (typeof event.message === "string") report(event.message);
        return;
      }
      if (event.type === "state") {
        if (event.registration === "none") { flights.clear(); introId = null; setIntro(null); }
        return;
      }
      if (!identity || event.account !== account || event.composer !== props.scope || typeof event.id !== "string" || !event.id) return;
      if (event.type === "route") { void route(event); return; }
      const flight = flights.get(event.id);
      if (!flight) return;
      if (flight.phase === "accepted") deliver(event.id, event);
      else if (flight.phase === "accepting") flight.capture = event;
    };
    void (async () => {
      try {
        await stop(); if (!current()) return;
        unlisten = await tauriListen<EntryEvent>("appshots:entry", receive);
        if (!current()) { unlisten(); return; }
        unlistenIdentity = await tauriListen("chatgpt-service:invalidated", () => {
          if (!current()) return;
          setIntro(null); flights.clear(); introId = null; controller.abort();
          void stop().catch(() => {});
        });
        if (!current()) { unlistenIdentity(); return; }
        const access = await readLocalAppshotsAccess(controller.signal, "windows");
        if (!current()) return;
        identity = { ...access.identity }; eligible = access.enabled;
        account = JSON.stringify([identity.userId, identity.accountId, identity.generation]);
        await configure(identity, eligible);
      } catch { report("无法读取应用快照资格或注册快捷键，请重新读取设置。"); }
    })();
    return () => {
      controller.abort(); unlisten?.(); unlistenIdentity?.(); flights.clear(); introId = null;
      void stop().catch(() => {});
    };
  }, [key]);

  return { intro: intro?.token === token && props.enabled ? createElement(AppshotIntroDialog, {
    key: intro.id, isCurrent: intro.isCurrent, onAccept: intro.accept, onClose: intro.decline,
  }) : null };
}
