import { safeSiteUrl } from "./sitesService";

export type SiteSharingMode = "admins_only" | "workspace_all" | "custom" | "public";
export interface SiteSharingUser extends Record<string, unknown> { account_user_id?: string | null; email?: string | null; name?: string | null; role?: string | null; editable?: boolean | null; pending?: boolean | null }
export interface SiteSharingGroup extends Record<string, unknown> { id: string; name?: string | null; size?: number | null; editable?: boolean | null; pending?: boolean | null }
export interface SiteSharingPolicy { accessMode: SiteSharingMode; availableModes: SiteSharingMode[] | null; users: SiteSharingUser[]; groups: SiteSharingGroup[]; showPrivateTunnelsWarning: boolean }
const modes = ["admins_only", "workspace_all", "custom", "public"];
const invalid = () => Error("共享设置返回了无法识别的数据。");
const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
const mode = (value: any): SiteSharingMode => { if (!modes.includes(value)) throw invalid(); return value; };
function user(value: any): SiteSharingUser {
  if (!object(value) || ["account_user_id", "email", "name", "role"].some(key => value[key] != null && typeof value[key] !== "string")
    || ["editable", "pending"].some(key => value[key] != null && typeof value[key] !== "boolean")) throw invalid();
  return { ...value };
}
export function parseSiteSharing(value: any): SiteSharingPolicy | null {
  if (value === null) return null;
  if (!object(value) || !Array.isArray(value.users) || value.allowed_editors !== undefined && !Array.isArray(value.allowed_editors)
    || value.groups != null && !Array.isArray(value.groups) || value.available_access_modes != null && !Array.isArray(value.available_access_modes)
    || value.show_private_tunnels_warning != null && typeof value.show_private_tunnels_warning !== "boolean") throw invalid();
  const users = value.users.map(user), editors = (value.allowed_editors ?? []).map(user);
  return { accessMode: mode(value.access_mode), availableModes: value.available_access_modes == null ? null : value.available_access_modes.map(mode),
    users: [...users.filter((entry: SiteSharingUser) => entry.role === "owner" || !editors.some((editor: SiteSharingUser) => editor.account_user_id === entry.account_user_id)),
      ...editors.map((entry: SiteSharingUser) => ({ ...entry, role: "editor", editable: true }))],
    groups: (value.groups ?? []).map((entry: any) => { if (!object(entry) || typeof entry.id !== "string" || entry.name != null && typeof entry.name !== "string") throw invalid(); return { ...entry }; }),
    showPrivateTunnelsWarning: value.show_private_tunnels_warning === true };
}
export function siteSharingModeOptions(policy: SiteSharingPolicy, workspace: boolean): { value: SiteSharingMode; disabled: boolean }[] {
  const available = policy.availableModes ?? (workspace ? ["workspace_all", "custom"] as SiteSharingMode[] : []);
  const options = available.map(value => ({ value, disabled: false }));
  return available.includes(policy.accessMode) ? options : [...options, { value: policy.accessMode, disabled: true }];
}
export function isSiteSharingOwner(policy: SiteSharingPolicy, memberId: string | null, email: string | null): boolean {
  return policy.users.some(entry => entry.role === "owner" && (Boolean(memberId) && entry.account_user_id === memberId
    || Boolean(email) && entry.email?.toLowerCase() === email?.toLowerCase()));
}
export function parseSitePreferredUrl(value: any): string | null {
  if (value === null) return null;
  if (!object(value) || !(value.live_url === null || typeof value.live_url === "string") || value.live_url !== null && !safeSiteUrl(value.live_url)) throw invalid();
  return value.live_url;
}
