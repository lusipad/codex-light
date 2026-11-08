import { readChatgptService, type ServiceIdentity } from "./chatgptService";

type Connector = { id: string; name: string; disabled: boolean };
type Link = { id: string; connector_id: string; available: boolean; nickname: string | null };
export type RepositoryConnection = { connectorId: string; linkId: string | null; label: string; status: "connected" | "connect" | "disabled" | "reconnect" };
export type RepositoryInstallation = { id: string; account_login: string; account_type: string };
export type RepositoryCandidate = { id: string; name: string | null; repository_full_name: string; default_branch: string | null };

export async function loadRepositoryConnections(identity: ServiceIdentity, signal: AbortSignal): Promise<RepositoryConnection[]> {
  const [builtin, enterprise, accessible] = await Promise.all([
    readChatgptService("cloud_github_default", {}, identity, signal),
    readChatgptService("cloud_github_enterprise", {}, identity, signal),
    readChatgptService("cloud_github_links", {}, identity, signal),
  ]) as [Connector | null, { connectors: Connector[] }, { links: Link[] }];
  signal.throwIfAborted();
  const connectors = new Map<string, Connector>();
  for (const connector of [builtin, ...[...enterprise.connectors].sort((a, b) => a.name.localeCompare(b.name))])
    if (connector && !connectors.has(connector.id)) connectors.set(connector.id, connector);
  const links = new Map(accessible.links.map(link => [link.id, link]));
  return [...connectors.values()].flatMap(connector => {
    const matches = [...links.values()].filter(link => link.connector_id === connector.id);
    return (matches.length ? matches : [null]).map(link => ({
      connectorId: connector.id, linkId: link?.id ?? null, label: link?.nickname || connector.name,
      status: connector.disabled ? "disabled" : link?.available ? "connected" : link ? "reconnect" : "connect",
    }));
  });
}

export async function loadRepositoryInstallations(connection: RepositoryConnection, identity: ServiceIdentity, signal: AbortSignal) {
  if (connection.status !== "connected") return [];
  const result = await readChatgptService("cloud_github_installations", { connectorId: connection.connectorId, linkId: connection.linkId },
    identity, signal) as { memberships: RepositoryInstallation[]; other: RepositoryInstallation[] };
  signal.throwIfAborted();
  const installations = new Map<string, RepositoryInstallation>();
  for (const item of [...result.memberships, ...result.other]) if (!installations.has(item.id)) installations.set(item.id, item);
  return [...installations.values()];
}

export async function loadRepositoryPage(connection: RepositoryConnection, installation: RepositoryInstallation | null, query: string,
  page: number, identity: ServiceIdentity, signal: AbortSignal) {
  if (connection.status !== "connected") throw Error("GitHub 连接不可用。");
  const result = await readChatgptService("cloud_github_repositories", {
    connectorId: connection.connectorId, linkId: connection.linkId, page, query: query.trim(),
    installation: installation && { id: installation.id, accountLogin: installation.account_login, accountType: installation.account_type },
  }, identity, signal) as { repositories: RepositoryCandidate[] };
  signal.throwIfAborted();
  return { rows: result.repositories, nextPage: result.repositories.length === 20 ? page + 1 : null };
}
