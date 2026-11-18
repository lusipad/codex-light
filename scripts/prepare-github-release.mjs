import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = file => fs.readFileSync(file, 'utf8');
const version = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
const cargoLock = read('src-tauri/Cargo.lock').match(/name = "codex-tauri"\r?\nversion = "([^"]+)"/)?.[1];
if (![lock.version, lock.packages[''].version, tauri.version, cargo, cargoLock].every(item => item === version)) {
  throw Error('Application and package/lock versions do not agree');
}
const tagPush = process.env.GITHUB_REF?.startsWith('refs/tags/v');
const publish = tagPush || process.env.CREATE_RELEASE === 'true';
if (publish) {
  const tag = tagPush ? process.env.GITHUB_REF.slice('refs/tags/'.length) : process.env.RELEASE_TAG;
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '') || tag.slice(1).split('-')[0] !== version) {
    throw Error('Release requires an explicit version-matching tag');
  }
  const notes = `docs/releases/${tag}.md`;
  if (!fs.existsSync(notes)) throw Error(`Release notes required: ${notes}`);
  const sha = process.env.GITHUB_SHA;
  if (!/^[0-9a-f]{40}$/i.test(sha ?? '')) throw Error('Publication requires an exact commit SHA');
  const git = args => spawnSync('git', args, { encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== sha) throw Error('Release checkout does not match requested commit');
  const existing = git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]);
  if (existing.status === 0) {
    const target = git(['rev-parse', `refs/tags/${tag}^{commit}`]);
    if (target.status !== 0 || target.stdout.trim() !== sha) throw Error('Existing release tag points to a different commit');
  } else if (existing.status !== 1) throw Error('Cannot verify release tag');
  const createRemoteTag = process.argv.includes('--create-remote-tag');
  if (createRemoteTag) {
    const remote = git(['ls-remote', '--exit-code', '--refs', 'origin', `refs/tags/${tag}`]);
    if (remote.status === 2) {
      const push = git(['push', 'origin', `HEAD:refs/tags/${tag}`]);
      if (push.status !== 0) throw Error('Cannot create remote release tag');
    } else if (remote.status !== 0) throw Error('Cannot inspect remote release tag');
  }
  if (createRemoteTag || process.argv.includes('--revalidate-remote')) {
    const remoteRef = `refs/codex-release-tags/${tag}`;
    const fetch = git(['fetch', '--no-tags', 'origin', `refs/tags/${tag}:${remoteRef}`]);
    if (fetch.status !== 0) throw Error('Cannot fetch remote release tag');
    const target = git(['rev-parse', `${remoteRef}^{commit}`]);
    if (target.status !== 0 || target.stdout.trim() !== sha) throw Error('Remote release tag points to a different commit');
  }
  const prerelease = tag.includes('-') || process.env.RELEASE_PRERELEASE === 'true';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nnotes=${notes}\nprerelease=${prerelease}\n`);
  console.log(`Validated ${tag} (${prerelease ? 'preview' : 'release'}) at ${sha}`);
} else console.log(`PASS consistent application version ${version}; publication not requested`);
