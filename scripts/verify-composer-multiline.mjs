import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("ComposerBox.tsx", fs.readFileSync("src/components/ComposerBox.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect" &&
      node.arguments[0]?.getText(ast).includes("scrollHeight")) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect, "multiline input needs real content-driven resizing, max-height alone does not grow a textarea");
const code = ts.transpileModule(`(${effect.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let observed, disconnected = 0, resized, reads = 0, width = 640, naturalHeight = 136;
const textarea = {
  style: {},
  get scrollHeight() { assert.equal(this.style.height, "auto"); reads++; return naturalHeight; },
  getBoundingClientRect: () => ({ width }),
};
const run = input => vm.runInNewContext(code, {
  actualTextareaRef: { current: input },
  ResizeObserver: class {
    constructor(callback) { resized = callback; }
    observe(element) { observed = element; }
    disconnect() { disconnected++; }
  },
})();
const cleanup = run(textarea);
assert.equal(textarea.style.height, "136px");
assert.equal(observed, textarea);
resized();
assert.equal(reads, 1, "height-only observer events must not trigger a resize loop");
width = 320; naturalHeight = 256; resized();
assert.equal(textarea.style.height, "256px");
cleanup();
assert.equal(disconnected, 1);
naturalHeight = 40;
run(textarea)();
assert.equal(textarea.style.height, "40px", "shorter input must shrink before CSS min-height is applied");
assert.equal(run(null), undefined);
console.log("PASS production Composer multiline layout: grow/shrink, width-only resize and observer cleanup (CM01-CM03, L2; actual CSS clamp verified separately)");
