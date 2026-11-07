import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { networkDomainEntry } from "../cloudDraftNetwork";
import type { CloudNetwork } from "../cloudEnvironmentService";

export function CloudDraftNetworkFields({ network, disabled, onChange }: {
  network: CloudNetwork; disabled: boolean; onChange: (network: CloudNetwork) => void;
}) {
  const [domains, setDomains] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [validate, setValidate] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const domainInput = useRef<HTMLInputElement>(null);
  const open = domains !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal();
    domainInput.current?.focus();
    return () => { element.close(); trigger.current?.focus(); };
  }, [open]);

  const all = network.type === "unrestricted";
  const setRestricted = (packageManagers: boolean, hosts: string[]) =>
    onChange({ type: packageManagers || hosts.length ? "restricted" : "disabled", packageManagers, hosts });
  const addDomains = (value: string, keepLast = false) => {
    if (!domains) return;
    const items = value.split(/[,\r\n]/);
    const last = keepLast ? items.pop()?.trim() : undefined;
    const next = [...domains];
    const remaining: string[] = [];
    for (const item of items.map(part => part.trim()).filter(Boolean)) {
      const entry = networkDomainEntry(item, next);
      if ("host" in entry) next.push(entry.host);
      else remaining.push(item);
    }
    setDomains(next);
    setValidate(remaining.length > 0);
    setInput([...remaining, ...(last ? [last] : [])].join(", "));
  };
  const candidate = open && validate && input.trim() ? networkDomainEntry(input.split(",")[0].trim(), domains) : null;
  const error = candidate && "error" in candidate ? candidate.error : null;
  return <section className="cloud-draft-network">
    <h3>互联网访问</h3>
    <label><input type="checkbox" role="switch" checked={all} disabled={disabled} onChange={event => {
      if (event.target.checked) onChange({ ...network, type: "unrestricted" });
      else setRestricted(network.packageManagers, network.hosts);
    }} />允许 Codex 访问互联网</label>
    <label><input type="checkbox" role="switch" checked={network.packageManagers} disabled={disabled || all}
      onChange={event => setRestricted(event.target.checked, network.hosts)} />Enable package manager domains</label>
    <div className="cloud-draft-domain-row">
      <span>额外允许的域名</span>
      <span>{network.hosts.length ? `${network.hosts.length} 个域名 · ${network.hosts[0]}` : "无其他域名"}</span>
      <button ref={trigger} type="button" className="window-chrome-icon-btn" disabled={disabled || all}
        aria-label={`编辑额外允许的域名（${network.hosts.length} 个域名）`}
        onClick={() => { setInput(""); setValidate(false); setDomains([...network.hosts]); }}><Pencil size={14} aria-hidden="true" /></button>
    </div>
    {open && <dialog ref={dialog} className="cloud-draft-domain-dialog" aria-labelledby="cloud-draft-domain-heading"
      onClick={event => { if (event.target === event.currentTarget) setDomains(null); }}
      onCancel={event => { event.preventDefault(); setDomains(null); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
      <div>
        <h3 id="cloud-draft-domain-heading">额外允许的域名</h3>
        <div className="cloud-draft-domain-tags">{domains.length ? domains.map(host => <span key={host}>{host}
          <button type="button" className="window-chrome-icon-btn" aria-label={`移除 ${host}`}
            onClick={() => setDomains(domains.filter(value => value !== host))}><X size={12} aria-hidden="true" /></button>
        </span>) : <p>尚未添加域名</p>}</div>
        <input ref={domainInput} aria-label="其他允许的域名" aria-describedby="cloud-draft-domain-help" aria-invalid={!!error}
          placeholder="example.com 或 *.example.com" value={input} onBlur={() => setValidate(true)}
          onChange={event => {
            if (event.target.value.includes(",") && !(event.nativeEvent as InputEvent).isComposing) addDomains(event.target.value, true);
            else { setInput(event.target.value); setValidate(false); }
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              if (input.trim()) addDomains(input);
            } else if (event.key === "Backspace" && !input) setDomains(domains.slice(0, -1));
          }}
          onPaste={event => {
            const text = event.clipboardData.getData("text");
            if (!/[,\r\n]/.test(text)) return;
            event.preventDefault();
            const { selectionStart, selectionEnd } = event.currentTarget;
            addDomains(input.slice(0, selectionStart ?? input.length) + text + input.slice(selectionEnd ?? input.length));
          }} />
        <p id="cloud-draft-domain-help" role={error ? "alert" : undefined}>{error
          || (input.trim() ? "保存前，请按 Enter 键添加此域名" : "按 Enter 键添加，或粘贴以逗号或换行符分隔的列表")}</p>
        <footer className="cloud-envs-footer">
          <button type="button" onClick={() => setDomains(null)}>取消</button>
          <button type="button" disabled={!!input.trim()} onClick={() => { setRestricted(network.packageManagers, domains); setDomains(null); }}>保存</button>
        </footer>
      </div>
    </dialog>}
  </section>;
}
