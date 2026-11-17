import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync("src/components/ComposerBox.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flatten = node => !node || typeof node !== "object" ? [] : [node, ...(node.children ?? []).flatMap(flatten)];
function fixture(overrides = {}) {
  let cursor = 0, dirty = true, tree, attachInput = true;
  const slots = [], effects = [], registrations = [], releases = [];
  const input = { isConnected: true, readOnly: false, disabled: false, inert: false, style: {}, scrollHeight: 32,
    getBoundingClientRect: () => ({ width: 400 }), focus() {} };
  const noop = () => {};
  const register = value => { registrations.push(value); const id = registrations.length;
    let released = false; return () => { assert.equal(released, false, "each lease releases once"); released = true; releases.push(id); }; };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useMemo(compute) { cursor++; return compute(); },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; dirty = true; }]; },
    // Unrelated passive effects (dictation/drop/global keys) are outside this
    // layout-lease fixture. The complete production JSX and all layout effects run.
    useEffect() { cursor++; },
    useLayoutEffect(effect, deps) { const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) effects.push(() => {
        previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
      }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, console, ResizeObserver: class { observe() {} disconnect() {} },
    window: {}, navigator: {}, document: {}, require(name) {
      if (name === "react") return react;
      if (name === "../bridge") return { isTauriRuntime: () => false };
      if (name === "../fsClient") return { baseNameFsPath: value => value.split(/[\\/]/).at(-1) };
      if (name === "./ComposerAutocomplete") return { ComposerAutocomplete: "autocomplete", getAutocompleteItems: () => [] };
      if (name === "../modelCapabilities") return { findModel: () => undefined, getDefaultModel: () => undefined,
        getSupportedEfforts: () => [], getFastServiceTier: () => null, resolveServiceTier: () => null, getModelEligibility: () => ({ available: false }) };
      return new Proxy({}, { get: (_, key) => String(key) });
    } });
  let props = { dictationSessionKey: "home", attachmentScopeKey: "fixture-account:home", composerEnterBehavior: "enter", variant: "home",
    promptInput: "", onPromptInputChange: noop, onSendMessage: noop, onQueueMessage: noop, isStreaming: false,
    workspaces: [], activeWorkspace: null, onSelectWorkspace: noop, onPickNewFolder: noop, gitStatus: null, gitBranches: [],
    onSwitchBranch: noop, onCreateBranch: noop, useWorktree: false, onSetUseWorktree: noop, permissionMode: "custom", onSelectPermissionMode: noop,
    models: [], selectedModelId: "", defaultModelSelected: true, onSelectModel: noop, reasoningEffort: "", onSelectReasoningEffort: noop,
    fastMode: false, onToggleFastMode: noop, planMode: false, onTogglePlanMode: noop, attachedFiles: [], onAttachFiles: noop,
    onAddAttachedFiles: noop, onRemoveAttachedFile: noop, workspaceFiles: [], workspaceFileHits: [], skills: [], registerAppshotInput: register, ...overrides };
  const render = () => {
    for (let guard = 0; dirty; guard++) {
      assert.ok(guard < 30); dirty = false; cursor = 0;
      effects.length = 0; // Only the final render's layout effects are committed.
      tree = module.exports.ComposerBox(props);
    }
    return tree;
  };
  const commit = () => {
    render();
    for (const node of flatten(tree)) if (node.props.ref) {
      const value = node.type === "textarea" ? attachInput ? input : null : { getBoundingClientRect: () => ({ width: 400 }), style: {} };
      if (node.type === "textarea") input.readOnly = !!node.props.readOnly;
      if (typeof node.props.ref === "function") node.props.ref(value); else node.props.ref.current = value;
    }
    effects.splice(0).forEach(effect => effect());
  };
  return { input, registrations, releases, render, commit,
    update(patch) { props = { ...props, ...patch }; dirty = true; commit(); },
    setInputAttached(value) { attachInput = value; },
    unmount() { input.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}

const mounted = fixture(); mounted.render(); assert.equal(mounted.registrations.length, 0, "render alone must not publish a handler");
mounted.commit(); assert.equal(mounted.registrations.length, 1, "actual mounted attachment-capable textarea publishes a lease");
assert.equal(mounted.registrations[0], mounted.input, "registrar receives the actual production textarea ref");
for (let i = 0; i < 3; i++) mounted.update({ onAddAttachedFiles: () => {}, promptInput: String(i) });
assert.equal(mounted.registrations.length, 1, "inline attachment callback identity must not remount the lease");
mounted.update({ modelsLoading: true, selectionPending: true, submissionDisabled: true, selectionDisabledReason: "model unavailable" });
assert.equal(mounted.registrations.length, 1, "submit/model readiness is not capture interaction readiness");
assert.equal(mounted.releases.length, 0);
mounted.update({ attachmentScopeKey: "fixture-account:thread:actual-id" });
assert.deepEqual(mounted.releases, [1]); assert.equal(mounted.registrations.length, 2, "scope commit replaces the lease even on the same DOM input");
mounted.update({ attachmentScopeKey: "fixture-account:home" });
assert.deepEqual(mounted.releases, [1, 2]); assert.equal(mounted.registrations.length, 3, "ABA scope does not reuse a retired lease");
mounted.update({ onAddAttachedFiles: undefined }); assert.deepEqual(mounted.releases, [1, 2, 3]);
mounted.update({ onAddAttachedFiles: () => {} }); assert.equal(mounted.registrations.length, 4);
mounted.unmount(); assert.deepEqual(mounted.releases, [1, 2, 3, 4]);
const noAttachments = fixture({ onAddAttachedFiles: undefined }); noAttachments.commit(); assert.equal(noAttachments.registrations.length, 0); noAttachments.unmount();
const noRegistrar = fixture({ registerAppshotInput: undefined }); noRegistrar.commit(); assert.equal(noRegistrar.registrations.length, 0); noRegistrar.unmount();
const changedRegistrar = fixture(); changedRegistrar.commit(); let replacementInput, replacementReleased = 0;
changedRegistrar.update({ registerAppshotInput: input => { replacementInput = input; return () => { replacementReleased++; }; } });
assert.deepEqual(changedRegistrar.releases, [1]); assert.equal(replacementInput, changedRegistrar.input);
changedRegistrar.unmount(); assert.equal(replacementReleased, 1, "replaced registrar owns and releases its own lease");
const noInput = fixture(); noInput.setInputAttached(false); noInput.commit(); assert.equal(noInput.registrations.length, 0); noInput.unmount();
const thread = fixture({ variant: "thread", dictationSessionKey: "thread:actual-id", attachmentScopeKey: "fixture-account:thread:actual-id" });
thread.commit(); assert.equal(thread.registrations.length, 1, "thread Composer, including separately mounted in-app views, publishes its actual input");
thread.unmount(); assert.deepEqual(thread.releases, [1]);
const cloud = fixture({ homeCloud: { active: true, busy: true, filterItems: () => [] }, onAddAttachedFiles: undefined });
cloud.commit(); assert.equal(cloud.input.readOnly, true); assert.equal(cloud.registrations.length, 0); cloud.unmount();
const observed = fixture(); observed.commit();
observed.input.disabled = true; observed.input.readOnly = true; observed.input.inert = true; observed.input.isConnected = false;
assert.equal(observed.registrations[0], observed.input, "owner can observe live disabled/readonly/inert/connected changes on the leased DOM element");
assert.equal(observed.releases.length, 0, "the owner observes DOM state; view does not invent interaction readiness"); observed.unmount();
console.log("PASS production Composer textarea layout lease: post-commit registration, actual ref, inline callback stability, scope/ABA replacement, attachment capability removal, unmount release, cloud/no-input exclusion, submit/model independence and live DOM observation handle. VM only; root DOM observer/native/host-setup behavior tested separately.");
