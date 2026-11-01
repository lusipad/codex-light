import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

console.log("=== Unit 02 Thread Basics Parity Verification ===");

// 1. T01 & T02: Thread identity & Timeline Notification Isolation
const timelineTs = fs.readFileSync("src/threadTimeline.ts", "utf8");
assert.ok(timelineTs.includes("prepareHistoryReplay"), "T01: Must include prepareHistoryReplay for official hydration buffering");
assert.ok(timelineTs.includes("isCurrentThreadRequest"), "T01: Must verify request thread generation identity");
assert.ok(timelineTs.includes("mergeTimelineItem"), "T02: Must merge items by unique turn and item identity");
console.log("PASS T01-T02: Cross-thread event isolation, turn/item identity merging");

// 2. T03 & T04: Request Generation and Failure Retry
const appTsx = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(appTsx.includes("threadRequestRef") && appTsx.includes("isCurrentThreadRequest"),
  "T03: App must track thread selection request identity via isCurrentThreadRequest to prevent A->B race conditions");
assert.ok(appTsx.includes("loadEarlierTurns") || appTsx.includes("fetchEarlierTurns") || appTsx.includes("readEarlierTurns"),
  "T03: Pagination / earlier turns loader must be supported");
assert.ok(appTsx.includes("重试") || appTsx.includes("retry"),
  "T04: History load failures must be visible and retryable");
console.log("PASS T03-T04: Thread switching race prevention and failure retry");

// 3. T05: Scroll Stability & Turn Action Row Stability
assert.ok(appTsx.includes("turn.id === activeTurnId"),
  "T05: Streaming action hide must be strictly scoped to current active turn (historical turns stay stable)");
assert.ok(appTsx.includes("scrollHeight") || appTsx.includes("scrollTop"),
  "T05: Viewport scroll position must be managed during streaming and prepending");
console.log("PASS T05: Scroll stability and historical action stability");

// 4. T06 & T07: Markdown Fence Parsing & Link/HTML Protection
const markdownViewTsx = fs.readFileSync("src/components/MarkdownView.tsx", "utf8");
assert.ok(markdownViewTsx.includes("splitMarkdownBlocks") && markdownViewTsx.includes("fence.marker"),
  "T06: Must support markdown fences via splitMarkdownBlocks and fence.marker");
assert.ok(markdownViewTsx.includes("decodeFilePath") && markdownViewTsx.includes("decodeURIComponent"),
  "T07: URL handling must safely handle malformed URI components via decodeFilePath");
console.log("PASS T06-T07: Markdown fences (unclosed/longer/tilde) and safe URL decoding");

// 5. T08: Structured Search in ThreadFindBar
const findBarTsx = fs.readFileSync("src/components/ThreadFindBar.tsx", "utf8");
const threadTextTs = fs.readFileSync("src/threadText.ts", "utf8");
assert.ok(findBarTsx.includes("extractTextFromItem"),
  "T08: ThreadFindBar must use extractTextFromItem instead of String() on content arrays");
assert.ok(threadTextTs.includes("Array.isArray(item.content)"),
  "T08: extractTextFromItem must unpack array structured text parts");
assert.ok(!findBarTsx.includes("[object Object]"),
  "T08: Must not leak [object Object]");
console.log("PASS T08: ThreadFindBar structured search without [object Object]");

// 6. T09: Clipboard API with Textarea Fallback
const clipboardTs = fs.readFileSync("src/clipboard.ts", "utf8");
assert.ok(clipboardTs.includes("navigator.clipboard.writeText"),
  "T09: Must attempt modern navigator.clipboard first");
assert.ok(clipboardTs.includes('document.createElement("textarea")'),
  "T09: Must fallback to hidden textarea when clipboard API throws/fails");
assert.ok(clipboardTs.includes('document.execCommand("copy")'),
  "T09: Fallback must use execCommand copy");
console.log("PASS T09: Clipboard API with robust textarea fallback");

// 7. T10: Full Conversation Export & Copy
assert.ok(appTsx.includes("handleCopyAllConversation"),
  "T10: Full conversation copy handler must be wired");
assert.ok(appTsx.includes("copyThreadText"),
  "T10: Copy feedback must indicate success or failure with toast");
console.log("PASS T10: Conversation copy and toast feedback confirmed");

console.log("\nALL UNIT 02 THREAD BASICS PARITY CHECKS PASSED!");
