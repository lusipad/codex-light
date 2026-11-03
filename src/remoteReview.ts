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

function validRemoteBinding(data: Pick<RemotePullRequest, "pullRequest" | "account" | "metadata"> | null, requestedUrl: string): boolean {
  const target = parseRemotePullRequestUrl(requestedUrl);
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const count = (value: unknown) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return !(!data?.pullRequest || !data.account || !data.metadata ||
    !Object.entries(target).every(([key, expected]) => data.pullRequest[key as keyof RemotePullRequestTarget] === expected) ||
    data.account.hostname !== target.hostname || data.account.hostId !== "local" || !nonempty(data.account.login) ||
    (data.account.connection !== undefined && data.account.connection !== null &&
      (!nonempty(data.account.connection.connectorId) || !nonempty(data.account.connection.accountLinkId))) ||
    data.metadata.status !== "success" || !nonempty(data.metadata.headRevision) ||
    ![data.metadata.additions, data.metadata.deletions, data.metadata.changedFiles].every(count) ||
    !nonempty(data.metadata.createdAt) || (data.metadata.authorLogin !== null && typeof data.metadata.authorLogin !== "string"));
}

export function parseRemotePullRequest(value: unknown, requestedUrl: string): RemotePullRequest {
  const data = value as RemotePullRequest | null;
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  if (!validRemoteBinding(data, requestedUrl) || !data?.summary || !data.diff ||
    data.summary.status !== "success" || !["open", "closed", "merged"].includes(data.summary.state) ||
    ![data.summary.title, data.summary.baseBranch, data.summary.headBranch].every(nullableString) ||
    (data.summary.isDraft !== undefined && typeof data.summary.isDraft !== "boolean") ||
    typeof data.description !== "string" || typeof data.diff.unifiedDiff !== "string" ||
    data.metadata.headRevision !== data.diff.headRevision || data.metadata.headRevision !== data.summary.headRevision) {
    throw Error("Pull Request 数据不完整、身份不符或提交已变化，请重新读取。");
  }
  return data;
}

export interface PinnedReviewSnapshot {
  baseRevision: string;
  headRevision: string;
  mergeBaseRevision: string;
  commits?: { sha: string; parentSha: string | null; title: string }[];
}

export interface PinnedReviewBinding {
  snapshotId: string;
  pullRequest: RemotePullRequestTarget;
  account: RemotePullRequest["account"];
  metadata: RemotePullRequest["metadata"];
  snapshot: PinnedReviewSnapshot;
  comparison: { baseRevision: string; headRevision: string };
}

export interface PinnedReviewComparison extends PinnedReviewBinding {
  diff: { headRevision: string; unifiedDiff: string };
}

export interface PinnedReviewFile extends PinnedReviewBinding {
  file: { status: "success"; baseContent: string; headContent: string } | { status: "unavailable"; reason?: string };
}

function parsePinnedBinding(value: unknown, requestedUrl: string, snapshotId: string | null, commitSha: string | null): PinnedReviewBinding {
  const data = value as PinnedReviewBinding | null;
  const sha = (value: unknown): value is string => typeof value === "string" && /^[a-fA-F0-9]{40}$/.test(value);
  const snapshot = data?.snapshot;
  const commits = snapshot?.commits;
  if (commits !== undefined && !Array.isArray(commits)) throw Error("固定提交列表格式无效。");
  const commit = commits?.find(item => item?.sha === commitSha);
  if (!data || typeof data.snapshotId !== "string" || !data.snapshotId.trim() || (snapshotId !== null && data.snapshotId !== snapshotId) ||
    !snapshot || ![snapshot.baseRevision, snapshot.headRevision, snapshot.mergeBaseRevision].every(sha) ||
    (commits !== undefined && (!Array.isArray(commits) || commits.some(item => !item || !sha(item.sha) ||
      (item.parentSha !== null && !sha(item.parentSha)) || typeof item.title !== "string") || new Set(commits.map(item => item.sha)).size !== commits.length)) ||
    (commitSha !== null && (!commit || commit.parentSha === null)) || !data.comparison ||
    data.comparison.baseRevision !== (commit?.parentSha ?? snapshot.mergeBaseRevision) ||
    data.comparison.headRevision !== (commit?.sha ?? snapshot.headRevision)) throw Error("固定提交比较不完整或不属于所选快照。");
  if (!validRemoteBinding(data, requestedUrl) || data.metadata.headRevision !== snapshot.headRevision)
    throw Error("固定提交比较的账号或元数据不匹配。");
  return data;
}

export function parsePinnedReviewComparison(value: unknown, requestedUrl: string, snapshotId: string | null, commitSha: string | null): PinnedReviewComparison {
  const binding = parsePinnedBinding(value, requestedUrl, snapshotId, commitSha);
  const data = value as PinnedReviewComparison;
  if (!data.diff || data.diff.headRevision !== binding.comparison.headRevision || typeof data.diff.unifiedDiff !== "string")
    throw Error("固定提交差异不完整或提交不一致。");
  return data;
}

export function parsePinnedReviewFile(value: unknown, requestedUrl: string, snapshotId: string, commitSha: string | null): PinnedReviewFile {
  parsePinnedBinding(value, requestedUrl, snapshotId, commitSha);
  const data = value as PinnedReviewFile;
  if (!data.file || (data.file.status !== "unavailable" && data.file.status !== "success") ||
    (data.file.status === "success" && (typeof data.file.baseContent !== "string" || typeof data.file.headContent !== "string")) ||
    (data.file.status === "unavailable" && data.file.reason !== undefined && typeof data.file.reason !== "string"))
    throw Error("固定提交文件内容不可用或响应不完整。");
  return data;
}
