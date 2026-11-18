import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const app = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(app.identifier, 'com.codex.native.tauri', 'Keep the existing application data identity across renames');
assert.equal(app.bundle.windows.wix.upgradeCode.toLowerCase(), '8dddee38-dad1-57eb-b04f-85cc566678c1', 'Keep the upgrade code from the original Windows MSI');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-release-metadata-'));
const output = path.join(dir, 'outputs');
const script = path.resolve('scripts/prepare-github-release.mjs');
function git(args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'docs/releases/v0.2.0-preview.1.md']) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.copyFileSync(file, path.join(dir, file));
}
git(['init', '--quiet']);
git(['add', '.']);
git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
const first = git(['rev-parse', 'HEAD']);
fs.writeFileSync(path.join(dir, 'fixture'), 'second commit');
git(['add', 'fixture']);
git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'second']);
const sha = git(['rev-parse', 'HEAD']);
function run(env, args = []) {
  fs.writeFileSync(output, '');
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_REF: 'refs/heads/master', CREATE_RELEASE: '', GITHUB_SHA: sha,
      RELEASE_TAG: '', RELEASE_PRERELEASE: '', GITHUB_OUTPUT: output, ...env },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: fs.readFileSync(output, 'utf8'), stderr: result.stderr };
}
assert.equal(run({}).status, 0);
for (const tag of ['', 'master', 'v0.1.0', 'v0.2.0/../../escape', 'v0.2.0\nnotes=bad']) {
  const result = run({ CREATE_RELEASE: 'true', RELEASE_TAG: tag });
  assert.notEqual(result.status, 0); assert.equal(result.output, '');
}
const preview = run({ CREATE_RELEASE: 'true', RELEASE_TAG: 'v0.2.0-preview.1', RELEASE_PRERELEASE: 'false' });
assert.equal(preview.status, 0, preview.stderr);
assert.match(preview.output, /^tag=v0\.2\.0-preview\.1$/m); assert.match(preview.output, /^prerelease=true$/m);
assert.match(preview.output, /^notes=docs\/releases\/v0\.2\.0-preview\.1.md$/m);
assert.equal(run({ GITHUB_REF: 'refs/tags/v0.2.0-preview.1' }).status, 0);
assert.notEqual(run({ CREATE_RELEASE: 'true', RELEASE_TAG: 'v0.2.0-preview.missing' }).status, 0, 'missing notes cannot publish');
const publish = { CREATE_RELEASE: 'true', RELEASE_TAG: 'v0.2.0-preview.1' };
assert.notEqual(run({ ...publish, GITHUB_SHA: '' }).status, 0);
assert.notEqual(run({ ...publish, GITHUB_SHA: first }).status, 0, 'checkout must match requested SHA');
for (const annotated of [false, true]) {
  const args = annotated ? ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'tag', '-a', '-m', 'fixture'] : ['tag'];
  git([...args, publish.RELEASE_TAG, first]);
  const mismatch = run(publish);
  assert.notEqual(mismatch.status, 0); assert.equal(mismatch.output, '');
  assert.match(mismatch.stderr, /Existing release tag points to a different commit/);
  git(['tag', '-d', publish.RELEASE_TAG]);
  git([...args, publish.RELEASE_TAG, sha]);
  assert.equal(run(publish).status, 0);
  git(['tag', '-d', publish.RELEASE_TAG]);
}
const remote = path.join(dir, 'remote.git');
git(['clone', '--bare', '--quiet', '--no-hardlinks', dir, remote]);
git(['remote', 'add', 'origin', remote]);
git(['-C', remote, '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'tag', '-a', '-m', 'remote annotated tag', publish.RELEASE_TAG, sha]);
git(['tag', publish.RELEASE_TAG, sha]);
const legacyFetch = spawnSync('git', ['fetch', 'origin', '--tags'], { cwd: dir, encoding: 'utf8' });
assert.notEqual(legacyFetch.status, 0, 'checkout lightweight tag conflicts with the remote annotated tag');
assert.match(legacyFetch.stderr, /would clobber existing tag/);
assert.equal(run(publish, ['--revalidate-remote']).status, 0, 'matching remote annotated tag remains publishable');
assert.equal(git(['cat-file', '-t', `refs/tags/${publish.RELEASE_TAG}`]), 'commit', 'validation must not replace checkout tag');
git(['-C', remote, 'tag', '-f', publish.RELEASE_TAG, first]);
const remoteMismatch = run(publish, ['--revalidate-remote']);
assert.notEqual(remoteMismatch.status, 0, 'remote tag moving away from the verified commit must block publication');
assert.equal(remoteMismatch.output, '');
git(['-C', remote, 'tag', '-f', publish.RELEASE_TAG, sha]);
assert.equal(run(publish, ['--revalidate-remote']).status, 0, 'matching remote lightweight tag is supported');
git(['-C', remote, 'tag', '-d', publish.RELEASE_TAG]);
assert.notEqual(run(publish, ['--revalidate-remote']).status, 0, 'missing remote tag must block publication');
const createTag = ['--create-remote-tag', '--revalidate-remote'];
const created = run(publish, createTag);
assert.equal(created.status, 0, created.stderr);
assert.equal(git(['-C', remote, 'rev-parse', `refs/tags/${publish.RELEASE_TAG}^{commit}`]), sha, 'new tag must point to the tested commit');
git(['-C', remote, 'tag', '-d', publish.RELEASE_TAG]);
git(['-C', remote, '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'tag', '-a', '-m', 'existing annotated tag', publish.RELEASE_TAG, sha]);
assert.equal(run(publish, createTag).status, 0, 'matching annotated tags remain unchanged');
git(['-C', remote, 'tag', '-f', publish.RELEASE_TAG, first]);
assert.notEqual(run(publish, createTag).status, 0, 'a different existing remote tag must block release');
assert.equal(git(['-C', remote, 'rev-parse', `refs/tags/${publish.RELEASE_TAG}^{commit}`]), first, 'release must never move an existing tag');
// Only remove this test's newly created, verified private root.
assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
assert.ok(path.basename(dir).startsWith('codex-release-metadata-'));
fs.rmSync(dir, { recursive: true });
console.log('PASS release versions, explicit tags, notes, unsafe input and lightweight/annotated tag commit guards');
