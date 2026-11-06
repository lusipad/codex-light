import { spawnSync } from 'node:child_process';

// Production component/client replays for the changes included in this preview.
// Native Windows behavior, protocol probes and paired pixels remain separate gates.
const scripts = [
  'verify-appearance-color.mjs', 'verify-system-fonts.mjs', 'verify-general-preference-select.mjs',
  'verify-settings-ui-correction.mjs', 'verify-appearance-theme-state.mjs', 'verify-appearance-theme-ui.mjs',
  'verify-general-open.mjs', 'verify-notification-settings-ui.mjs',
  'verify-account-notifications.mjs', 'verify-account-notifications-ui.mjs',
  'verify-command-cards.mjs', 'verify-user-message-presentation.mjs',
  'verify-project-index-sort.mjs',
  'verify-archive-settings-projection.mjs', 'verify-archived-settings.mjs',
  'verify-archive-cloud-transport.mjs', 'verify-archive-cloud-tasks.mjs', 'verify-archive-cloud-ui.mjs',
  'verify-archive-conversations-transport.mjs', 'verify-archive-conversations.mjs', 'verify-archive-conversations-ui.mjs',
  'verify-archive-unarchive-transport.mjs', 'verify-archive-unarchive-ui.mjs',
  'verify-workspace-file-tree.mjs', 'verify-workspace-recursive-tree.mjs', 'verify-workbench-app-e.mjs',
  'verify-file-editor-lifecycle.mjs', 'verify-file-editor-save.mjs',
  'verify-terminal-ui.mjs', 'verify-terminal-lifecycle.mjs', 'verify-terminal-output.mjs',
  'verify-terminal-command.mjs', 'verify-terminal-layout.mjs', 'verify-environment-terminal-c.mjs',
];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS ${scripts.length} frontend parity replays; not a full app/native/pixel acceptance`);
