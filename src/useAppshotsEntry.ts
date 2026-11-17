import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { tauriInvoke, tauriListen } from "./bridge";
import { readLocalAppshotsAccess, type AppshotsQualification } from "./appshotsAccess";
import { capturedAppshotContext, type DraftAppshot } from "./appshotContext";
import type { ServiceIdentity } from "./chatgptService";
import { AppshotIntroDialog } from "./components/AppshotIntroDialog";

interface EntryMetadata { appName: string; bundleIdentifier: string; windowTitle: string | null }
interface RouteEvent { type: "route"; id: string; account: string; composer: string; captureGeneration: number; route: "current" | "new-chat"; metadata: EntryMetadata; requestedAt: string }
interface CaptureEvent { type: "capture"; id: string; account: string; composer: string; captureGeneration: number; metadata: EntryMetadata; imageDataUrl: string; axTree: string | null }
type EntryEvent = RouteEvent | CaptureEvent | { type: "retired"; id: string } | { type: "failed"; id?: string; message: string }
  | { type: "state"; supported: boolean; registration: "none" | "pending" | "ready" };
interface Consumer { key: string; sequence: number; scope: string; canAccept: boolean; isNewChat: boolean; captureGeneration: number }
interface ContextAck { composer: string; captureGeneration: number; canAccept: boolean; isNewChat: boolean }
interface Flight { consumer: Consumer; route: RouteEvent; phase: "claiming" | "intro" | "accepting" | "accepted"; capture?: CaptureEvent; captureRequestedAt?: string; captureOrder?: number }
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
export function useAppshotsEntry(props: EntryProps): { intro: ReactNode; pendingIds: string[] } {
  const ownerKey = JSON.stringify([props.enabled, props.contextKey]);
  const ownerToken = useMemo(() => ({ key: ownerKey }), [ownerKey]);
  const consumerKey = JSON.stringify([ownerKey, props.scope, props.canAccept, props.isNewChat, props.captureGeneration]);
  const token = useMemo<Consumer>(() => ({ key: consumerKey, sequence: 0, scope: props.scope,
    canAccept: props.canAccept, isNewChat: props.isNewChat, captureGeneration: props.captureGeneration }), [ownerToken, consumerKey]);
  const latest = useRef(props), lifetime = useRef<object | null>(ownerToken), consumer = useRef(token), consumerSequence = useRef(0);
  // Only committed frames change the live lease. Abandoned renders may create
  // pure tokens, but cannot retire the still-mounted owner's callbacks.
  useLayoutEffect(() => {
    latest.current = props; lifetime.current = ownerToken;
    if (consumer.current !== token) { token.sequence = ++consumerSequence.current; consumer.current = token; }
  });
  useLayoutEffect(() => () => { if (lifetime.current === ownerToken) lifetime.current = null; }, [ownerToken]);
  const contextAction = useRef<{ owner: object; update: (value: Consumer) => void } | null>(null);
  const stopping = useRef<Promise<unknown>>(Promise.resolve());
  const captureSequence = useRef(0);
  const [intro, setIntro] = useState<Intro | null>(null);
  const [pending, setPending] = useState<{ token: object; ids: string[] } | null>(null);

  useEffect(() => {
    if (!props.enabled) { setIntro(null); setPending(null); return; }
    const controller = new AbortController(), flights = new Map<string, Flight>(), seen = new Set<string>();
    let identity: ServiceIdentity | null = null, account = "", eligible: AppshotsQualification = null;
    let unlisten: (() => void) | undefined, unlistenIdentity: (() => void) | undefined, introId: string | null = null;
    let acknowledged: Consumer | null = null, setup: Promise<void> = Promise.resolve(), contextTail: Promise<void> = Promise.resolve();
    const ownerCurrent = () => lifetime.current === ownerToken && !controller.signal.aborted && latest.current.enabled;
    const current = (value: Consumer) => ownerCurrent() && consumer.current === value
      && latest.current.getCaptureGeneration() === value.captureGeneration;
    const report = (message: string) => { if (ownerCurrent()) latest.current.onError(message); };
    const clearPending = (value: Consumer, id: string) => {
      if (ownerCurrent()) setPending(previous => previous?.token === value
        ? { token: value, ids: previous.ids.filter(item => item !== id) } : previous);
    };
    const clearIntro = (id: string) => {
      if (introId === id) introId = null;
      if (ownerCurrent()) setIntro(previous => previous?.id === id ? null : previous);
    };
    const retireLocal = () => {
      flights.clear(); introId = null;
      if (ownerCurrent()) { setIntro(null); setPending(null); }
    };
    const stop = () => {
      const operation = stopping.current.catch(() => {}).then(() => tauriInvoke("appshots_entry_stop"));
      stopping.current = operation;
      return operation;
    };
    const closeOwner = () => {
      retireLocal(); controller.abort(); unlisten?.(); unlistenIdentity?.();
      void stop().catch(() => {});
    };
    const request = (id: string, value: Consumer) => ({ identity: identity!, id, composer: value.scope,
      captureGeneration: value.captureGeneration });
    const decline = async (id: string) => {
      const flight = flights.get(id);
      if (!ownerCurrent() || !identity || !flight) return;
      flights.delete(id); clearIntro(id); clearPending(flight.consumer, id);
      try { await tauriInvoke("appshots_entry_decline", { request: request(id, flight.consumer) }); }
      catch { if (current(flight.consumer)) report("无法取消应用快照请求，请重新触发。"); }
    };
    const deliver = (id: string, capture: CaptureEvent) => {
      const flight = flights.get(id);
      if (!flight || !current(flight.consumer) || acknowledged !== flight.consumer || !flight.consumer.canAccept || flight.phase !== "accepted") return;
      if (!metadataValid(capture.metadata) || capture.metadata.bundleIdentifier !== flight.route.metadata.bundleIdentifier ||
          typeof capture.imageDataUrl !== "string" || !/^data:image\/(?:png|jpeg);base64,/.test(capture.imageDataUrl) ||
          capture.axTree !== null && typeof capture.axTree !== "string") {
        flights.delete(id); clearPending(flight.consumer, id); report("应用快照结果无效，未附加到消息。"); return;
      }
      if (!flight.captureRequestedAt) { flights.delete(id); clearPending(flight.consumer, id); report("应用快照请求信息已失效。"); return; }
      const context = capturedAppshotContext({ ...flight.route.metadata, imageDataUrl: capture.imageDataUrl, axTree: capture.axTree }, flight.captureRequestedAt);
      flights.delete(id); clearPending(flight.consumer, id);
      if (!context) { report("未能获取应用快照图像。"); return; }
      try { latest.current.onCapture({ id, context, capture: { scope: flight.consumer.scope, generation: flight.consumer.captureGeneration, order: flight.captureOrder } }); }
      catch { report("无法附加应用快照，请重新触发。"); }
    };
    const contextFields = (value: Consumer): ContextAck => ({ composer: value.scope, captureGeneration: value.captureGeneration,
      canAccept: value.canAccept, isNewChat: value.isNewChat });
    const confirm = (ack: ContextAck, value: Consumer) => {
      if (!ack || ack.composer !== value.scope || ack.captureGeneration !== value.captureGeneration
          || ack.canAccept !== value.canAccept || ack.isNewChat !== value.isNewChat) throw Error("Invalid Appshot context ACK");
      acknowledged = value;
    };
    contextAction.current = { owner: ownerToken, update: value => {
      retireLocal();
      contextTail = contextTail.then(async () => {
        await setup;
        if (!ownerCurrent() || !identity || !acknowledged || value.sequence <= acknowledged.sequence) return;
        const ack = await tauriInvoke<ContextAck>("appshots_entry_context", { request: { identity,
          previousComposer: acknowledged.scope, previousCaptureGeneration: acknowledged.captureGeneration, ...contextFields(value) } });
        if (ownerCurrent()) confirm(ack, value);
      }).catch(() => {
        if (ownerCurrent()) { report("无法更新应用快照输入框，请重新读取设置。"); closeOwner(); }
      });
    } };
    const accept = async (id: string, acceptIntro: boolean) => {
      const flight = flights.get(id);
      if (!flight || !current(flight.consumer) || acknowledged !== flight.consumer || !identity
          || !flight.consumer.canAccept || !["claiming", "intro"].includes(flight.phase)) return;
      const value = flight.consumer;
      flight.phase = "accepting"; clearIntro(id);
      try {
        const access = await readLocalAppshotsAccess(controller.signal, "windows");
        if (!current(value) || flights.get(id) !== flight) return;
        eligible = access.enabled;
        if (!sameIdentity(identity, access.identity) || eligible !== true) {
          report("当前无法使用应用快照。");
          await decline(id);
          if (ownerCurrent()) closeOwner();
          return;
        }
        // C02: the filename clock starts in the capture continuation after the intro.
        flight.captureRequestedAt = new Date().toISOString();
        flight.captureOrder = ++captureSequence.current;
        flushSync(() => setPending(previous => ({ token: value, ids: previous?.token === value ? [...previous.ids, id] : [id] })));
        if (!current(value) || flights.get(id) !== flight) return;
        const accepted = await tauriInvoke<boolean>("appshots_entry_accept", { request: { ...request(id, value), acceptIntro } });
        if (!current(value) || flights.get(id) !== flight) return;
        if (accepted !== true) throw Error("Retired request");
        flight.phase = "accepted";
        if (flight.capture) deliver(id, flight.capture);
      } catch {
        if (!current(value) || flights.get(id) !== flight) return;
        await decline(id);
        if (current(value)) report("未能创建应用快照，请重新触发。");
      }
    };
    const route = async (event: RouteEvent, value: Consumer) => {
      if (!current(value) || !identity || seen.has(event.id)) return;
      seen.add(event.id);
      if (!metadataValid(event.metadata) || typeof event.requestedAt !== "string" || !Number.isFinite(Date.parse(event.requestedAt))) return;
      const flight: Flight = { consumer: value, route: event, phase: "claiming" };
      flights.set(event.id, flight);
      // Native may have applied this tuple before its real ACK reaches JS.
      await setup; await contextTail;
      if (!current(value) || flights.get(event.id) !== flight || acknowledged !== value) return;
      const blockingDialog = document.querySelector("dialog[open]:not(.appshot-intro-dialog)");
      if (event.route !== "current" || !value.canAccept || eligible !== true || blockingDialog) { await decline(event.id); return; }
      try {
        const claim = await tauriInvoke<{ accepted: boolean; introAccepted: boolean }>("appshots_entry_claim", { request: request(event.id, value) });
        if (!current(value) || flights.get(event.id) !== flight) return;
        if (claim.accepted !== true) { flights.delete(event.id); return; }
        if (claim.introAccepted === true) { await accept(event.id, false); return; }
        if (introId && introId !== event.id) void decline(introId);
        flight.phase = "intro"; introId = event.id;
        setIntro({ token: value, id: event.id, isCurrent: () => current(value),
          accept: () => { void accept(event.id, true); }, decline: () => { if (current(value)) void decline(event.id); } });
      } catch { if (current(value) && flights.get(event.id) === flight) { await decline(event.id); if (current(value)) report("无法处理应用快照请求，请重新触发。"); } }
    };
    const receive = (event: EntryEvent) => {
      if (!ownerCurrent() || !event || typeof event.type !== "string") return;
      if (event.type === "retired" || event.type === "failed" && event.id) {
        const id = event.id!, flight = flights.get(id);
        if (!flight) return;
        flights.delete(id); clearIntro(id); clearPending(flight.consumer, id);
        if (event.type === "failed" && current(flight.consumer) && typeof event.message === "string") report(event.message);
        return;
      }
      if (event.type === "failed") { retireLocal(); if (typeof event.message === "string") report(event.message); return; }
      if (event.type === "state") { if (event.registration === "none") retireLocal(); return; }
      const value = consumer.current;
      if (!current(value) || !identity || event.account !== account || event.composer !== value.scope
          || event.captureGeneration !== value.captureGeneration || typeof event.id !== "string" || !event.id) return;
      if (event.type === "route") { void route(event, value); return; }
      const flight = flights.get(event.id);
      if (!flight || flight.consumer !== value) return;
      if (flight.phase === "accepted") deliver(event.id, event);
      else if (flight.phase === "accepting") flight.capture = event;
    };
    setup = (async () => {
      try {
        await stop(); if (!ownerCurrent()) return;
        unlisten = await tauriListen<EntryEvent>("appshots:entry", receive);
        if (!ownerCurrent()) { unlisten(); return; }
        unlistenIdentity = await tauriListen("chatgpt-service:invalidated", () => {
          if (ownerCurrent()) closeOwner();
        });
        if (!ownerCurrent()) { unlistenIdentity(); return; }
        const access = await readLocalAppshotsAccess(controller.signal, "windows");
        if (!ownerCurrent()) return;
        identity = { ...access.identity }; eligible = access.enabled;
        account = JSON.stringify([identity.userId, identity.accountId, identity.generation]);
        const value = consumer.current;
        const ack = await tauriInvoke<ContextAck>("appshots_entry_configure", { request: {
          identity, eligible, ...contextFields(value) } });
        if (ownerCurrent()) confirm(ack, value);
      } catch {
        if (ownerCurrent()) { report("无法读取应用快照资格或注册快捷键，请重新读取设置。"); closeOwner(); }
      }
    })();
    return () => {
      controller.abort(); unlisten?.(); unlistenIdentity?.(); flights.clear(); introId = null;
      if (contextAction.current?.owner === ownerToken) contextAction.current = null;
      void stop().catch(() => {});
    };
  }, [ownerToken]);

  useEffect(() => { contextAction.current?.update(token); }, [token]);
  const consumerCurrent = props.enabled && props.getCaptureGeneration() === token.captureGeneration;
  return { intro: intro?.token === token && consumerCurrent ? createElement(AppshotIntroDialog, {
    key: intro.id, isCurrent: intro.isCurrent, onAccept: intro.accept, onClose: intro.decline,
  }) : null, pendingIds: pending?.token === token && consumerCurrent ? pending.ids : [] };
}
