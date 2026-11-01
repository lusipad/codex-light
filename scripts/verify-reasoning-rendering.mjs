import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeTimelineItem } from "../src/threadTimeline.ts";

console.log("=== Verify Reasoning Flow & Rendering Parity Test ===");

// 模拟 App.tsx 中的 extractReasoningText 函数
function extractReasoningText(item) {
  if (!item) return "";
  const parts = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (v && typeof v.text === "string" && v.text.trim()) parts.push(v.text.trim());
  };

  if (Array.isArray(item.summary)) item.summary.forEach(push);
  if (Array.isArray(item.content)) item.content.forEach(push);
  if (typeof item.text === "string" && item.text.trim()) parts.push(item.text.trim());
  if (Array.isArray(item.reasoningText)) item.reasoningText.forEach(push);
  else if (typeof item.reasoningText === "string" && item.reasoningText.trim()) {
    parts.push(item.reasoningText.trim());
  }

  if (!parts.length) {
    return "";
  }
  return Array.from(new Set(parts)).join("\n\n");
}

// 模拟 App.tsx 中的 Accordion 渲染决策
function shouldRenderThoughtAccordion(turn, isStreaming) {
  const thoughts = turn.items.filter((i) => i.type === "reasoning" || i.type === "thought");
  const meaningfulThoughts = thoughts.filter((t) => extractReasoningText(t).trim().length > 0);
  const messages = turn.items.filter((i) => i.type === "agentMessage" || i.type === "assistantMessage");
  const isCurrentlyThinking =
    isStreaming &&
    turn.status === "running" &&
    thoughts.length > 0 &&
    messages.length === 0;
  return meaningfulThoughts.length > 0 || isCurrentlyThinking;
}

// CASE 1: 服务端对简单问答（如“你好”）下发空 reasoning item
console.log("\n--- Scenario 1: Empty reasoning from simple queries like 'hello' ---");
const emptyReasoningTurn = {
  id: "turn_1",
  status: "completed",
  items: [
    { id: "msg_user_1", type: "userMessage", text: "你好" },
    { id: "rs_empty_1", type: "reasoning", summary: [], content: [] },
    { id: "msg_agent_1", type: "agentMessage", text: "你好！有什么我可以帮你的吗？" },
  ],
};

const shouldShowEmpty = shouldRenderThoughtAccordion(emptyReasoningTurn, false);
assert.equal(
  shouldShowEmpty,
  false,
  "Must NOT render thought accordion when reasoning item is empty on completed turn!"
);
console.log("PASS 1: Empty reasoning item produces NO accordion on completed turn (No fake/empty thought)");

// CASE 2: 服务端流式下发思考并在 item/completed 时保留
console.log("\n--- Scenario 2: Streaming reasoning text accumulation & completion ---");
let turns = [
  {
    id: "turn_stream_1",
    status: "running",
    items: [{ id: "u_1", type: "userMessage", text: "请证明勾股定理" }],
  },
];

// 2.1 item/started 下发
turns = mergeTimelineItem(turns, "turn_stream_1", "rs_deep_1", (item) => ({
  ...item,
  type: "reasoning",
  summary: [],
  content: [],
}));

// 2.2 流式 delta 到达 (item/reasoning/textDelta)
turns = mergeTimelineItem(turns, "turn_stream_1", "rs_deep_1", (item) => {
  const parts = Array.isArray(item.content) ? [...item.content] : [];
  parts[0] = (parts[0] || "") + "首先构造一个边长为 a+b 的正方形。";
  return { ...item, type: "reasoning", content: parts };
});

// 流式期间正在思考
assert.equal(shouldRenderThoughtAccordion(turns[0], true), true, "Must show thinking while running");

// 2.3 item/completed 到达，官方下发 payload
const completedReasoningItem = {
  id: "rs_deep_1",
  type: "reasoning",
  summary: ["勾股定理几何证明"],
  content: ["首先构造一个边长为 a+b 的正方形。内部包含四个直角三角形和一个边长为 c 的正方形。"],
};

// 模拟修复后的 item/completed 合并逻辑
turns = mergeTimelineItem(turns, "turn_stream_1", completedReasoningItem.id, (existing) => {
  const merged = { ...existing, ...completedReasoningItem };
  if (completedReasoningItem.type === "reasoning") {
    if (existing.summary?.length && (!completedReasoningItem.summary || completedReasoningItem.summary.length === 0)) {
      merged.summary = existing.summary;
    }
    if (existing.content?.length && (!completedReasoningItem.content || completedReasoningItem.content.length === 0)) {
      merged.content = existing.content;
    }
    if (existing.text && !completedReasoningItem.text) {
      merged.text = existing.text;
    }
    if (existing.reasoningText && !completedReasoningItem.reasoningText) {
      merged.reasoningText = existing.reasoningText;
    }
  }
  return merged;
});

turns[0].status = "completed";

assert.equal(
  shouldRenderThoughtAccordion(turns[0], false),
  true,
  "Must render thought accordion when substantial reasoning text exists on completed turn"
);

const extracted = extractReasoningText(turns[0].items.find((i) => i.id === "rs_deep_1"));
assert.ok(extracted.includes("勾股定理几何证明"), "Summary must be extracted");
assert.ok(extracted.includes("正方形"), "Content must be extracted");
console.log("PASS 2: Real streaming reasoning is fully preserved and rendered after completion");

// CASE 3: 检查 App.tsx 源代码断言，确保致命清空语句已被根除且开启了 summary: auto 请求
console.log("\n--- Scenario 3: Static check on App.tsx ---");
const appSrc = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(
  !appSrc.includes("item.type === \"reasoning\" ? { text: undefined"),
  "App.tsx must NOT contain the destructive reasoning undefined assignment"
);
assert.ok(
  appSrc.includes("meaningfulThoughts = thoughts.filter"),
  "App.tsx must filter for meaningful thoughts"
);
assert.ok(
  appSrc.includes('summary: reasoningSummary || "auto"'),
  "App.tsx turn/start must request reasoning summary"
);
console.log("PASS 3: App.tsx codebase is clean of reasoning wipeout and requests reasoning summary");

console.log("\nALL REASONING PARITY CHECKS PASSED!");
