import assert from "node:assert/strict";
import { mount } from "./verify-sidebar-projects.mjs";

const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function scenario({ createFails = false, moveFails = false, deferCreate = false } = {}) {
  const requests = [], notices = [], refreshed = [];
  let resolveCreate;
  const view = mount({
    threads: [{ id: "a1", name: "Alpha thread", cwd: "D:/parity/alpha" }],
    onThreadsChanged: () => refreshed.push(true),
    onShowToast: (...notice) => notices.push(notice),
  }, new Map(), false, {
    listSections: async () => [{ id: "s-a", name: "Section A" }],
    createSection: async name => {
      requests.push(["create", name]);
      if (createFails) throw new Error("test create rejected");
      if (deferCreate) {
        await new Promise(resolve => { resolveCreate = resolve; });
      }
      return { id: "s-new", name };
    },
    moveThreadToSection: async (threadId, sectionId) => {
      requests.push(["move", threadId, sectionId]);
      if (moveFails) throw new Error("test move rejected");
    },
  });
  view.render();
  await flush();
  const menu = () => all(view.render()).find(node => node.props.role === "menu" && node.props["aria-label"] === "会话操作");
  const sectionSubmenu = () => all(view.render()).find(node => node.props.role === "menu" && node.props["aria-label"] === "分区");
  const open = () => {
    const row = all(view.render()).find(node => node.props["data-thread-id"] === "a1");
    row.props.onContextMenu({
      currentTarget: view.element(row), target: view.element(row), clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    const move = all(menu()).find(node => node.type === "button" && text(node).includes("移至分区"));
    assert.equal(move.props["aria-haspopup"], "menu", "section destinations use a nested menu");
    move.props.onClick({ stopPropagation() {} });
    const submenu = sectionSubmenu();
    assert.ok(submenu, "the section submenu is rendered as its own menu surface");
    assert.equal(text(menu()).includes("新建分区…"), false, "the flyout is not nested in the scrollable root menu");
    return all(submenu).find(node => node.type === "button" && text(node).includes("新建分区…"));
  };
  const start = () => {
    const create = open();
    assert.ok(create, "session section submenu must expose the official New section… action");
    create.props.onClick();
    return view.render();
  };
  const dialog = () => all(view.render()).find(node => node.type === "dialog" && node.props["aria-label"] === "新建分区");
  return { view, menu, start, dialog, requests, notices, refreshed, completeCreate: () => resolveCreate?.() };
}

const keyboardFlyout = await scenario();
const keyboardRow = all(keyboardFlyout.view.render()).find(node => node.props["data-thread-id"] === "a1");
keyboardRow.props.onContextMenu({
  currentTarget: keyboardFlyout.view.element(keyboardRow), target: keyboardFlyout.view.element(keyboardRow),
  clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {},
});
const keyboardRoot = keyboardFlyout.menu();
const keyboardMove = all(keyboardRoot).find(node => node.props["data-thread-section-trigger"] !== undefined);
keyboardFlyout.view.element(keyboardMove).focus();
keyboardRoot.props.onKeyDown({
  key: "ArrowRight", target: keyboardFlyout.view.element(keyboardMove),
  currentTarget: keyboardFlyout.view.element(keyboardRoot), nativeEvent: {},
  preventDefault() {}, stopPropagation() {},
});
const openedFlyout = keyboardFlyout.view.render();
const keyboardSubmenu = all(openedFlyout).find(node => node.props.role === "menu" && node.props["aria-label"] === "分区");
assert.ok(keyboardSubmenu, "ArrowRight opens the nested section menu");
assert.equal(text(keyboardFlyout.menu()).includes("新建分区…"), false, "the nested menu remains separate from the root menu");
assert.equal(keyboardFlyout.view.document.activeElement,
  keyboardFlyout.view.element(all(keyboardSubmenu).find(node => node.type === "button")),
  "opening the submenu from the keyboard moves focus to its first action");
keyboardSubmenu.props.onKeyDown({
  key: "ArrowLeft", target: keyboardFlyout.view.document.activeElement,
  currentTarget: keyboardFlyout.view.element(keyboardSubmenu), nativeEvent: {},
  preventDefault() {}, stopPropagation() {},
});
assert.equal(all(keyboardFlyout.view.render()).some(node => node.props.role === "menu" && node.props["aria-label"] === "分区"), false,
  "ArrowLeft closes only the nested menu");
assert.equal(keyboardFlyout.view.document.activeElement, keyboardFlyout.view.element(keyboardMove),
  "closing the submenu returns focus to its parent action");
keyboardMove.props.onPointerEnter({ pointerType: "mouse" });
const openBeforeArrowDown = keyboardFlyout.view.render();
const openBeforeArrowDownRoot = keyboardFlyout.menu();
openBeforeArrowDownRoot.props.onKeyDown({
  key: "ArrowDown", target: keyboardFlyout.view.element(keyboardMove),
  currentTarget: keyboardFlyout.view.element(openBeforeArrowDownRoot), nativeEvent: {},
  preventDefault() {}, stopPropagation() {},
});
const afterArrowDown = keyboardFlyout.view.render();
assert.equal(all(afterArrowDown).some(node => node.props.role === "menu" && node.props["aria-label"] === "分区"), false,
  "moving root-menu keyboard focus away from the submenu trigger closes its flyout");
assert.equal(keyboardFlyout.view.document.activeElement,
  keyboardFlyout.view.element(all(afterArrowDown).find(node => node.type === "button" && text(node).includes("归档"))),
  "root-menu ArrowDown moves focus to the next action while closing the flyout");
keyboardMove.props.onPointerEnter({ pointerType: "touch" });
assert.equal(all(keyboardFlyout.view.render()).some(node => node.props.role === "menu" && node.props["aria-label"] === "分区"), false,
  "touch pointer entry does not open a hover submenu");
keyboardMove.props.onPointerEnter({ pointerType: "mouse" });
assert.ok(all(keyboardFlyout.view.render()).some(node => node.props.role === "menu" && node.props["aria-label"] === "分区"),
  "mouse hover opens the nested section menu");
const archiveHover = all(keyboardFlyout.view.render()).find(node =>
  node.type === "button" && node.props.role === "menuitem" && text(node).includes("归档"));
archiveHover.props.onPointerEnter({ pointerType: "mouse" });
assert.equal(all(keyboardFlyout.view.render()).some(node => node.props.role === "menu" && node.props["aria-label"] === "分区"), false,
  "hovering another root action closes the open section submenu");
keyboardFlyout.view.unmount();

const success = await scenario();
success.start();
const successDialog = success.dialog();
assert.ok(successDialog);
assert.equal(success.view.element(successDialog).open, true, "creating from the menu opens a native modal dialog");
assert.match(text(successDialog), /新建分区随心整理聊天和项目取消创建分区/);
const input = all(successDialog).find(node => node.type === "input");
assert.equal(input.props["aria-label"], "分区名称");
assert.equal(input.props.placeholder, "分区名称");
const form = all(successDialog).find(node => node.type === "form");
let submitted = false;
form.props.onSubmit({
  preventDefault() { submitted = true; },
  nativeEvent: {},
});
assert.equal(submitted, true);
await flush();
assert.deepEqual(success.requests, [["create", "新建分区"], ["move", "a1", "s-new"]], "blank input uses the official default and adds the originating thread");
assert.equal(success.dialog(), undefined, "successful create and move close the dialog");
assert.equal(success.view.document.activeElement, success.view.element(all(success.view.render()).find(node => node.props["data-thread-id"] === "a1")),
  "successful dialog close restores focus to the originating thread row");
assert.equal(success.refreshed.length, 1);
assert.deepEqual(success.notices, [["已移动到分区「新建分区」", "info"]]);
success.view.unmount();

const trimmed = await scenario();
trimmed.start();
let nameInput = all(trimmed.dialog()).find(node => node.type === "input");
nameInput.props.onChange({ target: { value: "  Work  " } });
const submit = all(trimmed.dialog()).find(node => node.type === "form");
submit.props.onSubmit({ preventDefault() {}, nativeEvent: {} });
await flush();
assert.deepEqual(trimmed.requests, [["create", "Work"], ["move", "a1", "s-new"]]);
trimmed.view.unmount();

const cancelled = await scenario();
cancelled.start();
const cancel = all(cancelled.dialog()).find(node => node.type === "button" && text(node) === "取消");
cancel.props.onClick();
cancelled.view.render();
assert.equal(cancelled.dialog(), undefined);
assert.equal(cancelled.view.document.activeElement,
  cancelled.view.element(all(cancelled.view.render()).find(node => node.props["data-thread-id"] === "a1")),
  "Cancel restores focus to the originating thread row");
assert.deepEqual(cancelled.requests, [], "cancel does not mutate sections or thread membership");
cancelled.view.unmount();

const escapeCancelled = await scenario();
escapeCancelled.start();
const escapeDialog = escapeCancelled.dialog();
escapeDialog.props.onCancel({ preventDefault() {} });
escapeCancelled.view.render();
assert.equal(escapeCancelled.dialog(), undefined);
assert.equal(escapeCancelled.view.document.activeElement,
  escapeCancelled.view.element(all(escapeCancelled.view.render()).find(node => node.props["data-thread-id"] === "a1")),
  "Escape restores focus to the originating thread row");
assert.deepEqual(escapeCancelled.requests, [], "Escape does not mutate sections or thread membership");
escapeCancelled.view.unmount();

const rejectedCreate = await scenario({ createFails: true });
rejectedCreate.start();
all(rejectedCreate.dialog()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: {} });
await flush();
assert.ok(rejectedCreate.dialog(), "create failure leaves the dialog open for retry");
assert.deepEqual(rejectedCreate.requests, [["create", "新建分区"]]);
assert.deepEqual(rejectedCreate.notices, [["创建分区失败：test create rejected", "error"]]);
rejectedCreate.view.unmount();

const rejectedMove = await scenario({ moveFails: true });
rejectedMove.start();
all(rejectedMove.dialog()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: {} });
await flush();
assert.equal(rejectedMove.dialog(), undefined, "partial failure closes the dialog to prevent duplicate section creation");
assert.deepEqual(rejectedMove.requests, [["create", "新建分区"], ["move", "a1", "s-new"]]);
assert.deepEqual(rejectedMove.notices, [["已创建分区「新建分区」，但移动聊天失败：test move rejected", "error"]]);
assert.equal(rejectedMove.refreshed.length, 1);
rejectedMove.view.unmount();

const pending = await scenario({ deferCreate: true });
pending.start();
const pendingForm = all(pending.dialog()).find(node => node.type === "form");
pendingForm.props.onSubmit({ preventDefault() {}, nativeEvent: {} });
let pendingDialog = pending.dialog();
assert.equal(all(pendingDialog).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
all(pendingDialog).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: {} });
assert.deepEqual(pending.requests, [["create", "新建分区"]], "repeated submit while pending cannot create duplicate sections");
pending.completeCreate();
await flush();
assert.deepEqual(pending.requests, [["create", "新建分区"], ["move", "a1", "s-new"]]);
assert.equal(pending.dialog(), undefined);
pending.view.unmount();
console.log("PASS actual sidebar section-create dialog/menu + RPC contract: default/trim, cancel/Escape, create/move success and failure, pending duplicate guard (L2)");
