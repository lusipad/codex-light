import { configBatchWrite, configRead, configRequirementsRead } from "./config";
import type { ConfigEdit, ConfigReadResult } from "./config";

type ObjectValue = Record<string, unknown>;
export interface McpSettingsEntry {
  name: string;
  raw: ObjectValue;
  userRaw: ObjectValue | null;
  transport: "stdio" | "http" | "unknown";
  enabled: boolean | null;
  source: "user" | "project" | "managed" | "plugin" | "unknown";
  readOnlyReason: string | null;
}
export interface McpSettingsSnapshot {
  cwd?: string;
  snapshot: ConfigReadResult;
  requirements: ObjectValue | null;
  userLayer: { filePath: string; version: string; config: ObjectValue } | null;
  entries: McpSettingsEntry[];
}
export type McpSettingsAction =
  | { type: "add"; name: string; config: ObjectValue }
  | { type: "update"; name: string; changes: ObjectValue }
  | { type: "toggle"; name: string; enabled: boolean }
  | { type: "remove"; name: string };
export interface McpSettingsWriteResult {
  snapshot: McpSettingsSnapshot | null;
  verification: "confirmed" | "pending" | "rejected";
  requiresRestart: boolean;
  error: string | null;
}
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const own = (value: ObjectValue, key: string) => Object.hasOwn(value, key);
const mapFields = new Set(["env", "http_headers", "env_http_headers"]);
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = object(a), right = object(b);
  return !!left && !!right && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => own(right, key) && equal(left[key], right[key]));
}
function sourceType(value: unknown): McpSettingsEntry["source"] {
  if (value === "user") return "user";
  if (value === "project") return "project";
  if (value === "plugin") return "plugin";
  if (["system", "mdm", "managed", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm"].includes(String(value))) return "managed";
  return "unknown";
}
export async function readMcpSettings(cwd?: string): Promise<McpSettingsSnapshot> {
  const [snapshot, result] = await Promise.all([configRead(cwd, true), configRequirementsRead()]);
  const layers = (snapshot.layers ?? []).map(object).filter((layer): layer is ObjectValue => !!layer);
  const layer = layers.filter(item => {
    const name = object(item.name);
    return name?.type === "user" && !name.profile && !item.disabledReason && typeof name.file === "string" && typeof item.version === "string" && !!object(item.config);
  }).at(-1);
  const userLayer = layer ? { filePath: object(layer.name)!.file as string, version: layer.version as string, config: object(layer.config)! } : null;
  const effective = object(snapshot.config.mcp_servers) ?? {};
  const local = object(userLayer?.config.mcp_servers) ?? {};
  const names = [...new Set([...Object.keys(effective), ...Object.keys(local)])];
  // Origins are flattened literal keys, so alpha.beta must belong to that server before alpha.
  const longestNames = [...names].sort((left, right) => right.length - left.length);
  const originOwner = (key: string) => longestNames.find(name => key === `mcp_servers.${name}` || key.startsWith(`mcp_servers.${name}.`));
  const entries = names.map(name => {
    const raw = object(effective[name]) ?? object(local[name]) ?? {};
    const userRaw = object(local[name]);
    const origins = Object.entries(snapshot.origins).filter(([key]) => key === "mcp_servers" || originOwner(key) === name).map(([, origin]) => sourceType(origin.name.type));
    const nonUser = origins.find(origin => origin !== "user");
    const source = nonUser ?? (userRaw ? "user" : origins[0] ?? "unknown");
    let readOnlyReason: string | null = null;
    if (!userLayer) readOnlyReason = "未找到可写的用户配置层";
    else if (source !== "user" || !userRaw) readOnlyReason = "此服务器来自项目、插件或受管理配置，请在原始来源中修改";
    else if (!object(effective[name]) || (!own(raw, "command") && !own(raw, "url"))) readOnlyReason = "服务器配置格式无法安全编辑";
    const transport = typeof raw.command === "string" ? "stdio" as const : typeof raw.url === "string" ? "http" as const : "unknown" as const;
    return { name, raw, userRaw, transport, enabled: typeof raw.enabled === "boolean" ? raw.enabled : raw.enabled == null ? true : null, source, readOnlyReason };
  });
  return { cwd, snapshot, requirements: result.requirements, userLayer, entries };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause == null ? error.message : errorMessage(cause);
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}
function knownRejection(error: unknown): boolean {
  const record = object(error), data = object(record?.data);
  if (["configVersionConflict", "configLayerReadonly"].includes(String(data?.config_write_error_code))) return true;
  if (record?.cause && knownRejection(record.cause)) return true;
  const message = errorMessage(error);
  return message === "Configuration was modified since last read. Fetch latest version and retry." || message === "Only writes to the user config are allowed";
}
export async function writeMcpServer(before: McpSettingsSnapshot, action: McpSettingsAction): Promise<McpSettingsWriteResult> {
  const reject = (error: string): McpSettingsWriteResult => ({ snapshot: before, verification: "rejected", requiresRestart: false, error });
  if (!before.userLayer) return reject("未找到可写的用户配置层");
  const servers = object(before.userLayer.config.mcp_servers) ?? {};
  const entry = before.entries.find(item => item.name === action.name);
  if (!action.name.length) return reject("服务器名称不能为空");
  if (action.type === "add") {
    if (entry || own(servers, action.name)) return reject("同名服务器已存在，请刷新配置后重试");
    if (typeof action.config.command !== "string" && typeof action.config.url !== "string") return reject("缺少服务器命令或 URL");
  } else if (!entry || entry.readOnlyReason || !entry.userRaw) return reject(entry?.readOnlyReason ?? "服务器已不存在");
  const expected: { path: string[]; value: unknown }[] = [];
  const put = (parts: string[], value: unknown) => expected.push({ path: ["mcp_servers", action.name, ...parts], value });
  const raw = entry?.userRaw ?? {};
  if (action.type === "add") put([], action.config);
  if (action.type === "remove") put([], null);
  if (action.type === "toggle" && raw.enabled !== action.enabled) put(["enabled"], action.enabled);
  if (action.type === "update") {
    for (const [field, value] of Object.entries(action.changes)) {
      if (["command", "url"].includes(field) && !own(raw, field) && value != null) return reject("编辑时不能更改传输类型");
      if (equal(raw[field], value) || (value == null && !own(raw, field))) continue;
      const oldMap = object(raw[field]), newMap = object(value);
      if (mapFields.has(field) && newMap && (oldMap || raw[field] == null)) {
        for (const key of new Set([...Object.keys(oldMap ?? {}), ...Object.keys(newMap)])) {
          if (!equal(oldMap?.[key], newMap[key])) put([field, key], own(newMap, key) ? newMap[key] : null);
        }
      } else put([field], value ?? null);
    }
  }
  if (!expected.length) return { snapshot: before, verification: "confirmed", requiresRestart: false, error: null };
  // The server accepts quoted dotted path segments, including escaped quotes and backslashes.
  const edits: ConfigEdit[] = expected.map(item => ({ keyPath: item.path.map(part => JSON.stringify(part)).join("."), value: item.value, mergeStrategy: "replace" }));
  let writeError: unknown = null;
  try {
    await configBatchWrite(edits, { filePath: before.userLayer.filePath, expectedVersion: before.userLayer.version, reloadUserConfig: false });
  } catch (error) { writeError = error; }
  let snapshot: McpSettingsSnapshot;
  try { snapshot = await readMcpSettings(before.cwd); }
  catch (error) {
    return { snapshot: null, verification: writeError && knownRejection(writeError) ? "rejected" : "pending", requiresRestart: !writeError, error: `无法确认写入结果，请先重新读取配置：${errorMessage(writeError ?? error)}` };
  }
  if (writeError && knownRejection(writeError)) return { snapshot, verification: "rejected", requiresRestart: false, error: errorMessage(writeError) };
  const matches = (root: ObjectValue) => expected.every(item => {
    let value: unknown = root;
    for (const key of item.path) value = object(value)?.[key];
    return item.value === null ? value === undefined : equal(value, item.value);
  });
  const localMatches = !!snapshot.userLayer && matches(snapshot.userLayer.config);
  const effectiveMatches = matches(snapshot.snapshot.config);
  if (localMatches && effectiveMatches) return { snapshot, verification: "confirmed", requiresRestart: true, error: null };
  return { snapshot, verification: "pending", requiresRestart: localMatches || !writeError, error: localMatches ? "已保存到用户配置，但有效配置被其他来源覆盖；请检查配置来源" : `写入结果未确认，请先刷新并核对配置${writeError ? `：${errorMessage(writeError)}` : ""}` };
}
