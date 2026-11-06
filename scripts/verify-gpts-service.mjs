// Preserve the existing GPT behavior entry point while exercising the current
// production view, its real nested avatar/detail components and the actual decoder.
// Public 12/6 request sizes and raw-empty category continuation now live at the
// production client boundary, covered by verify-gpts-read.mjs separately.
import './verify-gpts-view.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/components/GptsView.tsx', 'utf8');
assert.doesNotMatch(source, /SAMPLE_GPTS|尚未创建|12 月 11|无缝迁移/);
const app = fs.readFileSync('src/App.tsx', 'utf8');
assert.ok(app.includes('<GptsView />'));
assert.ok(!app.includes('onStartGptChat='), 'GPT IDs must not be passed off as ordinary app-server chat turns');
console.log('PASS GPT application entry still mounts the real view and exposes no false GPT conversation binding');
