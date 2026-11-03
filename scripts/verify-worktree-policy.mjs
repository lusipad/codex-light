import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";

const fixturePath = "scripts/fixtures/worktree-policy.json";
const sourceDir = ".ref/parity/16.15/actual/16-15B-research";
const sourceFile = "early-bootstrap-339-096ec1020e8592e0.js";
const sourceSha256 = "25c8371f76e580829e8f387446901c5f09227fc645a0bce6efbfaaee2946ebc8";
const generate = process.argv.includes("--generate");
const requireReference = generate || process.argv.includes("--reference");
const plain = value => JSON.parse(JSON.stringify(value));
let official;
if (fs.existsSync(`${sourceDir}/raw/${sourceFile}`)) {
  const raw = fs.readFileSync(`${sourceDir}/raw/${sourceFile}`);
  assert.equal(createHash("sha256").update(raw).digest("hex"), sourceSha256);
  const anchor = JSON.parse(fs.readFileSync(`${sourceDir}/anchors.json`, "utf8"))
    .find(item => item.id === "candidate-planner");
  assert.equal(raw.toString("utf8").slice(anchor.start, anchor.end), anchor.excerpt);
  // Execute the unchanged, isolated official pure function; no imports, host
  // process, network or filesystem APIs are exposed in its VM.
  official = vm.runInNewContext(`${anchor.excerpt}; lX`, {}, { timeout: 1000 });
} else if (requireReference) {
  throw Error("Missing frozen official reference; restore its ignored evidence files");
}

const now = Date.parse("2026-11-03T00:00:00.000Z");
const migration = Date.parse("2026-02-21T00:00:00.000Z");
const record = (path, createdAtMs = now - 7_200_000, ownerThreadId = null) => ({ path, ownerThreadId, createdAtMs });
const numbered = (count, owner = false) => Array.from({ length: count }, (_, index) =>
  record(`C:/worktree/${String(index).padStart(2, "0")}`, now - (count - index) * 7_200_000, owner ? `thread-${index}` : null));
const base = { keepCount: 1, threadMetadataById: {}, pinnedThreadIds: [], protectedWorktreeDirs: [], nowMs: now, protectPreMigrationOwnerlessWorktrees: false };
const cases = [];
function add(id, records, extra = {}) { cases.push({ id, input: { ...base, records, ...extra } }); }
add("WB03-empty", []);
add("WB03-total-at-limit", numbered(3), { keepCount: 3 });
add("WB03-all-protected", numbered(5), { protectedWorktreeDirs: numbered(5).map(item => item.path) });
add("WB03-total20-protected10-keep15", numbered(20), { keepCount: 15, protectedWorktreeDirs: numbered(10).map(item => item.path) });
add("WB03-eligible20-protected5-keep15", numbered(25), { keepCount: 15, protectedWorktreeDirs: numbered(5).map(item => item.path) });
add("WB03-no20-deletion-cap", numbered(50), { keepCount: 2 });
add("WB03-ownerless-before-owned", [record("C:/owned", 0, "a"), record("C:/unknown-time", null), record("C:/old", 1), record("C:/recent", now - 3_600_001)], { threadMetadataById: { a: { updatedAtMs: -100, isInProgress: false } } });
add("WB03-missing-owned-metadata", [record("C:/z", 1, "z"), record("C:/a", 1, "a"), record("C:/b", 1, "b"), record("C:/c", 1, "c")], { threadMetadataById: { a: null, b: { updatedAtMs: null, isInProgress: false }, c: { updatedAtMs: 1, isInProgress: false } } });
add("WB03-locale-nonascii-and-canonical-stability", ["中", "张", "阿", "é", "e\u0301", "e", "E", "a-2", "a_1", "😀", "2", "10"].map(path => record(`C:/${path}`, 1)));
add("WB03-owned-locale-tie", ["中", "阿", "é", "a", "A"].map(path => record(`C:/${path}`, 1, path)));
add("WB03-path-protection-covers-duplicate-record", [record("C:/same", 0, "pin"), record("C:/same", 0), record("C:/free", 0)], { pinnedThreadIds: ["pin"] });
add("WB04-newborn-one-ms-before-hour", [record("C:/newborn", now - 3_600_000 + 1), record("C:/old", 0), record("C:/older", -1)]);
add("WB04-newborn-exact-hour", [record("C:/hour", now - 3_600_000), record("C:/old", 0)]);
add("WB04-newborn-one-ms-after-hour", [record("C:/hour", now - 3_600_001), record("C:/old", 0)]);
add("WB04-future-protected", [record("C:/future", now + 1), record("C:/old", 0), record("C:/older", -1)]);
add("WB04-unknown-birth-not-protected", [record("C:/unknown", null), record("C:/old", 0)]);
add("WB04-owned-recent-birth-not-newborn-protected", [record("C:/owned", now + 1, "a"), record("C:/old", 0)]);
add("WB04-migration-before-at-after", [record("C:/before", migration - 1), record("C:/at", migration), record("C:/after", migration + 1)], { protectPreMigrationOwnerlessWorktrees: true });
add("WB04-migration-protection-disabled", [record("C:/before", migration - 1), record("C:/at", migration)], { protectPreMigrationOwnerlessWorktrees: false });
add("WB04-owned-not-migration-protected", [record("C:/owned", migration - 1, "a"), record("C:/old", 0)], { protectPreMigrationOwnerlessWorktrees: true });
add("WB04-pinned-and-active", numbered(5, true), { pinnedThreadIds: ["thread-0"], threadMetadataById: { "thread-1": { updatedAtMs: 0, isInProgress: true } } });
add("WB04-null-vs-max-safe-stable-sort", [record("C:/z", null), record("C:/a", Number.MAX_SAFE_INTEGER), record("C:/old", 0)], { nowMs: Number.MAX_SAFE_INTEGER + 7_200_000 });
// Five-day migration grace is determined by the host, not this pure function.
// Identical input on either side changes only when the host changes the flag.
add("WB04-five-day-host-flag-before-boundary", [record("C:/pre", migration - 1), record("C:/post", migration + 1)], { protectPreMigrationOwnerlessWorktrees: true });
add("WB04-five-day-host-flag-at-boundary", [record("C:/pre", migration - 1), record("C:/post", migration + 1)], { protectPreMigrationOwnerlessWorktrees: false });

function reference(input) {
  const mapped = { ...input, records: input.records.map(({ path, ...item }) => ({ ...item, worktree: { dir: path } })) };
  const candidates = official(mapped).candidates.map(({ worktree, ...item }) => ({ path: worktree.dir, ...item }));
  const eligibleCount = official({ ...mapped, keepCount: 0 }).candidates.length;
  return plain({ candidates, eligibleCount });
}
if (generate) {
  fs.writeFileSync(fixturePath, `${JSON.stringify({
    sourceFile, sourceSha256, locale: new Intl.Collator().resolvedOptions().locale,
    note: "Unchanged official pure function in isolated Node VM; localeCompare fixtures depend on the recorded ICU locale. Five-day host grace is outside planner.",
    cases: cases.map(item => ({ ...item, expected: reference(item.input) })),
  }, null, 2)}\n`);
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.equal(fixture.sourceSha256, sourceSha256);
const compiled = ts.transpileModule(fs.readFileSync("src/worktreePolicy.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });
const localeMatches = fixture.locale === new Intl.Collator().resolvedOptions().locale;
for (const item of fixture.cases) {
  const before = JSON.stringify(item.input);
  const rawResult = exports.planWorktreeCleanup(item.input);
  assert.ok(rawResult.candidates.every(candidate => item.input.records.includes(candidate)), `${item.id}: preserve original records`);
  const result = plain(rawResult);
  if (official) assert.deepEqual(result, reference(item.input), `${item.id}: current official VM`);
  if (localeMatches) assert.deepEqual(result, item.expected, `${item.id}: frozen golden fixture`);
  assert.equal(JSON.stringify(item.input), before, `${item.id}: must not mutate input`);
  for (const candidate of result.candidates) {
    assert.ok(!item.input.protectedWorktreeDirs.includes(candidate.path));
  }
}
assert.ok(localeMatches || official, "Fixture locale differs; official reference is required to verify current localeCompare");
if (official) {
  let seed = 0x1615b;
  const random = bound => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound; };
  for (let iteration = 0; iteration < 300; iteration++) {
    const records = Array.from({ length: random(50) }, (_, index) => record(
      `C:/${["中", "阿", "e\u0301", "é", "a", "A", "_"][random(7)]}/${random(12)}`,
      [null, now + 1, now - 3_599_999, now - 3_600_000, migration - 1, migration, 0][random(7)],
      [null, "owner-0", "owner-1", "owner-2"][random(4)],
    ));
    const input = {
      ...base, records, keepCount: 1 + random(20),
      protectPreMigrationOwnerlessWorktrees: random(2) === 1,
      protectedWorktreeDirs: records.filter(() => random(8) === 0).map(item => item.path),
      pinnedThreadIds: ["owner-0", "owner-1"].filter(() => random(4) === 0),
      threadMetadataById: Object.fromEntries(["owner-0", "owner-1", "owner-2"].map(owner => [owner,
        random(4) === 0 ? null : { updatedAtMs: [null, 0, 1, -1, now][random(5)], isInProgress: random(5) === 0 },
      ])),
    };
    assert.deepEqual(plain(exports.planWorktreeCleanup(input)), reference(input), `seeded official differential ${iteration}`);
  }
}
console.log(`PASS WB03/WB04: ${fixture.cases.length} production planner cases; ${official ? "unchanged official VM + 300 fixed-seed differential cases" : "frozen golden fixtures only (reference unavailable)"}; locale=${fixture.locale}; no filesystem deletion`);
