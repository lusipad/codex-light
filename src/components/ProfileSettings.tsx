import React, { useEffect, useRef, useState } from "react";
import { accountRead, type AccountReadResult } from "../config";
import { tauriListen } from "../bridge";

export function ProfileSettings() {
  const [account, setAccount] = useState<AccountReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const refresh = async () => {
    const request = ++revision.current;
    setAccount(null); setLoading(true); setError(null);
    try {
      const result = await accountRead();
      if (request === revision.current) setAccount(result);
    } catch (error) {
      if (request === revision.current) setError(`无法读取账号：${String(error)}`);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void refresh();
    void tauriListen<any>("app-server:notification", event => {
      if (!disposed && event.method === "account/updated") void refresh();
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(error => {
      if (!disposed) setError(`账号更新监听失败：${String(error)}`);
    });
    return () => { disposed = true; revision.current += 1; stop?.(); };
  }, []);

  const info = account?.account;
  return (
    <div className="settings-scroll-container">
      <div className="card-section">
        <h3>个人资料</h3>
        {loading && <p role="status">正在读取账号…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && account && (
          info?.type === "chatgpt" ? (
            <dl>
              <dt>账号</dt><dd>{info.email || "邮箱未提供"}</dd>
              <dt>计划</dt><dd>{info.planType}</dd>
            </dl>
          ) : <p>{info?.type === "apiKey" ? "当前使用 API Key" : info?.type === "amazonBedrock" ? "当前使用 Amazon Bedrock" : "未登录"}</p>
        )}
        <p className="card-subtitle-desc">资料编辑尚未接入账号服务，当前显示账号提供的只读信息。</p>
        <button type="button" className="secondary-btn" disabled={loading} onClick={refresh}>重新读取</button>
      </div>
    </div>
  );
}
