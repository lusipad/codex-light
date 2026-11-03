import { useEffect, useRef, useState } from "react";
import { callAppServer, tauriInvoke, tauriListen } from "./bridge";
import type { AccountReadResult } from "./config";

export type LoginMethods = { status: "loading" | "ready" | "unsupported" | "error"; api: boolean; chatgpt: boolean };
const unavailable = (status: LoginMethods["status"]): LoginMethods => ({ status, api: false, chatgpt: false });
export function managedLoginMethods(requirements: unknown, config?: unknown): LoginMethods {
  if (requirements === null) {
    if (!config || typeof config !== "object" || Array.isArray(config)) return unavailable("error");
    const forced = (config as Record<string, unknown>).forced_login_method;
    return { status: "ready", api: forced == null || forced === "api", chatgpt: forced == null || forced === "chatgpt" };
  }
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) return unavailable("error");
  if (!("allowedLoginMethods" in requirements)) return unavailable("unsupported");
  const allowed = (requirements as Record<string, unknown>).allowedLoginMethods;
  if (allowed !== null && (!Array.isArray(allowed) || allowed.some(value => value !== "api" && value !== "chatgpt"))) return unavailable("error");
  return { status: "ready", api: allowed === null || (allowed as string[]).includes("api"), chatgpt: allowed === null || (allowed as string[]).includes("chatgpt") };
}
export function validateLoginUrl(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) throw Error("登录地址无效。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("登录地址无效。");
  return url.href;
}
async function readAccount(): Promise<AccountReadResult> {
  const result = await callAppServer<AccountReadResult>("account/read", { refreshToken: false });
  if (!result || !Object.prototype.hasOwnProperty.call(result, "account") || typeof result.requiresOpenaiAuth !== "boolean" ||
    (result.account !== null && (typeof result.account !== "object" || typeof result.account.type !== "string"))) throw Error("无法识别账户状态，请重试。");
  return result;
}
type LoginCompletion = { loginId?: string | null; success?: boolean; error?: string | null };
type Attempt = { id: string | null; generation: number; context: string; connection: string; service: number; cancelled: boolean; events: Map<string, LoginCompletion>; finishing: boolean; cleanupCancelled?: boolean };

export function useAccountSession({ active, accountIdentity, connectionIdentity, onAccountChanged }: {
  active: boolean; accountIdentity: string; connectionIdentity: string; onAccountChanged?: () => void | Promise<void>;
}) {
  const identity = JSON.stringify([accountIdentity, connectionIdentity]);
  const [info, setInfo] = useState<AccountReadResult | null>(null);
  const [viewIdentity, setViewIdentity] = useState(identity);
  const [methods, setMethods] = useState<LoginMethods>(unavailable("loading"));
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"chatgpt" | "api" | "cancel" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventsReady, setEventsReady] = useState(false);
  const [listenerRevision, setListenerRevision] = useState(0);
  const current = useRef({ identity, connectionIdentity, active }); current.current = { identity, connectionIdentity, active };
  const generation = useRef(0), readRevision = useRef(0);
  const serviceGeneration = useRef(0), previousConnection = useRef(connectionIdentity);
  if (previousConnection.current !== connectionIdentity) { previousConnection.current = connectionIdentity; serviceGeneration.current++; }
  const mounted = useRef(false), ready = useRef(false);
  const operation = useRef<string | null>(null), attempt = useRef<Attempt | null>(null);
  const methodsRef = useRef(methods); methodsRef.current = methods;
  const changed = useRef(onAccountChanged); changed.current = onAccountChanged;
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const valid = (version: number, context: string) => mounted.current && current.current.active && current.current.identity === context && generation.current === version;
  const sameService = (login: Attempt) => current.current.connectionIdentity === login.connection && serviceGeneration.current === login.service;
  const refreshParent = async (version: number, context: string) => {
    if (valid(version, context)) {
      try { await changed.current?.(); }
      catch { if (valid(version, context)) setError("账户已更新，但无法刷新应用。请重试。"); }
    }
  };
  const reload = async () => {
    if (!current.current.active || operation.current) return;
    const version = generation.current, context = current.current.identity, revision = ++readRevision.current;
    setLoading(true); setError(null); setMethods(unavailable("loading"));
    const [account, restrictions] = await Promise.allSettled([
      readAccount(),
      (async () => {
        const response = await callAppServer<{ requirements: unknown }>("configRequirements/read", {});
        if (!response || !Object.prototype.hasOwnProperty.call(response, "requirements")) return unavailable("error");
        if (response.requirements !== null) return managedLoginMethods(response.requirements);
        const fallback = await callAppServer<{ config: unknown }>("config/read", { includeLayers: false });
        return managedLoginMethods(null, fallback?.config);
      })(),
    ]);
    if (!valid(version, context) || readRevision.current !== revision) return;
    setInfo(account.status === "fulfilled" ? account.value : null);
    setMethods(restrictions.status === "fulfilled" ? restrictions.value : unavailable("error"));
    setViewIdentity(context); setLoading(false);
    if (account.status === "rejected") setError(`无法读取账户：${String(account.reason)}`);
  };
  reloadRef.current = reload;
  const cancelId = async (id: string) => {
    const result = await callAppServer<{ status: string }>("account/login/cancel", { loginId: id });
    if (!result || !["canceled", "notFound"].includes(result.status)) throw Error("未能确认登录已取消，请重试。");
  };
  const finish = async (login: Attempt, completion: LoginCompletion) => {
    if (attempt.current !== login || login.cancelled || login.finishing || !valid(login.generation, login.context)) return;
    login.finishing = true;
    try {
      if (completion.success !== true) throw Error(completion.error || "登录未完成。");
      const result = await readAccount();
      if (!valid(login.generation, login.context) || attempt.current !== login || login.cancelled) return;
      if (result.account?.type !== "chatgpt") throw Error("登录完成后仍未能确认 ChatGPT 账户，请重试。");
      setInfo(result); setViewIdentity(login.context);
      attempt.current = null; operation.current = null; setPhase(null);
      await refreshParent(login.generation, login.context);
    } catch (cause) {
      if (valid(login.generation, login.context) && attempt.current === login && !login.cancelled) {
        attempt.current = null; operation.current = null; setPhase(null); setError(`登录失败：${String(cause)}`);
      }
    }
  };
  const startChatgpt = async () => {
    if (!ready.current || operation.current || attempt.current || loading || !methodsRef.current.chatgpt || methodsRef.current.status !== "ready") return;
    const login: Attempt = { id: null, generation: generation.current, context: current.current.identity, connection: current.current.connectionIdentity, service: serviceGeneration.current, cancelled: false, events: new Map(), finishing: false };
    attempt.current = login; operation.current = "chatgpt"; readRevision.current++; setPhase("chatgpt"); setError(null);
    try {
      const response = await callAppServer<{ type: string; loginId?: string; authUrl?: string }>("account/login/start", { type: "chatgpt" });
      if (response?.type !== "chatgpt" || typeof response.loginId !== "string" || !response.loginId) throw Error("无法识别登录响应。");
      login.id = response.loginId;
      if (login.cancelled || !valid(login.generation, login.context) || attempt.current !== login) {
        if (sameService(login) && !login.cleanupCancelled) { login.cleanupCancelled = true; await cancelId(login.id); }
        return;
      }
      const url = validateLoginUrl(response.authUrl);
      await tauriInvoke("review_link_open", { url });
      if (login.cancelled || attempt.current !== login || !valid(login.generation, login.context)) return;
      const early = login.events.get(login.id);
      login.events.clear();
      if (early) void finish(login, early);
    } catch (cause) {
      if (login.id && !login.cancelled && sameService(login)) {
        try { await cancelId(login.id); } catch { /* Preserve the original start/open error. */ }
      }
      if (valid(login.generation, login.context) && attempt.current === login && !login.cancelled) {
        attempt.current = null; operation.current = null; setPhase(null); setError(`登录失败：${String(cause)}`);
      }
    } finally {
      if (login.cancelled && valid(login.generation, login.context) && attempt.current === login) {
        attempt.current = null; operation.current = null; setPhase(null);
      }
    }
  };
  const cancelLogin = async () => {
    const login = attempt.current;
    if (!login || login.cancelled) return;
    login.cancelled = true; setPhase("cancel");
    if (!login.id) return;
    try {
      await cancelId(login.id);
      if (valid(login.generation, login.context) && attempt.current === login) {
        attempt.current = null; operation.current = null; setPhase(null);
        await reloadRef.current(); await refreshParent(login.generation, login.context);
      }
    } catch (cause) {
      if (valid(login.generation, login.context) && attempt.current === login) {
        login.cancelled = false; setPhase("chatgpt"); setError(`取消登录失败：${String(cause)}`);
      }
    }
  };
  const loginApiKey = async (key: string) => {
    if (!key.trim() || !ready.current || operation.current || loading || methodsRef.current.status !== "ready" || !methodsRef.current.api) return;
    const version = generation.current, context = current.current.identity;
    operation.current = "api"; readRevision.current++; setPhase("api"); setError(null);
    try {
      const response = await callAppServer<{ type: string }>("account/login/start", { type: "apiKey", apiKey: key });
      if (!valid(version, context)) return;
      if (response?.type !== "apiKey") throw Error("无法识别登录响应。");
      const result = await readAccount();
      if (!valid(version, context)) return;
      if (result.account?.type !== "apiKey") throw Error("登录后仍未能确认 API 账户，请重试。");
      setInfo(result); setViewIdentity(context); await refreshParent(version, context);
    } catch (cause) {
      if (valid(version, context)) setError(`登录失败：${String(cause).split(key).join("[已隐藏]")}`);
    } finally { key = ""; if (valid(version, context)) { operation.current = null; setPhase(null); } }
  };
  const logout = async () => {
    if (operation.current || loading || !info?.account) return;
    const version = generation.current, context = current.current.identity;
    operation.current = "logout"; readRevision.current++; setPhase("logout"); setError(null);
    try {
      await callAppServer("account/logout", {});
      const result = await readAccount();
      if (!valid(version, context)) return;
      if (result.account !== null) throw Error("退出后仍检测到已登录账户，请重新加载后核对。");
      setInfo(result); setViewIdentity(context); await refreshParent(version, context);
    } catch (cause) { if (valid(version, context)) setError(`无法退出登录：${String(cause)}`); }
    finally { if (valid(version, context)) { operation.current = null; setPhase(null); } }
  };
  useEffect(() => {
    mounted.current = true; generation.current++; readRevision.current++; operation.current = null; attempt.current = null; ready.current = false;
    setInfo(null); setViewIdentity(identity); setLoading(false); setPhase(null); setError(null); setEventsReady(false); setMethods(unavailable("loading"));
    if (!active) return () => { mounted.current = false; generation.current++; };
    let disposed = false, subscriptionFailed = false;
    const disposers: (() => void)[] = [];
    void Promise.all([
      tauriListen<{ method: string; params?: any }>("app-server:notification", event => {
        if (disposed || current.current.identity !== identity) return;
        if (event.method === "account/login/completed") {
          const login = attempt.current, completion: LoginCompletion = event.params || {};
          if (!login || login.cancelled || typeof completion.loginId !== "string") return;
          if (login.id === completion.loginId) void finish(login, completion);
          else if (login.id === null && login.events.size < 8) login.events.set(completion.loginId, completion);
        } else if (event.method === "account/updated" && !operation.current) void reloadRef.current();
      }).then(dispose => { if (disposed || subscriptionFailed) dispose(); else disposers.push(dispose); }),
      tauriListen<{ connected: boolean }>("app-server:status", status => {
        if (disposed || current.current.identity !== identity) return;
        if (!status.connected) {
          generation.current++; serviceGeneration.current++; readRevision.current++;
          if (attempt.current) attempt.current.cancelled = true;
          attempt.current = null; operation.current = null; setInfo(null); setPhase(null); setLoading(false); setMethods(unavailable("error")); setError("连接已断开，请重新连接后重试。");
        } else void reloadRef.current();
      }).then(dispose => { if (disposed || subscriptionFailed) dispose(); else disposers.push(dispose); }),
    ]).then(() => {
      if (!disposed) { ready.current = true; setEventsReady(true); }
    }).catch(() => {
      subscriptionFailed = true; disposers.splice(0).forEach(dispose => dispose());
      if (!disposed) setError("无法监听登录状态，请重试。");
    });
    void reloadRef.current();
    const focus = () => { if (!disposed && !operation.current) void reloadRef.current(); };
    const cancelForClose = () => {
      const login = attempt.current;
      if (!login) return;
      login.cancelled = true;
      if (login.id && sameService(login) && !login.cleanupCancelled) {
        login.cleanupCancelled = true; void cancelId(login.id).catch(() => {});
      }
    };
    window.addEventListener("focus", focus);
    window.addEventListener("beforeunload", cancelForClose);
    return () => {
      disposed = true; mounted.current = false; generation.current++; readRevision.current++; ready.current = false;
      cancelForClose();
      attempt.current = null; operation.current = null; disposers.forEach(dispose => dispose());
      window.removeEventListener("focus", focus); window.removeEventListener("beforeunload", cancelForClose);
    };
  }, [identity, active, listenerRevision]);
  const visible = active && viewIdentity === identity;
  return { info: visible ? info : null, methods: visible ? methods : unavailable("loading"), loading: visible && loading,
    phase: visible ? phase : null, error: visible ? error : null, eventsReady: visible && eventsReady,
    reload: () => { if (!ready.current) setListenerRevision(value => value + 1); else void reload(); },
    startChatgpt, cancelLogin, loginApiKey, logout };
}
