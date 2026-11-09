import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);
const hasInboxPersistence =
  appSource.includes("desktop_state_get") &&
  appSource.includes("inboxItems") &&
  appSource.includes("desktop_state_set");

const inboxViewSource = fs.readFileSync(
  new URL("../src/components/InboxView.tsx", import.meta.url),
  "utf8"
);
const hasInboxFiltering =
  inboxViewSource.includes("onSelectNotification") &&
  inboxViewSource.includes("onMarkAllRead") &&
  inboxViewSource.includes('"unread"');

assert.ok(
  hasInboxPersistence,
  "App.tsx must persist inboxItems using desktop_state_get / desktop_state_set"
);
assert.ok(
  hasInboxFiltering,
  "InboxView.tsx must support notification selection and unread filtering"
);
console.log("PASS independent Inbox history persistence and filtering contract");
