import { useEffect, useRef, useState } from "react";
import { readPluginSkillContents, type ServiceIdentity } from "./chatgptService";

export interface PluginSkillContentsData {
  name?: string | null;
  description?: string | null;
  interface?: { display_name?: string | null } | null;
  skill_md_contents?: string | null;
}
interface ContentsState { data: PluginSkillContentsData | null; loading: boolean; error: string | null }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => Error("技能正文响应格式或归属无效，请重试。");
export function decodePluginSkillContents(raw: unknown, pluginId: string, skillName: string): PluginSkillContentsData {
  const body = object(raw), contents = object(body?.contents);
  if (!body || body.pluginId !== pluginId || body.skillName !== skillName || !contents) throw invalid();
  const data: PluginSkillContentsData = {};
  for (const key of ["name", "description", "skill_md_contents"] as const) {
    if (!Object.hasOwn(contents, key)) continue;
    if (contents[key] !== null && typeof contents[key] !== "string") throw invalid();
    data[key] = contents[key] as string | null;
  }
  if (Object.hasOwn(contents, "interface")) {
    const info = contents.interface === null ? null : object(contents.interface);
    if (contents.interface !== null && !info) throw invalid();
    data.interface = info === null ? null : {};
    if (info && Object.hasOwn(info, "display_name")) {
      if (info.display_name !== null && typeof info.display_name !== "string") throw invalid();
      data.interface!.display_name = info.display_name as string | null;
    }
  }
  return data;
}

export function usePluginSkillContents(scope: string, pluginId: string, skillName: string, identity: ServiceIdentity): ContentsState & { retry: () => void } {
  const key = JSON.stringify([scope, pluginId, skillName, identity.accountId, identity.userId, identity.generation]);
  const current = useRef({ key, active: false, locked: false, request: null as AbortController | null, value: { data: null, loading: true, error: null } as ContentsState });
  if (current.current.key !== key) current.current = { key, active: false, locked: false, request: null, value: { data: null, loading: true, error: null } };
  const generation = current.current;
  const [, setStored] = useState<{ generation: typeof generation; value: ContentsState } | null>(null);
  const active = () => current.current === generation && generation.active;
  const publish = (value: ContentsState) => { if (active()) { generation.value = value; setStored({ generation, value }); } };
  const read = async () => {
    if (!active() || generation.locked) return;
    const controller = new AbortController(); generation.request = controller; generation.locked = true;
    const valid = () => active() && generation.request === controller && !controller.signal.aborted;
    publish({ ...generation.value, loading: true, error: null });
    try {
      const raw = await readPluginSkillContents(pluginId, skillName, identity, controller.signal);
      if (!valid()) return;
      publish({ data: decodePluginSkillContents(raw, pluginId, skillName), loading: false, error: null });
    } catch { if (valid()) publish({ ...generation.value, loading: false, error: "无法加载此技能" }); }
    finally { if (valid()) { generation.locked = false; generation.request = null; } }
  };
  useEffect(() => {
    generation.active = true; void read();
    return () => { generation.active = false; generation.request?.abort(); generation.request = null; generation.locked = false; };
  }, [key]);
  return { ...generation.value, retry: () => { void read(); } };
}
