import { callAppServer } from "./bridge";
import type { PluginProvidedSettingsView } from "./pluginProvidedSettings";

interface SettingsContext {
  key: string;
  leases: number;
  inFlight: number;
  retired: boolean;
  threadId: string | null;
  starting: Promise<string> | null;
  unsubscribed: boolean;
}
export interface PluginSettingsRuntime {
  call(toolName: string, argumentsValue: Record<string, unknown>): Promise<unknown>;
  dispose(): void;
}
const contexts = new Map<string, SettingsContext>();
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function releaseThread(context: SettingsContext): void {
  if (!context.retired || context.inFlight > 0 || !context.threadId || context.unsubscribed) return;
  context.unsubscribed = true;
  void callAppServer("thread/unsubscribe", { threadId: context.threadId }).catch(error => {
    console.warn("无法释放插件设置临时会话。", error);
  });
}
async function threadFor(context: SettingsContext): Promise<string> {
  if (context.threadId) return context.threadId;
  if (context.starting) return context.starting;
  const starting = callAppServer<{ thread: { id: string; ephemeral: boolean } }>("thread/start", {
    ephemeral: true, permissions: ":read-only", threadSource: "mcp_extension_host",
  }).then(result => {
    if (typeof result?.thread?.id !== "string" || !result.thread.id) throw Error("插件设置临时会话响应无效。");
    context.threadId = result.thread.id;
    if (result.thread.ephemeral !== true) {
      context.retired = true;
      if (contexts.get(context.key) === context) contexts.delete(context.key);
      throw Error("插件设置临时会话响应无效。");
    }
    releaseThread(context);
    return result.thread.id;
  });
  context.starting = starting;
  try { return await starting; }
  catch (error) { if (context.starting === starting) context.starting = null; throw error; }
}

/** identity must include the caller's account/session and app-server connection scope. */
export function acquirePluginSettingsRuntime(identity: string, view: PluginProvidedSettingsView): PluginSettingsRuntime {
  if (!identity.trim()) throw Error("插件设置缺少连接身份。");
  if (view.hostId !== "local") throw Error("插件设置工具当前仅支持本机执行。");
  if (view.server === "codex_apps") throw Error("此设置运行时仅支持普通 MCP 服务器。");
  const key = JSON.stringify([identity, view.hostId]);
  let context = contexts.get(key);
  if (!context) {
    context = { key, leases: 0, inFlight: 0, retired: false, threadId: null, starting: null, unsubscribed: false };
    contexts.set(key, context);
  }
  const current = context, server = view.server;
  const tools = view.tools.map(tool => ({ name: tool.name, fileParams: Object.hasOwn(object(tool._meta) ?? {}, "openai/fileParams") }));
  current.leases++;
  let disposed = false;
  const assertCurrent = () => { if (disposed || current.retired) throw Error("插件设置上下文已关闭。"); };
  return {
    async call(toolName, argumentsValue) {
      assertCurrent();
      const tool = tools.find(tool => tool.name === toolName);
      if (!tool) throw Error("插件设置工具不在真实服务器目录中。");
      if (tool.fileParams) throw Error("插件设置不能调用接受文件参数的工具。");
      current.inFlight++;
      try {
        const threadId = await threadFor(current);
        assertCurrent();
        const result = await callAppServer("mcpServer/tool/call", { server, threadId, tool: tool.name, arguments: argumentsValue });
        assertCurrent();
        return result;
      } finally { current.inFlight--; releaseThread(current); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--current.leases === 0) {
        current.retired = true;
        if (contexts.get(current.key) === current) contexts.delete(current.key);
        releaseThread(current);
      }
    },
  };
}
