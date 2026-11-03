export interface RemotePullRequestTarget {
  hostname: string;
  owner: string;
  repository: string;
  number: number;
  url: string;
}

export interface RemotePullRequest {
  pullRequest: RemotePullRequestTarget;
  account: { hostId: string; hostname: string; login: string; connection?: { connectorId: string; accountLinkId: string } };
  metadata: { status: "success"; headRevision: string; additions: number | null; deletions: number | null; changedFiles: number | null;
    createdAt: string; authorLogin: string | null };
  summary: { status: "success"; headRevision: string; title: string | null; state: "open" | "closed" | "merged";
    baseBranch: string | null; headBranch: string | null; isDraft?: boolean };
  description: string;
  diff: { headRevision: string; unifiedDiff: string };
}

export function parseRemotePullRequestUrl(value: string): RemotePullRequestTarget {
  const raw = value.trim();
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw Error("请输入完整的 HTTPS GitHub Pull Request 链接。"); }
  const authorityAndPath = raw.split("://")[1] ?? "";
  const authority = authorityAndPath.split(/[/?#]/)[0];
  const rawPath = authorityAndPath.slice(authority.length).split(/[?#]/)[0];
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !match ||
    authority.includes(":") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw) || rawPath !== parsed.pathname ||
    !Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= 0 || [match[1], match[2]].some(part => part === "." || part === ".."))
    throw Error("不支持此 Pull Request 链接，请使用 HTTPS 仓库 PR 地址。");
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  const owner = match[1].toLowerCase(), repository = match[2].toLowerCase(), number = Number(match[3]);
  return { hostname, owner, repository, number, url: `https://${hostname}/${owner}/${repository}/pull/${number}` };
}

export function parseRemotePullRequest(value: unknown, requestedUrl: string): RemotePullRequest {
  const data = value as RemotePullRequest | null;
  const target = parseRemotePullRequestUrl(requestedUrl);
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  const count = (value: unknown) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  if (!data?.pullRequest || !data.account || !data.metadata || !data.summary || !data.diff ||
    !Object.entries(target).every(([key, expected]) => data.pullRequest[key as keyof RemotePullRequestTarget] === expected) ||
    data.account.hostname !== target.hostname || data.account.hostId !== "local" || !nonempty(data.account.login) ||
    (data.account.connection !== undefined && data.account.connection !== null &&
      (!nonempty(data.account.connection.connectorId) || !nonempty(data.account.connection.accountLinkId))) ||
    data.metadata.status !== "success" || !nonempty(data.metadata.headRevision) ||
    ![data.metadata.additions, data.metadata.deletions, data.metadata.changedFiles].every(count) ||
    !nonempty(data.metadata.createdAt) || !nullableString(data.metadata.authorLogin) ||
    data.summary.status !== "success" || !["open", "closed", "merged"].includes(data.summary.state) ||
    ![data.summary.title, data.summary.baseBranch, data.summary.headBranch].every(nullableString) ||
    (data.summary.isDraft !== undefined && typeof data.summary.isDraft !== "boolean") ||
    typeof data.description !== "string" || typeof data.diff.unifiedDiff !== "string" ||
    data.metadata.headRevision !== data.diff.headRevision || data.metadata.headRevision !== data.summary.headRevision) {
    throw Error("Pull Request 数据不完整、身份不符或提交已变化，请重新读取。");
  }
  return data;
}
