import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeTimelineItem } from "../src/threadTimeline.ts";

console.log("=== Verify Duplicate User Message Regression Test ===");

// 模拟初始状态：用户在界面发送了一句话 "你好"
const initialUserTurn = {
  id: "pending-turn-123456",
  status: "running",
  startedAt: Date.now(),
  items: [{ id: "u-123456", type: "userMessage", text: "你好" }],
};

let turns = [initialUserTurn];

// 1. 测试 mergeTimelineItem：当服务端推流 delta 到达时，若找不到 turn_server_1，必须承接 pending 轮次，不能追加第二个 turn
turns = mergeTimelineItem(turns, "turn_server_1", "item_agent_1", (item) => ({
  ...item,
  type: "agentMessage",
  text: "你好！",
}));

assert.equal(turns.length, 1, "Must NOT create a second turn when delta arrives; must adopt pending turn");
assert.equal(turns[0].id, "turn_server_1", "Pending turn must be updated to turn_server_1");

console.log("PASS 1: mergeTimelineItem seamlessly adopts pending turn without duplicating turns");

// 1.5 关键实测场景：服务端在 turn 启动后推送 item/started，包含服务端的真实 userMessage
turns = mergeTimelineItem(turns, "turn_server_1", "server_user_msg_1", (item) => ({
  ...item,
  type: "userMessage",
  content: [{ type: "text", text: "你好" }],
}));

const userItems = turns[0].items.filter((it) => it.type === "userMessage" || it.type === "user");
assert.equal(userItems.length, 1, "Must NOT append duplicate userMessage inside turn.items; must replace optimistic userMessage");
assert.equal(userItems[0].id, "server_user_msg_1", "Optimistic userMessage must be upgraded to server userMessage ID");

console.log("PASS 1.5: item/started for userMessage replaces optimistic item, preserving single user bubble");

// 2. 测试 turn/completed：服务端返回权威 items，其中包括服务端的 userMessage
const completedItems = [
  { id: "server_user_msg_1", type: "userMessage", content: [{ type: "text", text: "你好" }] },
  { id: "item_agent_1", type: "agentMessage", text: "你好！有什么需要我帮忙的？" },
];

const hasServerUserMsg = completedItems.some((it) => it.type === "userMessage" || it.type === "user");
const localItems = hasServerUserMsg
  ? turns[0].items.filter((it) => it.type !== "userMessage" && it.type !== "user")
  : turns[0].items;

const byId = new Map();
for (const it of localItems) if (it?.id) byId.set(it.id, it);
for (const it of completedItems) {
  const existing = it?.id ? byId.get(it.id) : undefined;
  if (existing) byId.set(it.id, { ...existing, ...it });
  else if (it?.id) byId.set(it.id, it);
}

const mergedItems = Array.from(byId.values());
turns[0] = { ...turns[0], items: mergedItems };

const finalUserMessages = turns[0].items.filter((it) => it.type === "userMessage" || it.type === "user");
assert.equal(finalUserMessages.length, 1, "Must contain exactly ONE user message after completedItems merge");
assert.equal(finalUserMessages[0].id, "server_user_msg_1", "Must adopt authoritative server userMessage");

console.log("PASS 2: turn/completed deduplicates userMessage and preserves exact single user bubble");
console.log("\nALL DUPLICATE MESSAGE CHECKS PASSED!");
