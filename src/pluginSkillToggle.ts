import { useEffect, useRef, useState } from "react";
import { readPluginCanonicalRoot, toggleServicePluginSkill } from "./chatgptService";
import { decodePluginCanonicalRoot, type PluginCanonicalRootSnapshot } from "./pluginCanonicalRoot";

interface SkillInitial { installed: boolean; checked: boolean; disabledListKnown: boolean; adminDisabled: boolean }
interface SkillState extends SkillInitial { busy: boolean; pending: boolean; error: string | null }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("技能状态响应格式或归属无效，请重新读取。");
const pendingMessage = "技能变更结果尚未确认，请先重新读取核对。";

export function decodePluginSkillToggleInitial(snapshot: Pick<PluginCanonicalRootSnapshot, "kind" | "pluginId" | "genericSource">, skillName: string): SkillInitial {
  const source = snapshot.kind === "generic" ? snapshot.genericSource : null, plugin = object(source?.plugin), release = object(plugin?.release);
  if (!source || plugin?.id !== snapshot.pluginId || !Array.isArray(release?.skills) || release.skills.filter(skill => object(skill)?.name === skillName).length !== 1) throw invalid();
  const installed = source.installedPlugin === null ? null : object(source.installedPlugin);
  if (source.installedPlugin !== null && (!installed || installed.id !== snapshot.pluginId)) throw invalid();
  const present = installed !== null && Object.hasOwn(installed, "enabled");
  if (present && typeof installed.enabled !== "boolean") throw invalid();
  const known = present && Object.hasOwn(installed, "disabled_skill_names");
  if (known && (!Array.isArray(installed.disabled_skill_names) || installed.disabled_skill_names.some(name => typeof name !== "string"))) throw invalid();
  return { installed: present, checked: known && !(installed!.disabled_skill_names as string[]).includes(skillName), disabledListKnown: known, adminDisabled: plugin.status === "DISABLED_BY_ADMIN" };
}
export function decodePluginSkillToggleResult(raw: unknown, pluginId: string, skillName: string, target: boolean) {
  const response = object(raw), body = object(response?.body), readback = response?.readback === null ? null : object(response?.readback);
  if (!response || !body || typeof body.delivery !== "string" || !["accepted", "unknown", "not_sent", "rejected"].includes(body.delivery) || body.warningCode !== null && typeof body.warningCode !== "string" ||
    response.verification !== "confirmed" && response.verification !== "pending" || response.readback !== null && (!readback || readback.pluginId !== pluginId || readback.skillName !== skillName ||
      typeof readback.installed !== "boolean" || typeof readback.disabledListKnown !== "boolean" || readback.checked !== null && typeof readback.checked !== "boolean")) throw invalid();
  return { delivery: body.delivery as "accepted" | "unknown" | "not_sent" | "rejected", confirmed: body.delivery !== "rejected" && (body.delivery !== "not_sent" || body.warningCode === null) && response.verification === "confirmed" &&
    readback?.installed === true && readback.disabledListKnown === true && readback.checked === target };
}

export function usePluginSkillToggle(scope: string, snapshot: PluginCanonicalRootSnapshot, skillName: string, isCurrent: () => boolean) {
  const identity = snapshot.identity, logical = JSON.stringify([identity.accountId, identity.userId, identity.generation, snapshot.pluginId, skillName]), key = JSON.stringify([scope, logical]);
  const pendingWrites = useRef(new Map<string, { target: boolean; previous: SkillInitial }>());
  const initial = (): SkillState => {
    let source: SkillInitial, error: string | null = null;
    try { source = decodePluginSkillToggleInitial(snapshot, skillName); } catch { source = { installed: false, checked: false, disabledListKnown: false, adminDisabled: false }; error = "无法加载插件设置"; }
    const pending = pendingWrites.current.get(logical);
    return { ...source, ...(pending ? { checked: pending.previous.checked, disabledListKnown: pending.previous.disabledListKnown } : {}), busy: false, pending: Boolean(pending), error: pending ? pendingMessage : error };
  };
  const current = useRef({ key, snapshot, active: false, locked: false, request: null as AbortController | null, guard: isCurrent, value: initial() });
  if (current.current.key !== key || current.current.snapshot !== snapshot) current.current = { key, snapshot, active: false, locked: false, request: null, guard: isCurrent, value: initial() };
  const generation = current.current; generation.guard = isCurrent;
  const [, setStored] = useState<SkillState | null>(null);
  const active = () => current.current === generation && generation.active && generation.guard();
  const publish = (value: SkillState) => { if (active()) { generation.value = value; setStored(value); } };
  useEffect(() => {
    generation.active = true;
    return () => { generation.active = false; generation.request?.abort(); generation.request = null; generation.locked = false; };
  }, [generation]);
  const finish = (checked: boolean) => { pendingWrites.current.delete(logical); publish({ ...generation.value, installed: true, disabledListKnown: true, checked, pending: false, error: null }); };
  const release = (controller: AbortController) => {
    if (current.current !== generation || !generation.active || generation.request !== controller || controller.signal.aborted) return;
    generation.locked = false; generation.request = null; generation.value = { ...generation.value, busy: false };
    if (generation.guard()) setStored(generation.value);
  };
  const change = async (enabled: boolean) => {
    const before = generation.value;
    if (!active() || generation.locked || before.pending || !before.installed || before.adminDisabled || typeof enabled !== "boolean" || before.disabledListKnown && before.checked === enabled) return;
    const controller = new AbortController(); generation.request = controller; generation.locked = true;
    pendingWrites.current.set(logical, { target: enabled, previous: before });
    const valid = () => active() && generation.request === controller && !controller.signal.aborted;
    publish({ ...before, busy: true, pending: true, error: null });
    try {
      const raw = await toggleServicePluginSkill(snapshot.pluginId, skillName, enabled, identity, controller.signal);
      if (!valid()) return;
      const result = decodePluginSkillToggleResult(raw, snapshot.pluginId, skillName, enabled);
      if (result.confirmed) finish(enabled);
      else if (result.delivery === "not_sent" || result.delivery === "rejected") { pendingWrites.current.delete(logical); publish({ ...before, busy: true, pending: false, error: "无法更新此技能。请重试" }); }
      else publish({ ...generation.value, pending: true, error: pendingMessage });
    } catch { if (valid()) publish({ ...generation.value, pending: true, error: pendingMessage }); }
    finally { release(controller); }
  };
  const verify = async () => {
    const pending = pendingWrites.current.get(logical);
    if (!active() || generation.locked || !pending) return;
    const controller = new AbortController(); generation.request = controller; generation.locked = true;
    const valid = () => active() && generation.request === controller && !controller.signal.aborted;
    publish({ ...generation.value, busy: true, error: pendingMessage });
    try {
      const raw = await readPluginCanonicalRoot(snapshot.pluginId, identity, controller.signal);
      if (!valid()) return;
      const decoded = decodePluginCanonicalRoot(raw, snapshot.pluginId), actual = decodePluginSkillToggleInitial(decoded, skillName);
      if (actual.installed && actual.disabledListKnown && actual.checked === pending.target) finish(actual.checked);
      else publish({ ...generation.value, pending: true, error: pendingMessage });
    } catch { if (valid()) publish({ ...generation.value, pending: true, error: pendingMessage }); }
    finally { release(controller); }
  };
  return { ...generation.value, change, verify };
}
