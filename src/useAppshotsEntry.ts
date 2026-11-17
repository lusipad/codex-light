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
interface Consumer { key: string; sequence: number; scope: string; canAccept: boolean; isNewChat: boolean; captureGeneration: number; workContextKey: string | null }
interface ContextAck { composer: string; captureGeneration: number; canAccept: boolean; isNewChat: boolean }
interface Flight { consumer: Consumer; route: RouteEvent; phase: "claiming" | "intro" | "accepting" | "accepted"; capture?: CaptureEvent; captureRequestedAt?: string; captureOrder?: number; work?: WorkTransition }
export interface AppshotWorkPlan { key: string; scope: string; captureGeneration: number; activate: (signal: AbortSignal) => Promise<boolean> }
interface WorkTransition { flight: Flight; from: Consumer; controller: AbortController; plan: AppshotWorkPlan | null; activated: boolean; attempted: Consumer | null; detach: () => void }
export interface AppshotComposerInput { element: HTMLTextAreaElement; scope: string }
interface EntryProps {
  enabled: boolean;
  scope: string;
  canAccept: boolean;
  composerInput: AppshotComposerInput | null;
  isNewChat: boolean;
  contextKey: string;
  captureGeneration: number;
  getCaptureGeneration: () => number;
  onCapture: (appshot: DraftAppshot) => void;
  onError: (message: string) => void;
  readNewChatAccess?: (identity: ServiceIdentity, signal: AbortSignal) => Promise<boolean | null>;
  prepareNewChat?: (id: string, identity: ServiceIdentity, signal: AbortSignal) => Promise<AppshotWorkPlan>;
  workContextKey?: string | null;
}
interface Intro { token: object; id: string; isCurrent: () => boolean; accept: () => void; decline: () => void }
const sameIdentity = (left: ServiceIdentity, right: ServiceIdentity) => left.userId === right.userId && left.accountId === right.accountId && left.generation === right.generation;
const metadataValid = (value: EntryMetadata | null | undefined) => value != null && typeof value.appName === "string" && !!value.appName.trim()
  && typeof value.bundleIdentifier === "string" && !!value.bundleIdentifier.trim() && (value.windowTitle === null || typeof value.windowTitle === "string");
const inputReady = (input: AppshotComposerInput | null, scope: string) => input !== null && input.scope === scope
  && input.element.isConnected && !input.element.disabled && !input.element.readOnly && !input.element.closest("[inert]");

/** Main-window capture consumer. Work/new-chat access is never inferred
 * from Appshots gates, registration, or acceptance of the introduction. */
export function useAppshotsEntry(props: EntryProps): { intro: ReactNode; pendingIds: string[] } {
  const [, setInputRevision] = useState(0);
  const inputAvailable = inputReady(props.composerInput, props.scope);
  const canAccept = props.canAccept && inputAvailable;
  useLayoutEffect(() => {
    const input = props.composerInput;
    if (!input) return;
    let active = true, ready = inputAvailable;
    const publish = () => {
      if (!active) return;
      const next = inputReady(input, props.scope);
      if (ready !== next) { ready = next; setInputRevision(value => value + 1); }
    };
    const observer = new MutationObserver(publish);
    observer.observe(input.element.ownerDocument, { subtree: true, childList: true,
      attributes: true, attributeFilter: ["inert", "disabled", "readonly"] });
    publish();
    return () => { active = false; observer.disconnect(); };
  }, [props.composerInput, props.scope]);
  const ownerKey = JSON.stringify([props.enabled, props.contextKey]);
  const ownerToken = useMemo(() => ({ key: ownerKey }), [ownerKey]);
  const consumerKey = JSON.stringify([ownerKey, props.scope, canAccept, props.isNewChat, props.captureGeneration, props.workContextKey ?? null]);
  const token = useMemo<Consumer>(() => ({ key: consumerKey, sequence: 0, scope: props.scope,
    canAccept, isNewChat: props.isNewChat, captureGeneration: props.captureGeneration, workContextKey: props.workContextKey ?? null }), [ownerToken, consumerKey]);
  const latest = useRef(props), lifetime = useRef<object | null>(ownerToken), consumer = useRef(token), consumerSequence = useRef(0);
  // Only committed frames change the live lease. Abandoned renders may create
  // pure tokens, but cannot retire the still-mounted owner's callbacks.
  useLayoutEffect(() => {
    latest.current = props; lifetime.current = ownerToken;
    if (consumer.current !== token) { token.sequence = ++consumerSequence.current; consumer.current = token; }
    if (contextAction.current?.owner === ownerToken) contextAction.current.fence(token);
  });
  useLayoutEffect(() => () => {
    if (lifetime.current === ownerToken) lifetime.current = null;
    if (contextAction.current?.owner === ownerToken) contextAction.current.fence();
  }, [ownerToken]);
  const contextAction = useRef<{ owner: object; fence: (value?: Consumer) => void; update: (value: Consumer) => void } | null>(null);
  const stopping = useRef<Promise<unknown>>(Promise.resolve());
  const captureSequence = useRef(0);
  const [intro, setIntro] = useState<Intro | null>(null);
  const [pending, setPending] = useState<{ token: object; ids: string[] } | null>(null);

  useEffect(() => {
    if (!props.enabled) { setIntro(null); setPending(null); return; }
    const controller = new AbortController(), flights = new Map<string, Flight>(), seen = new Set<string>();
    let identity: ServiceIdentity | null = null, account = "", eligible: AppshotsQualification = null;
    let workAllowed: boolean | null = null, planned: WorkTransition | null = null;
    let unlisten: (() => void) | undefined, unlistenIdentity: (() => void) | undefined, introId: string | null = null;
    let acknowledged: Consumer | null = null, setup: Promise<void> = Promise.resolve(), contextTail: Promise<void> = Promise.resolve();
    const ownerCurrent = () => lifetime.current === ownerToken && !controller.signal.aborted && latest.current.enabled;
    const contextCurrent = (value: Consumer) => ownerCurrent() && consumer.current === value
      && latest.current.getCaptureGeneration() === value.captureGeneration;
    const current = (value: Consumer) => contextCurrent(value)
      && (!value.canAccept || inputReady(latest.current.composerInput, value.scope));
    const plannedContext = (value: Consumer, work: WorkTransition) => value === work.from || work.plan !== null
      && value.workContextKey === work.plan.key && (value.scope === work.from.scope && value.captureGeneration === work.from.captureGeneration
        || value.scope === work.plan.scope && value.captureGeneration === work.plan.captureGeneration);
    const workCurrent = (work: WorkTransition) => ownerCurrent() && !work.controller.signal.aborted
      && flights.get(work.flight.route.id) === work.flight && contextCurrent(consumer.current) && plannedContext(consumer.current, work);
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
      for (const flight of flights.values()) flight.work?.controller.abort();
      planned = null;
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
      flight.work?.controller.abort();
      if (planned === flight.work) planned = null;
      flights.delete(id); clearIntro(id); clearPending(flight.consumer, id);
      const tuples = flight.work?.attempted ? [flight.work.attempted, flight.work.from] : [flight.consumer];
      let completed = false;
      for (const value of tuples) {
        if (!ownerCurrent()) return;
        try { await tauriInvoke("appshots_entry_decline", { request: request(id, value) }); completed = true; } catch { /* A lost handoff ACK can leave either exact tuple current. */ }
      }
      if (!completed && current(flight.consumer)) report("无法取消应用快照请求，请重新触发。");
    };
    const deliver = (id: string, capture: CaptureEvent) => {
      const flight = flights.get(id);
      if (!flight || !current(flight.consumer) || acknowledged !== flight.consumer || !flight.consumer.canAccept || flight.phase !== "accepted") return;
      if (!metadataValid(capture.metadata) || capture.metadata.bundleIdentifier !== flight.route.metadata.bundleIdentifier ||
          typeof capture.imageDataUrl !== "string" || !/^data:image\/(?:png|jpeg);base64,/.test(capture.imageDataUrl) ||
          capture.axTree !== null && typeof capture.axTree !== "string") {
        flight.work?.controller.abort();
        flights.delete(id); clearPending(flight.consumer, id); report("应用快照结果无效，未附加到消息。"); return;
      }
      if (!flight.captureRequestedAt) { flight.work?.controller.abort(); flights.delete(id); clearPending(flight.consumer, id); report("应用快照请求信息已失效。"); return; }
      const context = capturedAppshotContext({ ...flight.route.metadata, imageDataUrl: capture.imageDataUrl, axTree: capture.axTree }, flight.captureRequestedAt);
      flight.work?.detach();
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
    contextAction.current = { owner: ownerToken, fence: value => {
      if (!value) { controller.abort(); return; }
      for (const flight of flights.values()) if (flight.work && !plannedContext(value, flight.work)) flight.work.controller.abort();
    }, update: value => {
      if (planned && plannedContext(value, planned)) { advanceWork(planned); return; }
      const interruptedWork = planned ?? [...flights.values()].find(flight => flight.work)?.work;
      if (interruptedWork) {
        const work = interruptedWork, id = work.flight.route.id;
        const cancellation = decline(id);
        if (work.attempted) {
          retireLocal();
          contextTail = contextTail.then(async () => { await cancellation; await restoreWorkContext(work); });
          return;
        }
        contextTail = contextTail.then(() => cancellation);
      }
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
    const offerIntro = async (flight: Flight, introAccepted: boolean) => {
      const id = flight.route.id, value = flight.consumer;
      if (!current(value) || flights.get(id) !== flight || acknowledged !== value) return;
      if (introAccepted) { await accept(id, false); return; }
      if (introId && introId !== id) void decline(introId);
      flight.phase = "intro"; introId = id;
      setIntro({ token: value, id, isCurrent: () => current(value),
        accept: () => { void accept(id, true); }, decline: () => { if (current(value)) void decline(id); } });
    };
    const restoreWorkContext = async (work: WorkTransition) => {
      if (!ownerCurrent() || planned) return;
      acknowledged = null;
      // Lost ACKs leave only these two known CAS candidates. Do not recreate the
      // owner or manufacture confirmation when both attempts fail.
      for (const previous of [work.from, work.attempted].filter((value): value is Consumer => value !== null)) {
        if (!ownerCurrent() || planned) return;
        const target = consumer.current;
        try {
          const ack = await tauriInvoke<ContextAck>("appshots_entry_context", { request: { identity,
            previousComposer: previous.scope, previousCaptureGeneration: previous.captureGeneration, ...contextFields(target) } });
          if (!ownerCurrent() || planned) return;
          confirm(ack, target); return;
        } catch { /* Only the other already-known tuple remains eligible. */ }
      }
      if (ownerCurrent()) report("应用快照输入框状态未确认，请重新读取设置。");
    };
    const advanceWork = (work: WorkTransition) => {
      const value = consumer.current, plan = work.plan;
      if (!plan || !work.activated || work.attempted || !workCurrent(work) || value.workContextKey !== plan.key
          || value.scope !== plan.scope || value.captureGeneration !== plan.captureGeneration
          || !value.canAccept || !value.isNewChat || !current(value)) return;
      work.attempted = value;
      contextTail = contextTail.then(async () => {
        if (!workCurrent(work) || consumer.current !== value) throw Error("Retired Work consumer");
        const ack = await tauriInvoke<ContextAck & { accepted: boolean; introAccepted: boolean }>("appshots_entry_handoff", {
          request: { ...request(work.flight.route.id, work.from), targetComposer: value.scope,
            targetCaptureGeneration: value.captureGeneration, canAccept: value.canAccept, isNewChat: value.isNewChat } });
        if (!workCurrent(work) || !current(value)) throw Error("Retired Work consumer");
        if (ack?.accepted !== true || typeof ack.introAccepted !== "boolean") throw Error("Work handoff rejected");
        confirm(ack, value);
        work.flight.consumer = value; planned = null;
        await offerIntro(work.flight, ack.introAccepted);
      }).catch(async () => {
        if (!ownerCurrent() || flights.get(work.flight.route.id) !== work.flight) return;
        report("无法将应用快照交接到 Work 新聊天。");
        await decline(work.flight.route.id);
        await restoreWorkContext(work);
      });
    };
    const prepareWork = async (flight: Flight) => {
      const prepare = latest.current.prepareNewChat;
      if (!identity || workAllowed !== true || !latest.current.readNewChatAccess || !prepare) { await decline(flight.route.id); return; }
      const work: WorkTransition = { flight, from: flight.consumer, controller: new AbortController(), plan: null, activated: false, attempted: null, detach: () => {} };
      flight.work = work;
      const abort = () => work.controller.abort();
      work.detach = () => controller.signal.removeEventListener("abort", abort);
      controller.signal.addEventListener("abort", abort, { once: true });
      work.controller.signal.addEventListener("abort", work.detach, { once: true });
      try {
        const plan = await prepare(flight.route.id, identity, work.controller.signal);
        if (!workCurrent(work)) return;
        if (!plan || typeof plan.key !== "string" || !plan.key || typeof plan.scope !== "string" || !plan.scope
            || !Number.isSafeInteger(plan.captureGeneration) || plan.captureGeneration < 0 || typeof plan.activate !== "function") throw Error("Invalid Work plan");
        work.plan = plan; planned = work;
        const activated = await plan.activate(work.controller.signal);
        if (!workCurrent(work)) { if (ownerCurrent() && flights.get(flight.route.id) === flight) await decline(flight.route.id); return; }
        if (activated !== true) {
          await decline(flight.route.id);
          if (ownerCurrent()) contextAction.current?.update(consumer.current);
          return;
        }
        work.activated = true; advanceWork(work);
      } catch {
        if (!ownerCurrent() || flights.get(flight.route.id) !== flight) return;
        await decline(flight.route.id);
        if (ownerCurrent()) { report("无法准备 Work 新聊天，请重试。"); contextAction.current?.update(consumer.current); }
      }
    };
    const route = async (event: RouteEvent, value: Consumer) => {
      const valid = () => event.route === "new-chat" ? contextCurrent(value) : current(value);
      if (!valid() || !identity || seen.has(event.id)) return;
      seen.add(event.id);
      if (!metadataValid(event.metadata) || typeof event.requestedAt !== "string" || !Number.isFinite(Date.parse(event.requestedAt))) return;
      const flight: Flight = { consumer: value, route: event, phase: "claiming" };
      flights.set(event.id, flight);
      // Native may have applied this tuple before its real ACK reaches JS.
      await setup; await contextTail;
      if (!valid() || flights.get(event.id) !== flight || acknowledged !== value) return;
      const blockingDialog = document.querySelector("dialog[open]:not(.appshot-intro-dialog)");
      if (event.route === "current" && !value.canAccept || eligible !== true || blockingDialog
          || event.route === "new-chat" && (workAllowed !== true || !latest.current.readNewChatAccess || !latest.current.prepareNewChat)) { await decline(event.id); return; }
      try {
        const claim = await tauriInvoke<{ accepted: boolean; introAccepted: boolean }>("appshots_entry_claim", { request: request(event.id, value) });
        if (!valid() || flights.get(event.id) !== flight) return;
        if (claim.accepted !== true) { flights.delete(event.id); return; }
        if (event.route === "new-chat") { await prepareWork(flight); return; }
        await offerIntro(flight, claim.introAccepted);
      } catch { if (valid() && flights.get(event.id) === flight) { await decline(event.id); if (valid()) report("无法处理应用快照请求，请重新触发。"); } }
    };
    const receive = (event: EntryEvent) => {
      if (!ownerCurrent() || !event || typeof event.type !== "string") return;
      if (event.type === "retired" || event.type === "failed" && event.id) {
        const id = event.id!, flight = flights.get(id);
        if (!flight) return;
        const work = flight.work, wasPlanned = work !== undefined && planned === work;
        flight.work?.controller.abort();
        if (planned === flight.work) planned = null;
        flights.delete(id); clearIntro(id); clearPending(flight.consumer, id);
        if (wasPlanned) {
          if (work.attempted) contextTail = contextTail.then(() => restoreWorkContext(work));
          else contextAction.current?.update(consumer.current);
        }
        if (event.type === "failed" && current(flight.consumer) && typeof event.message === "string") report(event.message);
        return;
      }
      if (event.type === "failed") { retireLocal(); if (typeof event.message === "string") report(event.message); return; }
      if (event.type === "state") { if (event.registration === "none") retireLocal(); return; }
      const value = consumer.current;
      const valid = event.type === "route" && event.route === "new-chat" ? contextCurrent(value) : current(value);
      if (!valid || !identity || event.account !== account || event.composer !== value.scope
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
        if (latest.current.readNewChatAccess && latest.current.prepareNewChat) {
          try {
            const allowed = await latest.current.readNewChatAccess(identity, controller.signal);
            workAllowed = typeof allowed === "boolean" ? allowed : null;
          } catch { workAllowed = null; }
          if (!ownerCurrent()) return;
        }
        const value = consumer.current;
        const ack = await tauriInvoke<ContextAck>("appshots_entry_configure", { request: {
          identity, eligible, workAllowed, ...contextFields(value) } });
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
  const consumerCurrent = props.enabled && props.getCaptureGeneration() === token.captureGeneration && canAccept;
  return { intro: intro?.token === token && consumerCurrent ? createElement(AppshotIntroDialog, {
    key: intro.id, isCurrent: intro.isCurrent, onAccept: intro.accept, onClose: intro.decline,
  }) : null, pendingIds: pending?.token === token && consumerCurrent ? pending.ids : [] };
}
