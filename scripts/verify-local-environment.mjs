import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyLocalEnvironmentsUI } from "./verify-local-environments-ui-b.mjs";

// The former raw-editor assertions now run through the real structured component/client.
await verifyLocalEnvironmentsUI();
const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(parent.includes("<LocalEnvironmentSettings"));
assert.ok(parent.includes("projects={environmentProjects}"));
assert.ok(parent.includes("onNavigationGuardChange={registerEnvironmentNavigationGuard}"));
assert.ok(!parent.includes("setLocalEnvToml"));
assert.ok(parent.includes('activeSection !== "local-environments" &&'));
assert.ok(app.includes('if (pendingTermCommand) throw Error'));
assert.ok(app.includes("setPendingTermCommand({ id: Date.now(), command, cwd });"));
console.log("PASS LE02/LE03/LE04: structured editor retains conflict/dirty/action/unmount invariants and registered-project real PTY queue wiring");
