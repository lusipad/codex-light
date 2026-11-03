import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/terminalOutput.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createTerminalOutput } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const size = text => Buffer.byteLength(text, "utf8");
const event = (data, startOffset = 0, generation = "g1", sessionId = "s1") =>
  ({ sessionId, generation, startOffset, endOffset: startOffset + size(data), data });
const snapshot = (replayLog = "", startOffset = 0, generation = "g1", exited = false) =>
  ({ sessionId: "s1", cwd: "repo", shell: "shell", replayLog, generation, startOffset,
    endOffset: startOffset + size(replayLog), exited });
function mount() {
  const writes = [];
  let exits = 0;
  const output = createTerminalOutput("s1", {
    write: (text, replay) => writes.push({ text, replay }),
    onExit: () => exits++,
  });
  return { output, writes, text: () => writes.map(item => item.text).join(""), exits: () => exits };
}

{
  const view = mount();
  view.output.data(event("boot"));
  view.output.data(event("prompt", 4));
  assert.equal(view.text(), "");
  view.output.attach(snapshot("boot"));
  assert.equal(view.text(), "bootprompt");
  assert.deepEqual(view.writes.map(item => item.replay), [true, false]);
  view.output.attach(snapshot("boot"));
  view.output.data(event("prompt", 4));
  assert.equal(view.text(), "bootprompt", "repeated snapshot and events must not replay");
}
{
  const view = mount();
  view.output.attach(snapshot());
  assert.deepEqual(view.writes, [{ text: "", replay: true }], "empty replay completes hydration");
  view.output.data(event("cc", 4));
  view.output.data(event("bb", 2));
  assert.equal(view.text(), "");
  view.output.data(event("aa"));
  assert.equal(view.text(), "aabbcc", "gaps must fill in order");
  view.output.data(event("ccdd", 4));
  assert.equal(view.text(), "aabbccdd", "overlap writes only unseen suffix");
  view.output.data(event("aa", 8));
  assert.equal(view.text(), "aabbccddaa", "equal text at distinct offsets is real output");
}
{
  const view = mount();
  view.output.data(event("old", 0, "old"));
  view.output.exit({ sessionId: "s1", generation: "old", endOffset: 3 });
  view.output.attach(snapshot("new"));
  view.output.data(event("old", 3, "old"));
  view.output.data(event("wrong", 3, "g1", "other"));
  view.output.exit({ sessionId: "other", generation: "g1", endOffset: 3 });
  assert.equal(view.text(), "new");
  assert.equal(view.exits(), 0);
}
{
  const view = mount();
  view.output.exit({ sessionId: "s1", generation: "g1", endOffset: 6 });
  view.output.data(event("end", 3));
  view.output.attach(snapshot());
  assert.equal(view.exits(), 0, "exit waits for missing output");
  view.output.data(event("pre"));
  assert.equal(view.text(), "preend");
  assert.equal(view.exits(), 1);
  view.output.exit({ sessionId: "s1", generation: "g1", endOffset: 6 });
  view.output.data(event("end", 3));
  assert.equal(view.exits(), 1);
  assert.equal(view.text(), "preend");
}
{
  const view = mount();
  const first = "\uFEFF中文😀";
  const tail = "🦀\x1b[31m红\x1b[0m";
  view.output.data(event(first + tail));
  view.output.attach(snapshot(first));
  assert.equal(view.text(), first + tail, "UTF-8 overlap and BOM remain intact");
  assert.equal(view.text().includes("\uFFFD"), false);
}
{
  const view = mount();
  view.output.data(event("past", 0));
  view.output.data(event("keptnext", 100));
  view.output.attach(snapshot("kept", 100));
  assert.equal(view.text(), "keptnext", "bounded replay does not wait for discarded history");
}
{
  const view = mount();
  view.output.attach(snapshot("done", 30, "g1", true));
  assert.equal(view.text(), "done");
  assert.equal(view.exits(), 1, "already exited snapshot delivers exit after replay");
}
{
  const view = mount();
  view.output.data(event("early"));
  view.output.dispose();
  view.output.attach(snapshot("early"));
  view.output.data(event("late", 5));
  view.output.exit({ sessionId: "s1", generation: "g1", endOffset: 9 });
  assert.deepEqual(view.writes, []);
  assert.equal(view.exits(), 0);
  const attached = mount();
  attached.output.attach(snapshot());
  attached.output.data(event("gap", 10));
  attached.output.dispose();
  attached.output.data(event("0123456789"));
  assert.equal(attached.text(), "");
}
{
  const view = mount();
  view.output.attach(snapshot());
  view.output.data({ ...event("bad"), endOffset: 99 });
  view.output.data(event("ok"));
  assert.equal(view.text(), "ok", "invalid byte accounting must not advance watermark");
}
{
  const chunks = ["A", "中文", "😀", "\x1b[0m", "tail"];
  let cursor = 0;
  const events = chunks.map(chunk => {
    const result = event(chunk, cursor);
    cursor = result.endOffset;
    return result;
  });
  function permutations(items) {
    if (!items.length) return [[]];
    return items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index))
      .map(rest => [item, ...rest]));
  }
  for (const ordering of permutations(events)) {
    const view = mount();
    view.output.exit({ sessionId: "s1", generation: "g1", endOffset: cursor });
    view.output.data(ordering[0]);
    view.output.attach(snapshot("A中文"));
    for (const item of ordering.slice(1)) {
      view.output.data(item);
      view.output.data(item);
    }
    assert.equal(view.text(), chunks.join(""), "all 120 delivery permutations preserve byte stream");
    assert.equal(view.exits(), 1);
  }
}
console.log("terminal output: production merge replay, byte offsets, ordering, generation, exit and disposal passed");
console.log("Scope: deterministic production controller; not a native PTY or official UI comparison.");
if (process.argv[2]) {
  const log = fs.readFileSync(process.argv[2], "utf8");
  const captures = [...log.matchAll(/TO(?:01|03|06)[^\r\n]*real PTY events: (\[\[.*\]\])/g)];
  assert.ok(captures.length >= 3, "require real PTY fast-exit, attach and generation captures");
  for (const [, json] of captures) {
    const events = JSON.parse(json);
    const generation = events.at(-1)[1].generation;
    const sessionId = events.at(-1)[1].sessionId;
    const data = events.filter(([name, payload]) => name === "terminal:data" && payload.generation === generation);
    const expected = data.map(([, payload]) => payload.data).join("");
    // Use actual captured boundaries as potential attach points; deliver the
    // same real stream reversed and duplicated around each snapshot.
    for (let cut = 0; cut <= data.length; cut++) {
      let actual = "", exits = 0;
      const output = createTerminalOutput(sessionId, {
        write: text => { actual += text; }, onExit: () => { exits++; },
      });
      for (const [name, payload] of [...events].reverse()) {
        if (name === "terminal:data") output.data(payload);
        else output.exit(payload);
      }
      const replayLog = data.slice(0, cut).map(([, payload]) => payload.data).join("");
      output.attach({ sessionId, generation, replayLog, startOffset: 0, endOffset: size(replayLog), exited: false });
      for (const [name, payload] of events) {
        if (name === "terminal:data") output.data(payload);
        else output.exit(payload);
      }
      assert.equal(actual, expected, "captured Rust UTF-8 offsets merge through the production frontend");
      assert.equal(exits, 1);
    }
  }
  console.log(`PASS ${captures.length} real Windows PTY captures replayed through production frontend at every captured attach boundary`);
}
