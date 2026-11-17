import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage } from "../chatgptService";
import { loadAccountNotifications, updateAccountNotification, type AccountNotificationSnapshot } from "../accountNotifications";
import { AccountNotificationMenu } from "./AccountNotificationMenu";
import "./AccountNotificationSettings.css";

const sameIdentity = (a: AccountNotificationSnapshot["identity"], b: AccountNotificationSnapshot["identity"]) =>
  Boolean(a && b && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);

export function AccountNotificationSettings({ scope, connected, onManageTasks }: { scope: string; connected: boolean; onManageTasks?: () => void }) {
  const [snapshot, setSnapshot] = useState<AccountNotificationSnapshot | null>(null);
  const [viewScope, setViewScope] = useState(scope);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [listenerError, setListenerError] = useState<string | null>(null);
  const [listenerRetry, setListenerRetry] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const current = useRef({ mounted: false, scope, connected }); current.current.scope = scope; current.current.connected = connected;
  const data = useRef<AccountNotificationSnapshot | null>(null);
  const epoch = useRef(0), readVersion = useRef(0), sequence = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const writes = useRef(new Map<number, AbortController>());
  const latest = useRef(new Map<string, number>());
  const locked = useRef(false);
  const subscribed = useRef(false);
  const connectionLost = useRef(false);
  const renderEpoch = epoch.current;
  const valid = (version: number, captured: string) => current.current.mounted && epoch.current === version && current.current.scope === captured;
  const publish = (next: AccountNotificationSnapshot | null) => { data.current = next; setSnapshot(next); };
  const reload = async () => {
    // A read while writes are in flight can replace optimistic values with an older server snapshot.
    if (!subscribed.current || !current.current.connected || connectionLost.current || writes.current.size) return;
    const version = epoch.current, captured = scope, request = ++readVersion.current;
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    setLoading(true); setReadError(null); setAccountUnavailable(false);
    try {
      const next = await loadAccountNotifications(controller.signal);
      if (!valid(version, captured) || controller.signal.aborted || request !== readVersion.current) return;
      // This authoritative read resolves the current outcome; previous failures are not rolled back.
      publish(next); setViewScope(captured); locked.current = false; setBlocked(false); setWriteError(null);
    } catch (cause) {
      if (valid(version, captured) && !controller.signal.aborted && request === readVersion.current) {
        locked.current = true; setBlocked(true); setReadError(serviceErrorMessage(cause));
        setAccountUnavailable((cause as { code?: string })?.code === "notifications_account_unavailable");
      }
    } finally {
      if (valid(version, captured) && request === readVersion.current) setLoading(false);
    }
  };
  const latestReload = useRef(reload); latestReload.current = reload;
  const retry = () => {
    if (!subscribed.current) setListenerRetry(value => value + 1);
    else void reload();
  };
  const change = async (category: string, channel: string, enabled: boolean) => {
    const selected = data.current;
    if (!current.current.mounted || !current.current.connected || !subscribed.current || connectionLost.current || current.current.scope !== scope || renderEpoch !== epoch.current || locked.current || !selected?.identity || selected.access !== "allowed" || viewScope !== scope) return;
    const row = selected.settings.find(item => item.category === category);
    const option = row?.options.find(item => item.channel === channel);
    if (!option || option.enabled === enabled || category === "teen_safety" &&
      (selected.contactsError || !selected.contacts || channel === "email" && !selected.contacts.email || channel === "sms" && !selected.contacts.sms)) return;
    const version = epoch.current, captured = scope, identity = selected.identity;
    const id = ++sequence.current, key = JSON.stringify([category, channel]);
    const controller = new AbortController(); latest.current.set(key, id); writes.current.set(id, controller);
    readVersion.current++; reading.current?.abort(); setLoading(false); setReadError(null); setWriteError(null);
    const merge = (value: boolean) => {
      const existing = data.current;
      if (!existing || !sameIdentity(existing.identity, identity)) return;
      publish({ ...existing, settings: existing.settings.map(item => item.category === category
        ? { ...item, options: item.options.map(entry => entry.channel === channel ? { ...entry, enabled: value } : entry) } : item) });
    };
    merge(enabled);
    try {
      const result = await updateAccountNotification(category, channel, enabled, identity, controller.signal);
      if (!valid(version, captured) || controller.signal.aborted || !sameIdentity(data.current?.identity ?? null, identity)) return;
      if (latest.current.get(key) === id) {
        const actual = result.settings?.find(item => item.category === category)?.options.find(item => item.channel === channel);
        if (actual) merge(actual.enabled);
      }
      if (result.verification !== "confirmed") {
        locked.current = true; setBlocked(true); setWriteError("已提交，等待通知设置同步。请重新读取核验。");
      }
    } catch (cause) {
      if (valid(version, captured) && !controller.signal.aborted) {
        // A rejected/aborted request may already have reached the service. Never blindly replay it.
        locked.current = true; setBlocked(true);
        setWriteError(`未能更新 ChatGPT 通知设置：${serviceErrorMessage(cause)}`);
      }
    } finally {
      if (valid(version, captured)) {
        writes.current.delete(id);
        if (latest.current.get(key) === id) latest.current.delete(key);
        if (!writes.current.size) void latestReload.current();
      }
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    subscribed.current = false; setListenerError(null);
    connectionLost.current = !connected;
    let disposed = false, failed = false; const stops: (() => void)[] = [];
    const stopAll = () => { for (const stop of stops.splice(0)) stop(); };
    const reset = (disconnected = connectionLost.current) => {
      connectionLost.current = disconnected;
      epoch.current++; readVersion.current++; reading.current?.abort();
      writes.current.forEach(controller => controller.abort()); writes.current.clear(); latest.current.clear();
      publish(null); setViewScope(scope); setWriteError(null); setAccountUnavailable(false);
      locked.current = disconnected || !subscribed.current; setBlocked(locked.current);
      setLoading(!disconnected); setReadError(disconnected ? "连接已断开，请重新连接后重试。" : null);
      if (!disconnected && subscribed.current) void latestReload.current();
    };
    const listen = <T,>(event: string, handler: (payload: T) => void) => {
      return tauriListen<T>(event, payload => { if (!disposed && !failed) handler(payload); })
        .then(stop => { if (disposed || failed) stop(); else stops.push(stop); });
    };
    reset();
    void Promise.all([
      listen<{ method: string }>("app-server:notification", event => { if (event.method === "account/updated") reset(); }),
      listen<{ connected: boolean }>("app-server:status", status => reset(!status.connected)),
      listen("chatgpt-service:invalidated", () => reset()),
    ]).then(() => {
      if (disposed || failed) return;
      subscribed.current = true; reset();
    }).catch(() => {
      if (disposed) return;
      failed = true; subscribed.current = false; stopAll();
      locked.current = true; setBlocked(true); setLoading(false);
      setListenerError("无法监听账户更新，请重试以恢复连接。");
    });
    return () => {
      disposed = true; subscribed.current = false; current.current.mounted = false; epoch.current++; readVersion.current++; reading.current?.abort();
      writes.current.forEach(controller => controller.abort()); writes.current.clear(); latest.current.clear(); stopAll();
    };
  }, [scope, connected, listenerRetry]);
  const visible = viewScope === scope ? snapshot : null;
  const retryDisabled = loading || (subscribed.current && connectionLost.current);
  const readErrorTitle = accountUnavailable ? "无法加载你的账户信息。" : "无法加载 ChatGPT 通知设置。";
  if (!visible) return <div className="account-notification-settings">
    {loading && <p role="status">正在加载 ChatGPT 通知设置。</p>}
    {readError && <div role="alert"><p>{readErrorTitle}</p><p>{readError}</p>
      <button type="button" disabled={retryDisabled} onClick={retry}>重试</button></div>}
    {listenerError && <p role="alert">{listenerError}</p>}
    {listenerError && <button type="button" disabled={retryDisabled} onClick={retry}>重试</button>}
  </div>;
  return <section className="account-notification-settings" aria-labelledby="account-notification-heading">
    <h3 id="account-notification-heading">ChatGPT</h3>
    {visible.access === "denied" && <p role="status">当前账号无法使用 ChatGPT 通知设置。</p>}
    {visible.access === "allowed" && visible.settings.length === 0 && <p role="status">暂无可配置的通知。</p>}
    <div className="account-notification-card">
      {visible.access === "allowed" && visible.settings.map(row => {
        const contactRow = row.category === "teen_safety";
        const contactError = contactRow && visible.contactsError;
        const contactLoading = contactRow && !visible.contacts && !contactError;
        const options = row.options.filter(option => !contactRow || (option.channel === "email"
          ? Boolean(visible.contacts?.email) : option.channel !== "sms" || Boolean(visible.contacts?.sms)));
        return <div className="account-notification-row" key={row.category}>
          <div className="account-notification-description"><span>{row.name}</span>
            {contactError ? <p role="alert">无法加载你的联系方式。</p> : !contactLoading && <p>{row.description}</p>}
            {row.category === "tasks" && onManageTasks && <button type="button" className="account-notification-tasks" onClick={onManageTasks}>管理任务</button>}
          </div>
          <div className="account-notification-control">
            {contactError ? <button type="button" disabled={retryDisabled} onClick={retry}>重试</button> : contactLoading
              ? <span role="status" aria-label="正在加载联系方式">…</span>
              : <AccountNotificationMenu label={row.name} options={options} disabled={blocked}
                onChange={(channel, enabled) => void change(row.category, channel, enabled)} />}
          </div>
        </div>;
      })}
    </div>
    {writeError && <p role="alert">{writeError}</p>}
    {listenerError && <p role="alert">{listenerError}</p>}
    {readError && <div role="alert"><p>{readErrorTitle}</p><p>{readError}</p></div>}
    {(readError || writeError || listenerError) && <button type="button" disabled={retryDisabled} onClick={retry}>重试</button>}
  </section>;
}
