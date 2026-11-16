import type { PluginDetail } from "./plugins";

type ObjectValue = Record<string, unknown>;
export type PluginSettingValue = boolean | string | number;
export interface PluginSettingField {
  title: string;
  description?: string;
  type: "boolean" | "string" | "number" | "integer";
  enum?: string[];
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}
export type PluginSettingsItem = { kind: "property"; property: string }
  | { kind: "tool"; tool: string; title?: string; description?: string };
export interface PluginSettingsGroup { kind: "group"; title: string; items: PluginSettingsItem[] }
export interface PluginSettingsDefinition {
  schema: { type: "object"; properties: Record<string, PluginSettingField>; required?: string[] };
  values: Record<string, PluginSettingValue>;
  layout?: PluginSettingsGroup[];
}
export interface PluginSettingsTool extends ObjectValue { name: string }
export interface PluginProvidedSettingsView {
  hostId: string;
  server: string;
  pluginId?: string | null;
  title: string;
  readTool: string;
  updateTool: string;
  tools: PluginSettingsTool[];
}
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const nonblank = (value: unknown): value is string => typeof value === "string" && /\S/.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const scalar = (value: unknown): value is PluginSettingValue => typeof value === "boolean" || typeof value === "string" || finite(value);
const normalizeServer = (name: string) => name.trim().toLowerCase().replace(/^connector[_-]/, "").replace(/^mcp[_-]/, "").replace(/[\s_-]+/g, "");
const invalid = (): never => { throw Error("无法识别插件设置，请重新读取。"); };

/** Ordinary MCP only: codex_apps needs its separate connector/target scope contract. */
export function discoverPluginProvidedSettings(detail: Pick<PluginDetail, "summary" | "mcpServers">, statuses: unknown[], hostId: string): PluginProvidedSettingsView[] {
  if (!detail.summary.installed) return [];
  return statuses.flatMap(value => {
    const status = object(value);
    if (!status || typeof status.name !== "string" || status.name === "codex_apps") return [];
    if (status.pluginId != null ? status.pluginId !== detail.summary.id
      : !detail.mcpServers.some(name => normalizeServer(name) === normalizeServer(status.name as string))) return [];
    const capabilities = object(status.serverCapabilities);
    if (!capabilities || ["extensions", "experimental"].some(key => capabilities[key] !== undefined && !object(capabilities[key]))) return [];
    const extensions = object(capabilities.extensions);
    const declaration = object(extensions && Object.hasOwn(extensions, "openai/settings")
      ? extensions["openai/settings"] : object(capabilities?.experimental)?.["openai/settings"]);
    if (!declaration || !nonblank(declaration.readTool) || !nonblank(declaration.updateTool) || declaration.readTool === declaration.updateTool) return [];
    const tools = Object.values(object(status.tools) ?? {}).filter((tool): tool is PluginSettingsTool => !!object(tool) && typeof object(tool)!.name === "string");
    if (!tools.some(tool => tool.name === declaration.readTool) || !tools.some(tool => tool.name === declaration.updateTool)) return [];
    const info = object(status.serverInfo);
    return [{ hostId, server: status.name, pluginId: status.pluginId as string | null | undefined,
      title: typeof info?.title === "string" ? info.title : typeof info?.name === "string" ? info.name : status.name,
      readTool: declaration.readTool, updateTool: declaration.updateTool, tools }];
  });
}

// Compare canonical decimal representations without accepting a rounded near-multiple.
function multipleOf(value: number, divisor: number): boolean {
  const parts = (number: number): [bigint, number] => {
    const [digits, exponent = "0"] = String(number).toLowerCase().split("e");
    const decimals = digits.split(".")[1]?.length ?? 0;
    return [BigInt(digits.replace(".", "")), Number(exponent) - decimals];
  };
  const [left, leftExponent] = parts(value), [right, rightExponent] = parts(divisor);
  const exponent = Math.min(leftExponent, rightExponent);
  return (left * 10n ** BigInt(leftExponent - exponent)) % (right * 10n ** BigInt(rightExponent - exponent)) === 0n;
}
export function isPluginSettingValue(field: PluginSettingField, value: unknown): value is PluginSettingValue {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string") {
    if (typeof value !== "string" || field.enum && !field.enum.includes(value)
      || field.minLength != null && Array.from(value).length < field.minLength
      || field.maxLength != null && Array.from(value).length > field.maxLength) return false;
    try { return field.pattern == null || new RegExp(field.pattern, "u").test(value); } catch { return false; }
  }
  return finite(value) && (field.type !== "integer" || Number.isInteger(value))
    && (field.minimum == null || value >= field.minimum) && (field.maximum == null || value <= field.maximum)
    && (field.multipleOf == null || multipleOf(value, field.multipleOf));
}
function parseField(value: unknown): PluginSettingField {
  const field = object(value);
  if (!field || !nonblank(field.title) || typeof field.type !== "string" || !["boolean", "string", "number", "integer"].includes(String(field.type))
    || ["$ref", "anyOf", "oneOf", "allOf"].some(key => field[key] !== undefined)
    || field.description !== undefined && typeof field.description !== "string"
    || field.pattern !== undefined && typeof field.pattern !== "string") return invalid();
  if (field.enum !== undefined && (field.type !== "string" || !Array.isArray(field.enum) || field.enum.length === 0 || field.enum.some(item => typeof item !== "string"))) return invalid();
  for (const key of ["minimum", "maximum", "multipleOf", "minLength", "maxLength"]) {
    const number = field[key];
    if (number !== undefined && (!finite(number) || key === "multipleOf" && number <= 0
      || ["minLength", "maxLength"].includes(key) && (!Number.isInteger(number) || number < 0))) return invalid();
  }
  return Object.fromEntries(["title", "description", "type", "enum", "minimum", "maximum", "multipleOf", "minLength", "maxLength", "pattern"]
    .filter(key => field[key] !== undefined).map(key => [key, field[key]])) as unknown as PluginSettingField;
}
export function parsePluginSettingsDefinition(value: unknown): PluginSettingsDefinition {
  const definition = object(value), schema = object(definition?.schema), properties = object(schema?.properties), values = object(definition?.values);
  if (!definition || !schema || schema.type !== "object" || !properties || !values
    || Object.values(values).some(value => !scalar(value))
    || schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(value => typeof value !== "string"))) return invalid();
  const fields = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, parseField(field)]));
  for (const [name, field] of Object.entries(fields)) if (!Object.hasOwn(values, name) || !isPluginSettingValue(field, values[name])) return invalid();
  let layout: PluginSettingsGroup[] | undefined;
  if (definition.layout !== undefined) {
    if (!Array.isArray(definition.layout)) return invalid();
    const seen = new Set<string>();
    layout = definition.layout.map(value => {
      const group = object(value);
      if (!group || group.kind !== "group" || !nonblank(group.title) || !Array.isArray(group.items)
        || Object.keys(group).some(key => !["kind", "title", "items"].includes(key))) return invalid();
      const items: PluginSettingsItem[] = group.items.map(value => {
        const item = object(value);
        if (!item) return invalid();
        if (item.kind === "property") {
          if (typeof item.property !== "string" || !Object.hasOwn(fields, item.property) || seen.has(item.property)
            || Object.keys(item).some(key => !["kind", "property"].includes(key))) return invalid();
          seen.add(item.property);
          return {kind:"property",property:item.property};
        }
        if (item.kind !== "tool" || !nonblank(item.tool) || item.title !== undefined && !nonblank(item.title)
          || item.description !== undefined && typeof item.description !== "string"
          || Object.keys(item).some(key => !["kind", "tool", "title", "description"].includes(key))) return invalid();
        return {kind:"tool",tool:item.tool,...item.title !== undefined ? {title:item.title as string} : {},
          ...item.description !== undefined ? {description:item.description as string} : {}};
      });
      return {kind:"group",title:group.title,items};
    });
  }
  return {schema:{type:"object",properties:fields,...schema.required !== undefined ? {required:[...schema.required as string[]]} : {}},
    values:{...values as Record<string, PluginSettingValue>},...layout !== undefined ? {layout} : {}};
}
export function pluginSettingsGroups(definition: PluginSettingsDefinition): { title?: string; other: boolean; items: PluginSettingsItem[] }[] {
  const groups = (definition.layout ?? []).map(group => ({title:group.title,other:false,items:group.items}));
  const listed = new Set(groups.flatMap(group => group.items.flatMap(item => item.kind === "property" ? [item.property] : [])));
  const remaining: PluginSettingsItem[] = Object.keys(definition.schema.properties).filter(key => !listed.has(key)).map(property => ({kind:"property",property}));
  return [...groups, ...remaining.length ? [{other:definition.layout !== undefined,items:remaining}] : []].filter(group => group.items.length > 0);
}
export function parsePluginSettingsUpdate(value: unknown): { values: Record<string, unknown> } {
  const values = object(object(value)?.values);
  if (!values) return invalid();
  return {values};
}
