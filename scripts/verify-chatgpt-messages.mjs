import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptMessages.ts", "utf8"), {
  fileName: "chatgptMessages.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(exports.createChatgptDraftIdentity("actual-local-uuid")), {
  clientId: "local-chatgpt:actual-local-uuid", parentMessageId: "client-created-root",
});
assert.equal("conversationId" in exports.createChatgptDraftIdentity("another-uuid"), false,
  "client-created-root is the actual initial parent, not a generated server conversation");
// Source CS08 ordinary user branch: .trim(), seconds, attribution flow id,
// explicit nullable fields. User-message status is not assistant completion.
const message = exports.createChatgptUserMessage({ id: "message-client-id", prompt: " \n中文\n  保留内部空白\n ", createdAt: 1_700_000_000_123 });
assert.deepEqual(plain(message), {
  author: { metadata: {}, name: null, role: "user" }, channel: null,
  content: { content_type: "text", parts: ["中文\n  保留内部空白"] }, create_time: 1_700_000_000.123,
  end_turn: null, id: "message-client-id",
  metadata: { automation_creation_attribution: { origin: "conversation", flow_id: "message-client-id" } },
  recipient: "all", status: "finished_successfully", update_time: null, weight: 1,
});
assert.equal("conversation_id" in message, false, "client message id must not invent a server conversation");
assert.equal("model" in message, false, "model belongs to completion request, not user message");
const other = exports.createChatgptUserMessage({ id: "message-two", prompt: "data: [DONE]\n# user text", createdAt: 0 });
assert.equal(other.content.parts[0], "data: [DONE]\n# user text", "user text is data, never a transport event");
assert.equal(other.metadata.automation_creation_attribution.flow_id, "message-two");
assert.notEqual(message.author.metadata, other.author.metadata, "message metadata is not shared across drafts");
console.log("PASS fixed ordinary ChatGPT user wire golden: Unicode/trim/time/identity/attribution, no invented conversation or model result");

const base = { model: "actual-selected-slug", thinkingEffort: null, messages: [message], parentMessageId: null,
  timezone: "Asia/Shanghai", timezoneOffsetMinutes: -480, systemHints: [], isTemporaryChat: false };
assert.deepEqual(plain(exports.createChatgptTextRequest(base)), {
  action: "next", model: "actual-selected-slug", timezone: "Asia/Shanghai", timezone_offset_min: -480,
  messages: [plain(message)], supported_encodings: ["v1"],
}, "undefined source inputs do not acquire invented false/null/defaults or a server/root id");
const request = plain(exports.createChatgptTextRequest({ ...base, conversationId: "actual-server-id", parentMessageId: "actual-node",
  projectId: "g-p-actual", thinkingEffort: "extended", isTemporaryChat: true, systemHints: ["actual-hint"],
  isDoNotRemember: false, consumerLockdownModeDisabled: false, requestedDefaultModel: "policy-default" }));
assert.equal(request.conversation_id, "actual-server-id"); assert.equal(request.parent_message_id, "actual-node");
assert.deepEqual(request.conversation_mode, { kind: "gizmo_interaction", gizmo_id: "g-p-actual" });
assert.equal(request.gizmo_id, "g-p-actual"); assert.equal(request.history_and_training_disabled, true);
assert.equal(request.thinking_effort, "extended"); assert.equal(request.is_do_not_remember, false);
assert.equal(request.consumer_lockdown_mode_disabled, false); assert.equal(request.requested_default_model, "policy-default");
assert.equal(request.one_off_model_override, true); assert.deepEqual(request.system_hints, ["actual-hint"]);
for (const origin of ["tpp", "flora"]) assert.equal("requested_default_model" in plain(exports.createChatgptTextRequest({
  ...base, conversationOrigin: origin, requestedDefaultModel: "different" })), false);
assert.equal("one_off_model_override" in plain(exports.createChatgptTextRequest({ ...base, requestedDefaultModel: base.model })), false);
console.log("PASS fixed next-request projection: actual ancestry/project/effort, source omission and override conditions; no generated service result");
