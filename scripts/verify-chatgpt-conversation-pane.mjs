import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const UserMessageBubble = () => {}, MarkdownView = () => {};
const api = {}, react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) };
const code = ts.transpileModule(fs.readFileSync("src/components/ChatgptConversationPane.tsx", "utf8"), {
  fileName: "ChatgptConversationPane.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
vm.runInNewContext(code, { exports: api, require(name) {
  if (name === "react") return react;
  if (name === "./UserMessageBubble") return { UserMessageBubble };
  if (name === "./MarkdownView") return { MarkdownView };
  if (name.endsWith(".css")) return {};
  throw Error(`Unexpected dependency or side effect ${name}`);
} });
const all = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : [];
const text = node => node && typeof node === "object" ? (node.children ?? []).map(text).join("") : typeof node === "string" ? node : "";
const composer = react.createElement("composer-fixture", { marker: "actual-owner-composer" });
const message = (id, role, value, extra = {}) => ({ id, raw: { id, author: { role }, content: { content_type: "text", parts: [value] } }, text: value, ...extra });
const render = props => api.ChatgptConversationPane({ messages: [], pending: false, error: null, composer, ...props });
{
  const tree = render({ messages: [message("u-actual", "user", "原始用户草稿", { optimistic: true }), message("a-actual", "assistant", "**真实回复**")] });
  const nodes = all(tree), rows = nodes.filter(node => node.props["data-chatgpt-message-id"]);
  assert.deepEqual(rows.map(node => node.props["data-chatgpt-message-id"]), ["u-actual", "a-actual"]);
  assert.equal(rows[0].props.key, "u-actual"); assert.equal(rows[1].props.key, "a-actual");
  const user = nodes.find(node => node.type === UserMessageBubble), assistant = nodes.find(node => node.type === MarkdownView);
  assert.equal(user.props.text, "原始用户草稿"); assert.equal(assistant.props.content, "**真实回复**");
  assert.equal(user.props.remoteContent, "no-remote-images"); assert.equal(assistant.props.remoteContent, "no-remote-images");
  assert.equal(nodes.filter(node => node === composer).length, 1); assert.equal(nodes.find(node => node.props.role === "status"), undefined);
  const updated = render({ messages: [message("u-actual", "user", "原始用户草稿"), message("a-actual", "assistant", "完整回复")] });
  assert.deepEqual(all(updated).filter(node => node.props["data-chatgpt-message-id"]).map(node => node.props.key), ["u-actual", "a-actual"]);
  console.log("PASS actual message order/IDs remain stable and reuse the safe existing renderers");
}
{
  const raw = { id: "opaque", author: { role: "tool" }, content: { content_type: "unknown", payload: "<script>do-not-run</script>" } };
  const tree = render({ messages: [{ id: "opaque", raw, text: null }, message("unsupported-role", "system", "必须保留的原文") ] });
  const nodes = all(tree), serialized = text(tree);
  assert.ok(serialized.includes("do-not-run")); assert.ok(serialized.includes("必须保留的原文"));
  assert.equal(nodes.some(node => node.type === UserMessageBubble || node.type === MarkdownView), false);
  assert.equal(nodes.some(node => node.props.dangerouslySetInnerHTML), false); assert.equal(nodes.some(node => node.type === "script"), false);
  assert.equal(nodes.filter(node => node.props["data-chatgpt-message-id"]).length, 2);
  console.log("PASS unsupported content and roles retain readable raw data without active HTML or fake text messages");
}
{
  const directed = message("assistant-tool-target", "assistant", "tool-directed text", { unsupported: true });
  directed.raw.recipient = "python";
  const unknownContent = message("assistant-unknown-content", "assistant", "must not become a normal answer", { unsupported: true });
  unknownContent.raw.content = { content_type: "unknown", text: "must not become a normal answer" };
  const nodes = all(render({ messages: [directed, unknownContent] }));
  assert.equal(nodes.some(node => node.type === MarkdownView || node.type === UserMessageBubble), false,
    "controller unsupported verdict must survive the presentation boundary");
  assert.ok(nodes.some(node => node.type === "pre" && text(node).includes('"recipient": "python"')));
  assert.ok(nodes.some(node => node.type === "pre" && text(node).includes('"content_type": "unknown"')));
  console.log("PASS controller unsupported flag preserves tool-directed/unknown assistant content as raw data");
}
{
  for (const messages of [[], [message("partial", "assistant", "已经收到的部分内容")]]) {
    const tree = render({ messages, pending: true, error: "连接中断，状态未知" });
    assert.ok(all(tree).some(node => node.props.role === "status"));
    assert.ok(all(tree).some(node => node.props.role === "alert" && text(node).includes("连接中断")));
    assert.equal(all(tree).filter(node => node === composer).length, 1);
    assert.equal(all(tree).some(node => node.type === "button"), false, "No invented retry/send action");
    if (messages.length) assert.equal(all(tree).find(node => node.type === MarkdownView).props.content, "已经收到的部分内容");
  }
  const empty = render({}); assert.equal(text(empty).includes("成功"), false); assert.equal(text(empty).includes("暂无历史"), false);
  assert.equal(all(empty).filter(node => node === composer).length, 1);
  console.log("PASS independent pending/error slots preserve partial messages and original composer, with no fake retry/success");
}
{
  let retries = 0;
  const loading = render({ loadingHistory: true });
  assert.ok(all(loading).some(node => node.props.role === "status" && text(node).includes("读取聊天历史")));
  assert.equal(all(loading).some(node => node.type === "button"), false);
  const failed = render({ error: "历史读取失败", onRetryHistory: () => { retries++; } });
  const retry = all(failed).find(node => node.type === "button");
  assert.ok(retry); assert.equal(retries, 0); retry.props.onClick(); assert.equal(retries, 1);
  assert.equal(all(render({ error: "流结果未知" })).some(node => node.type === "button"), false,
    "unknown submission must not acquire a history retry or resend action");
  console.log("PASS history loading and explicit read retry remain separate from unknown submission delivery");
}
{
  const tree = render({ readOnly: true, remoteActivity: "active" });
  assert.ok(text(tree).includes("只读")); assert.ok(text(tree).includes("远端任务正在进行"));
  assert.equal(text(tree).includes("正在等待回复"), false, "remote activity is not an attached local completion stream");
  assert.equal(all(tree).some(node => node.type === "button"), false, "remote activity never invents stop or resend results");
  assert.ok(text(render({ remoteActivity: "background" })).includes("远端后台任务"));
  assert.equal(text(render({ remoteActivity: "unknown" })).includes("远端任务"), false);
  console.log("PASS readonly and known remote activity are explicit without fabricating a resumed local stream");
}
console.log("ChatGPT conversation pane: 6 production JSX groups passed; leaf renderer props inspected, no GUI/HTTP/model");
