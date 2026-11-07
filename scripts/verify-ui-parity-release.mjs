import { spawnSync } from 'node:child_process';

// Production component/client replays for the changes included in this preview.
// Native Windows behavior, protocol probes and paired pixels remain separate gates.
const scripts = [
  'verify-library-data.mjs', 'verify-library-read.mjs', 'verify-library-service.mjs',
  'verify-library-navigation.mjs', 'verify-library-host-navigation.mjs', 'verify-library-cleanup.mjs',
  'verify-library-preview.mjs', 'verify-library-preview-ui.mjs', 'verify-library-preview-media.mjs',
  'verify-library-search.mjs',
  'verify-library-browse.mjs', 'verify-library-browse-ui.mjs',
  'verify-library-sticky-header.mjs', 'verify-library-pagination.mjs',
  'verify-images-data.mjs', 'verify-images-assets.mjs', 'verify-images-view.mjs',
  'verify-cloud-environments.mjs', 'verify-cloud-draft-bindings.mjs', 'verify-cloud-draft-resume.mjs', 'verify-cloud-environment-access.mjs', 'verify-cloud-environment-data.mjs',
  'verify-gpts-data.mjs', 'verify-gpts-read.mjs', 'verify-gpts-service.mjs',
  'verify-sites-data.mjs', 'verify-sites-read.mjs', 'verify-sites-service.mjs', 'verify-sites-navigation.mjs',
  'verify-sites-settings-client.mjs', 'verify-sites-settings-ui.mjs',
  'verify-sites-slug-client.mjs', 'verify-sites-slug-ui.mjs',
  'verify-sites-domain-client.mjs', 'verify-sites-domain-ui.mjs',
  'verify-sites-sharing-data.mjs', 'verify-sites-sharing-members.mjs', 'verify-sites-sharing-client.mjs', 'verify-sites-sharing-ui.mjs',
  'verify-sites-sharing-invitation-data.mjs', 'verify-sites-sharing-invitations-client.mjs', 'verify-sites-sharing-invitation-search.mjs', 'verify-sites-sharing-invite-input.mjs',
  'verify-appearance-color.mjs', 'verify-system-fonts.mjs', 'verify-general-preference-select.mjs',
  'verify-settings-ui-correction.mjs', 'verify-appearance-theme-state.mjs', 'verify-appearance-theme-ui.mjs',
  'verify-general-open.mjs', 'verify-notification-settings-ui.mjs',
  'verify-account-notifications.mjs', 'verify-account-notifications-ui.mjs',
  'verify-command-cards.mjs', 'verify-user-message-presentation.mjs',
  'verify-project-index-sort.mjs',
  'verify-thread-activity.mjs', 'verify-activity-session.mjs', 'verify-activity-session-app.mjs', 'verify-activity-session-sidebar.mjs',
  'verify-archive-settings-projection.mjs', 'verify-archived-settings.mjs', 'verify-archive-service.mjs',
  'verify-archive-cloud-transport.mjs', 'verify-archive-cloud-tasks.mjs', 'verify-archive-cloud-ui.mjs',
  'verify-archive-conversations-transport.mjs', 'verify-archive-conversations.mjs', 'verify-archive-conversations-ui.mjs',
  'verify-archive-unarchive-transport.mjs', 'verify-archive-unarchive-ui.mjs',
  'verify-archive-delete-transport.mjs', 'verify-archive-delete-ui.mjs', 'verify-toast-action.mjs',
  'verify-workspace-file-tree.mjs', 'verify-workspace-recursive-tree.mjs', 'verify-workbench-app-e.mjs',
  'verify-file-editor-lifecycle.mjs', 'verify-file-editor-save.mjs',
  'verify-skill-preview-ui.mjs', 'verify-skill-selector.mjs', 'verify-skill-trial.mjs',
  'verify-skill-trial-host.mjs', 'verify-skill-trial-prefill.mjs', 'verify-skill-file-host.mjs',
  'verify-recommended-skills.mjs', 'verify-recommended-preview.mjs', 'verify-recommended-parent.mjs', 'verify-skill-actions.mjs',
  'verify-terminal-ui.mjs', 'verify-terminal-lifecycle.mjs', 'verify-terminal-output.mjs',
  'verify-terminal-command.mjs', 'verify-terminal-layout.mjs', 'verify-environment-terminal-c.mjs',
];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS ${scripts.length} frontend parity replays; not a full app/native/pixel acceptance`);
