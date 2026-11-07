import type { CloudNetwork } from "./cloudEnvironmentService";

export type CloudNetworkPolicy =
  | { type: "disabled" | "unrestricted" }
  | { type: "restricted"; presets: "package_managers"[]; egress_rules: { host: string }[] };

export function draftNetworkPolicy(network: CloudNetwork): CloudNetworkPolicy {
  if (network.type !== "restricted") return { type: network.type };
  return { type: "restricted", presets: network.packageManagers ? ["package_managers"] : [],
    egress_rules: [...new Set(network.hosts)].map(host => ({ host })) };
}

export function sameDraftNetwork(left: CloudNetwork, right: CloudNetwork) {
  if (left.type !== right.type) return false;
  if (left.type !== "restricted") return true;
  const hosts = new Set(left.hosts);
  return left.packageManagers === right.packageManagers && hosts.size === new Set(right.hosts).size
    && right.hosts.every(host => hosts.has(host));
}

export function networkDomainEntry(input: string, existing: string[]): { host: string } | { error: string } {
  const normalize = (host: string) => host.trim().replace(/\.$/, "").toLowerCase();
  if (/[/:?#@]/.test(input)) return { error: "输入主机名时，请勿包含 URL、路径或端口" };
  const host = normalize(input);
  const labels = host.replace(/^\*\./, "").split(".");
  if (host !== "*" && !labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
    return { error: "请输入主机名，例如 example.com 或 *.example.com" };
  if (host.length > 253 || labels.some(label => label.length > 63))
    return { error: "主机名不得超过 253 个字符，每个标签不得超过 63 个字符" };
  if (/^(?:[0-9]+|0x[0-9a-f]+)$/.test(labels.at(-1)!)
    && (host.startsWith("*.") || labels.length !== 4 || !labels.every(label => /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255)))
    return { error: "请使用完整的 IPv4 地址，例如 192.0.2.1" };
  return existing.some(value => normalize(value) === host) ? { error: "此域名已在允许列表中" } : { host };
}
