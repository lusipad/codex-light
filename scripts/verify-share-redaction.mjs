import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareRedaction.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, TextEncoder });
const { redactShareSnapshot, serializeRedactedShareSnapshot, SHARE_SNAPSHOT_MAX_BYTES } = exports;
const redact = text => redactShareSnapshot(text);
const token = "AbCdEfGh1234567890xy";
const repeated = (length, alphabet = "AbCdEfGh1234567890") => alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);
const hex = length => repeated(length, "a1b2c3d4e5f6");
const serviceSamples = [
  `AKIA${repeated(16, "ABCD2345")}`, `A3TZ${repeated(16, "ABCD2345")}`,
  `AIza${repeated(30)}`, `github_pat_${repeated(30)}`, `ghp_${token}`,
  `glpat-${token}`, `gldt-${token}`, `glptt-${hex(40)}`, `glrt-${token}`,
  `xoxb-${token}`, `xapp-1-ABCD1234-12-${token}`, `xoxe.xoxb-1-${repeated(163, "ABCD1234")}`,
  `xoxe-1-${repeated(146, "ABCD1234")}`, `sk_test_${token}`, `rk_live_${token}`,
  `SG.${repeated(66)}`, `${hex(32)}-us12`, `hf_${token}`, `api_org_${repeated(34, "AbCdEfGh")}`,
  `pypi-${token}`, `npm_${token}`, `sk-proj-${token}`, `sk-svcacct-${token}`, `sk-admin-${token}`,
  `sk-${repeated(20)}T3BlbkFJ${repeated(20)}`, "A3-AB12CD-AB12CD12345-AB123-CD456-EF789",
  `ops_eyJ${repeated(250)}`, `AGE-SECRET-KEY-1${repeated(58, "QPZRY9X8")}`,
  `pat${repeated(14)}.${hex(64)}`, `LTAI${token}`, `sk-ant-api03-${repeated(93)}AA`,
  `AKCp${repeated(69)}`, `cmVmd${repeated(59)}`, `ABSK${repeated(109)}`,
  `AbC1Q~${repeated(31)}`, `v1.0-${hex(24)}-${hex(146)}`, `dapi${hex(32)}`,
  `doo_v1_${hex(64)}`, `dop_v1_${hex(64)}`, `dor_v1_${hex(64)}`,
  `dp.pt.${repeated(43, "abcd1234")}`, `dt0c01.${hex(24)}.${hex(64)}`,
  `EZAK${hex(54)}`, `EZTK${hex(54)}`, `EAAM${repeated(100)}`,
  `fo1_${repeated(43)}`, `fm1a_${repeated(100)}`, `fm1r_${repeated(100)}`, `fm2_${repeated(100)}`,
  `glc_${repeated(32)}`, `glsa_${repeated(32)}_${hex(8)}`,
  `${repeated(14)}.atlasv1.${repeated(60)}`, `HRKU-AA${repeated(58)}`,
  `lin_api_${hex(40)}`, `pk.${hex(60)}.${hex(22)}`, `${repeated(6)}_${repeated(29)}_mmk`,
  `NRJS-${hex(19)}`, `NRII-${hex(32)}`, `NRAK-${hex(27)}`,
  `ntn_12345678901${repeated(35)}`, `sha256~${repeated(43)}`, `pplx-${repeated(48)}`,
  `pscale_tkn_${repeated(32)}`, `PMAK-${hex(24)}-${hex(34)}`, `pnu_${repeated(36)}`,
  `pul-${hex(40)}`, `rubygems_${hex(48)}`, `sntryu_${hex(64)}`,
  `sntrys_eyJpYXQiO${repeated(10)}LCJyZWdpb25fdXJs${repeated(10)}_${repeated(43)}`,
  `shpat_${hex(32)}`, `EAAA${repeated(22)}`, `sq0atp-${repeated(22)}`,
  `SK${hex(32)}`, `hvb.${repeated(138)}`, `hvs.${repeated(90)}`,
];
for (const sample of serviceSamples) assert.equal(redact(sample).redactedSnapshot, "<SECRET>", sample.slice(0, 20));
const tests = [
  [`ghp_${token}`, "<SECRET>"],
  [`API_KEY="${token}"`, 'API_KEY="<SECRET>"'],
  [`PASSWORD=Ab12Cd34`, "PASSWORD=<SECRET>"],
  [`Authorization: Bearer ${token}`, "Authorization: Bearer <SECRET>"],
  [`postgres://user:Ab12Cd34@db.invalid/db`, "<SECRET>"],
  [`https://test.invalid/a?token=x`, "<SECRET>"],
  [`-----BEGIN PRIVATE KEY-----\n${token}\n-----END PRIVATE KEY-----`, "<SECRET>"],
  ["PASSWORD=changeme12345678", "PASSWORD=changeme12345678"],
  ["TOKEN=11111111111111111111", "TOKEN=11111111111111111111"],
  ["TOKEN=12345678901234567890", "TOKEN=12345678901234567890"],
  ["API_KEY=process.env.API_KEY", "API_KEY=process.env.API_KEY"],
  [`API_KEY=https://a.invalid/${token}`, `API_KEY=https://a.invalid/${token}`],
  [`data:image/png;base64,ghp_${token}`, `data:image/png;base64,ghp_${token}`],
];
for (const [input, expected] of tests) assert.equal(redact(input).redactedSnapshot, expected);
const overlap = redact(`TOKEN=ghp_${token}`);
assert.equal(overlap.redactedSnapshot, "TOKEN=<SECRET>");
assert.equal(overlap.findingCount, 1, "overlapping findings are counted once");
const adjacent = redact(`https://a.invalid?token=xhttps://b.invalid?sig=y`);
assert.equal(adjacent.findingCount, 1);
const key = `ghp_${token}`;
const input = { [key]: [null, 3, { value: key }], title: key };
const result = redactShareSnapshot(input);
assert.ok(Object.hasOwn(result.redactedSnapshot, key));
assert.equal(result.redactedSnapshot[key][2].value, "<SECRET>");
assert.equal(result.findingCount, 2);
assert.equal(input[key][2].value, key, "input remains unchanged");
const serialized = serializeRedactedShareSnapshot({ text: `ghp_${token}` });
assert.equal(serialized.json, '{"text":"<SECRET>"}');
assert.equal(serialized.byteLength, new TextEncoder().encode(serialized.json).length);
assert.throws(() => serializeRedactedShareSnapshot("中".repeat(SHARE_SNAPSHOT_MAX_BYTES / 3)), /10 MiB/);
// The shortest accepted password is eight characters, matching <SECRET>'s size.
const overhead = JSON.stringify({ text: "PASSWORD=Ab12Cd34", padding: "" }).length;
const expansion = { text: "PASSWORD=Ab12Cd34", padding: " ".repeat(SHARE_SNAPSHOT_MAX_BYTES - overhead) };
assert.equal(serializeRedactedShareSnapshot(expansion).byteLength, SHARE_SNAPSHOT_MAX_BYTES);
assert.equal(serializeRedactedShareSnapshot({ text: " ".repeat(SHARE_SNAPSHOT_MAX_BYTES - 11) }).byteLength, SHARE_SNAPSHOT_MAX_BYTES);
if (process.argv.includes("--reference")) {
  const source = fs.readFileSync(".ref/scratch/files/app-primary-84ad97f06929.js", "utf8");
  const referenceHash = crypto.createHash("sha256").update(source).digest("hex");
  assert.equal(referenceHash, "bff0e66840e6f3538efe435aceddbf9f6ce8b252e713669ff51019ee2dd5fe8f", "reference version changed; re-investigate rules before comparing");
  console.log(`Reference app-primary SHA-256: ${referenceHash}`);
  const start = source.indexOf("function XI(e,...t)");
  const end = source.indexOf("function pUe(", start);
  assert.ok(start >= 0 && end > start);
  // Evaluate only the isolated pure redactor, never the application or imports.
  const context = vm.createContext({ e: initializer => initializer });
  vm.runInContext(source.slice(start, end) + ";rL();", context);
  const reference = value => context.XHe(value);
  const cases = [...serviceSamples, ...tests.map(([text]) => text), ...[
    `TOKEN=ghp_${token}`, "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    "https://test.invalid/path?X-Amz-Security-Token=abc", "TOKEN='redacted-value'",
    "DATABASE_PASSWORD=Ab12Cd34", "TOKEN=abcdabcdabcdabcd", "PASSWORD=12345678",
    `-----BEGIN RSA PRIVATE KEY-----\n${token}\n-----END RSA PRIVATE KEY-----`,
    `-----BEGIN RSA PRIVATE KEY-----\n${token}\n-----END EC PRIVATE KEY-----`,
    `data:image/jpeg;base64,API_KEY=${token}`, `prefix data:image/png;base64,API_KEY=${token}`,
    { [key]: [key, { value: key }], ordinary: [false, null, 1] },
  ]];
  for (const candidate of cases) {
    assert.equal(JSON.stringify(redactShareSnapshot(candidate)), JSON.stringify(reference(candidate)));
    if (typeof candidate === "string") {
      for (const variation of [candidate.toLowerCase(), candidate.toUpperCase(), `prefix "${candidate}" suffix`, `TOKEN=${candidate}`]) {
        assert.equal(JSON.stringify(redactShareSnapshot(variation)), JSON.stringify(reference(variation)));
      }
    }
  }
  console.log(`Official isolated redactor comparison passed for ${cases.length} synthetic base cases and string variations`);
}
console.log("Share snapshot redaction: recursive values, overlap, placeholders, binary exclusion and UTF-8 size checks passed");
