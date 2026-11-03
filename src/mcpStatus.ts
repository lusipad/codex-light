import { callAppServer } from "./bridge";

export interface McpStatus {
  name: string;
  authStatus: string;
  runtimeStatus?: string | null;
  toolsError?: string | null;
  tools: Record<string, unknown>;
}

export async function readMcpServerStatus(serverName: string): Promise<McpStatus | null> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  let match: McpStatus | null = null;
  do {
    const page: { data: McpStatus[]; nextCursor?: string | null } = await callAppServer("mcpServerStatus/list", {
      serverName, cursor, limit: 100, detail: "full",
    });
    if (!Array.isArray(page?.data)) throw Error("MCP 状态响应格式无效");
    for (const row of page.data) if (row.name === serverName) match = row;
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (typeof cursor !== "string" || seen.has(cursor)) throw Error("MCP 状态分页无效");
      seen.add(cursor);
    }
  } while (cursor !== null);
  return match;
}

export function describeMcpStatus(status: McpStatus | null): string {
  if (!status) return "未返回该服务器的运行状态";
  if (status.toolsError) return `工具发现失败：${status.toolsError}`;
  const labels: Record<string, string> = {
    connected: "已连接",
    notStarted: "尚未启动",
    starting: "正在启动",
    authenticationRequired: "需要认证",
    failed: "连接失败",
    cancelled: "连接已取消",
    disabled: "已禁用",
  };
  const connection = status.runtimeStatus
    ? labels[status.runtimeStatus] || `运行状态：${status.runtimeStatus}`
    : "已读取目录，连接状态未知";
  const auth = status.authStatus === "notLoggedIn" ? "，未登录"
    : status.authStatus === "oAuth" ? "，OAuth 已授权"
    : status.authStatus === "bearerToken" ? "，令牌认证" : "";
  return `${connection}${auth}，${Object.keys(status.tools || {}).length} 个工具`;
}
