#!/usr/bin/env pwsh
# One-shot verification for codex-desktop-native.
#
#   pwsh -NoProfile -File ./scripts/verify-all.ps1           # full verification
#   pwsh -NoProfile -File ./scripts/verify-all.ps1 -Fast     # skip protocol probes
#
# Requires: node/npm, rust toolchain (cargo), and a working `codex` CLI on PATH
# (protocol probes spawn a real `codex app-server` with an isolated CODEX_HOME
#  so they never touch ~/.codex).
param(
  [switch]$Fast
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
$failed = @()

function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)
  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  try {
    & $Action
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
      throw "exit code $LASTEXITCODE"
    }
    Write-Host "PASS  $Name" -ForegroundColor Green
  } catch {
    Write-Host "FAIL  $Name -> $_" -ForegroundColor Red
    $script:failed += $Name
  }
}

try {
  Invoke-Step "Release version, tag and notes contracts" { node scripts/verify-release-metadata.mjs }
  Invoke-Step "Appearance color official HSV samples and slider contracts" { node scripts/verify-appearance-color.mjs }
  Invoke-Step "System font directory and local font selection contracts" { node scripts/verify-system-fonts.mjs }
  Invoke-Step "Rust real system font directory" { cargo test --locked --manifest-path src-tauri/Cargo.toml system_fonts }
  Invoke-Step "All-page workflow UI correction" { node scripts/verify-workflow-ui-d.mjs }
  Invoke-Step "Workspace file tree and actual file selection" { node scripts/verify-workspace-file-tree.mjs }
  Invoke-Step "Recursive workspace tree and multi-root lifecycle" { node scripts/verify-workspace-recursive-tree.mjs }
  Invoke-Step "App workbench project scope" { node scripts/verify-workbench-app-e.mjs }
  Invoke-Step "Terminal controls, theme and keyboard" { node scripts/verify-terminal-ui.mjs }
  Invoke-Step "General preference menu positioning and keyboard" { node scripts/verify-general-preference-select.mjs }
  Invoke-Step "Settings wrapper and immediate-save UI correction" { node scripts/verify-settings-ui-correction.mjs }
  Invoke-Step "Project, worktree and archive UI correction" { node scripts/verify-organization-ui.mjs }
  Invoke-Step "Project sorting, timestamps and read-only projection" { node scripts/verify-project-index-sort.mjs }
  Invoke-Step "Plugin and skill directory UI correction" { node scripts/verify-extensions-ui-d.mjs }
  Invoke-Step "Worktree cleanup planner against official golden cases" { node scripts/verify-worktree-policy.mjs }
  Invoke-Step "Worktree cleanup lifecycle and recovery contracts" { node scripts/verify-worktree-cleanup-runtime.mjs }
  Invoke-Step "Worktree preference component and progress contracts" { node scripts/verify-worktree-preferences-ui.mjs }
  Invoke-Step "Environment action App scope and native dispatch contracts" { node scripts/verify-environment-app-c.mjs }
  Invoke-Step "Local environment structured settings and selection contracts" { node scripts/verify-local-environments-ui-b.mjs }
  Invoke-Step "Local environment toolbar actions and selection scope" { node scripts/verify-environment-actions-c-ui.mjs }
  Invoke-Step "Worktree cleanup cancellation and partial removal results" { node scripts/verify-environment-actions-c-removal.mjs }
  Invoke-Step "Environment terminal action generation and owner contracts" { node scripts/verify-environment-terminal-c.mjs }
  Invoke-Step "Environment settings target and runtime action contracts" { node scripts/verify-environment-settings-c.mjs }
  Invoke-Step "Rust worktree snapshot cleanup and deletion regression" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib worktree_removal_tests }
  Invoke-Step "Worktree creation cancellation and result contracts" { node scripts/verify-worktree-creation-b.mjs }
  Invoke-Step "Rust environment discovery, persistence and real setup" { cargo test --locked --manifest-path src-tauri/Cargo.toml local_environment }
  Invoke-Step "Rust terminal consumes worktree setup environment" { cargo test --locked --manifest-path src-tauri/Cargo.toml real_pty_consumes_worktree_setup_environment }
  Invoke-Step "Git message production contexts and cancellation" { node scripts/verify-git-generation-b.mjs }
  Invoke-Step "Git message generation before actual write actions" { node scripts/verify-git-generation-ui-b.mjs }
  Invoke-Step "Git instruction autosave and readback" { node scripts/verify-git-instructions-b.mjs }
  Invoke-Step "Rust isolated Git message generation" { cargo test --manifest-path src-tauri/Cargo.toml git_generation }
  Invoke-Step "Rust Git message context read-only contracts" { cargo test --manifest-path src-tauri/Cargo.toml message_context }
  Invoke-Step "Remote plugin mapping and service recovery contracts" { node scripts/verify-remote-plugins-c.mjs }
  Invoke-Step "Remote plugin component state and source isolation" { node scripts/verify-remote-plugin-ui-c.mjs }
  Invoke-Step "Recommended skills native client and discovery contracts" { node scripts/verify-recommended-skills.mjs }
  Invoke-Step "Recommended skills component scope and lifecycle contracts" { node scripts/verify-recommended-skills-ui.mjs }
  Invoke-Step "Rust recommended skill repository and complete installation" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib recommended_skills_tests }
  Invoke-Step "Plugin preparation protocol and pagination contracts" { node scripts/verify-plugin-preparation-protocol.mjs }
  Invoke-Step "Plugin preparation component lifecycle contracts" { node scripts/verify-plugin-preparation-ui.mjs }
  Invoke-Step "Worktree removal conversation and result contracts" { node scripts/verify-worktree-removal.mjs }
  Invoke-Step "Library authenticated service boundary regression" { node scripts/verify-library-service.mjs }
  Invoke-Step "Library response mapping, paging and sorting" { node scripts/verify-library-data.mjs }
  Invoke-Step "Library access and real client contracts" { node scripts/verify-library-read.mjs }
  Invoke-Step "Library cleanup lifecycle and presentation regression" { node scripts/verify-library-cleanup.mjs }
  Invoke-Step "Images authenticated service and real result regression" { node scripts/verify-images-service.mjs }
  Invoke-Step "GPTs service and identity boundary regression" { node scripts/verify-gpts-service.mjs }
  Invoke-Step "Sites authenticated catalog and readonly settings regression" { node scripts/verify-sites-service.mjs }
  Invoke-Step "Codex Cloud authenticated configuration regression" { node scripts/verify-cloud-environments.mjs }
  Invoke-Step "Authenticated service renderer contracts" { node scripts/verify-chatgpt-service.mjs }
  Invoke-Step "Cloud archive fixed transport and identity envelopes" { node scripts/verify-archive-cloud-transport.mjs }
  Invoke-Step "Cloud archive pagination, account changes and listener lifecycle" { node scripts/verify-archive-cloud-tasks.mjs }
  Invoke-Step "Cloud archive mixed-source projection and read-only controls" { node scripts/verify-archive-cloud-ui.mjs }
  Invoke-Step "Conversation archive host qualification and transport contracts" { node scripts/verify-archive-conversations-transport.mjs }
  Invoke-Step "Conversation archive paging, scope changes and account lifecycle" { node scripts/verify-archive-conversations.mjs }
  Invoke-Step "Conversation archive three-source projection and action isolation" { node scripts/verify-archive-conversations-ui.mjs }
  Invoke-Step "Cloud unarchive fixed mutation transport and result contracts" { node scripts/verify-archive-unarchive-transport.mjs }
  Invoke-Step "Cloud unarchive lifecycle, source isolation and actual controls" { node scripts/verify-archive-unarchive-ui.mjs }
  Invoke-Step "Cloud delete fixed mutation transport and result contracts" { node scripts/verify-archive-delete-transport.mjs }
  Invoke-Step "Cloud delete confirmation, source isolation and recovery" { node scripts/verify-archive-delete-ui.mjs }
  Invoke-Step "Toast retry action and timer ownership" { node scripts/verify-toast-action.mjs }
  Invoke-Step "Account notification data contracts" { node scripts/verify-account-notifications.mjs }
  Invoke-Step "Account notification concurrency and lifecycle" { node scripts/verify-account-notifications-ui.mjs }
  Invoke-Step "Rust authenticated read service contracts" { cargo test --manifest-path src-tauri/Cargo.toml chatgpt_service }
  Invoke-Step "Generated image real byte save regression" { node scripts/verify-image-save.mjs }
  Invoke-Step "Rust generated image save contracts" { cargo test --manifest-path src-tauri/Cargo.toml image_save }
  Invoke-Step "Native Quick Chat routing regression" { node scripts/verify-native-quick-chat.mjs }
  Invoke-Step "Native thread action truthfulness regression" { node scripts/verify-native-thread-actions.mjs }
  Invoke-Step "Native deep link receiver lifecycle regression" { node scripts/verify-deep-links.mjs }
  Invoke-Step "Rust deep link parser and queue contracts" { cargo test --manifest-path src-tauri/Cargo.toml deep_links }
  Invoke-Step "Windows instance transport and real child process regression" { cargo test --manifest-path src-tauri/Cargo.toml instance_transport }
  Invoke-Step "Share complete-history reader regression" { node scripts/verify-share-history.mjs }
  Invoke-Step "Share snapshot whitelist conversion regression" { node scripts/verify-share-snapshot.mjs }
  Invoke-Step "Share snapshot redaction regression" { node scripts/verify-share-redaction.mjs }
  Invoke-Step "Share preparation pipeline regression" { node scripts/verify-share-preparation.mjs }
  Invoke-Step "Share service IPC and cancellation regression" { node scripts/verify-share-service.mjs }
  Invoke-Step "Share access gates and real recipient regression" { node scripts/verify-share-access.mjs }
  Invoke-Step "Share asset reader boundary regression" { node scripts/verify-share-assets.mjs }
  Invoke-Step "Share dialog interaction regression" { node scripts/verify-share-dialog.mjs }
  Invoke-Step "Share session lifecycle regression" { node scripts/verify-share-session.mjs }
  Invoke-Step "Rust share local asset boundaries" { cargo test --manifest-path src-tauri/Cargo.toml share_assets }
  Invoke-Step "Same-thread independent window regression" { node scripts/verify-thread-window.mjs }
  Invoke-Step "Native menu targeted listener regression" { node scripts/verify-native-menu-routing.mjs }
  Invoke-Step "Rust same-thread window contracts" { cargo test --manifest-path src-tauri/Cargo.toml thread_window }
  Invoke-Step "Rust Quick Chat lifecycle regression" { cargo test --manifest-path src-tauri/Cargo.toml quick_chat }
  Invoke-Step "Quick Chat shared conversation regression" { node scripts/verify-quick-chat.mjs }
  Invoke-Step "Pet preferences and real consumers regression" { node scripts/verify-pet-settings.mjs }
  Invoke-Step "Cloud preference capability regression" { node scripts/verify-cloud-preferences.mjs }
  Invoke-Step "Rust pet preference and resource regression" { cargo test --manifest-path src-tauri/Cargo.toml pet }
  Invoke-Step "Control capability settings regression" { node scripts/verify-control-settings.mjs }
  Invoke-Step "Voice settings and browser fallback regression" { node scripts/verify-voice-settings.mjs }
  Invoke-Step "Experimental feature persistence regression" { node scripts/verify-experimental-features.mjs }
  Invoke-Step "Titlebar native window state component regression" { node scripts/verify-titlebar-window-state.mjs }
  Invoke-Step "Sidebar project disclosure component regression" { node scripts/verify-sidebar-projects.mjs }
  Invoke-Step "Sidebar thread context menu regression" { node scripts/verify-sidebar-thread-menu.mjs }
  Invoke-Step "Sidebar section toggle and RPC regression" { node scripts/verify-sidebar-section-toggle.mjs }
  Invoke-Step "Sidebar section creation from session menu regression" { node scripts/verify-sidebar-section-create.mjs }
  Invoke-Step "Profile identity and keyboard component regression" { node scripts/verify-profile-menu.mjs }
  Invoke-Step "Help submenu and keyboard dialog regression" { node scripts/verify-help-menu.mjs }
  Invoke-Step "Keyboard bindings persistence, capture and dispatch regression" { node scripts/verify-keyboard-preferences.mjs }
  Invoke-Step "App contextual command routing regression" { node scripts/verify-keyboard-app-routing.mjs }
  Invoke-Step "Composer and approval command regression" { node scripts/verify-keyboard-composer.mjs }
  Invoke-Step "Workbench command and context regression" { node scripts/verify-keyboard-workbench.mjs }
  Invoke-Step "Rust keybinding revision and target contracts" { cargo test --manifest-path src-tauri/Cargo.toml keybindings }
  Invoke-Step "Rust native shortcut capture ownership" { cargo test --manifest-path src-tauri/Cargo.toml shortcut_tests }
  Invoke-Step "Sidebar manual order regression" { node scripts/verify-sidebar-order.mjs }
  Invoke-Step "Shared hierarchical menu regression" { node scripts/verify-thread-actions-menu.mjs }
  Invoke-Step "Sidebar rename dialog and RPC regression" { node scripts/verify-sidebar-rename.mjs }
  Invoke-Step "Sidebar rich hover card regression" { node scripts/verify-sidebar-hovercard.mjs }
  Invoke-Step "Thread list pagination callback regression" { node scripts/verify-thread-list-pagination.mjs }
  Invoke-Step "Project membership notification/list regression" { node scripts/verify-project-membership-refresh.mjs }
  Invoke-Step "Sidebar durable read-state regression" { node scripts/verify-sidebar-read-state.mjs }
  Invoke-Step "Workspace identity refresh regression" { node scripts/verify-workspace-identity.mjs }
  Invoke-Step "Sidebar local project entities regression" { node scripts/verify-sidebar-local-projects.mjs }
  Invoke-Step "Sidebar project selection regression" { node scripts/verify-sidebar-project-selection.mjs }
  Invoke-Step "Restored new-thread project context regression" { node scripts/verify-new-thread-project-context.mjs }
  Invoke-Step "Home send transition and failure regression" { node scripts/verify-home-send-transition.mjs }
  Invoke-Step "Composer draft identity and persistence regression" { node scripts/verify-composer-drafts.mjs }
  Invoke-Step "Composer attachment draft scope regression" { node scripts/verify-composer-attachment-drafts.mjs }
  Invoke-Step "Composer native file drop regression" { node scripts/verify-composer-drop.mjs }
  Invoke-Step "Appearance preferences and consumers regression" { node scripts/verify-appearance.mjs }
  Invoke-Step "Appearance theme semantics and preset data regression" { node scripts/verify-appearance-theme.mjs }
  Invoke-Step "Appearance theme writes and multiwindow regression" { node scripts/verify-appearance-theme-state.mjs }
  Invoke-Step "Appearance theme settings component regression" { node scripts/verify-appearance-theme-ui.mjs }
  Invoke-Step "Rust appearance configuration boundaries" { cargo test --manifest-path src-tauri/Cargo.toml appearance_preferences }
  Invoke-Step "Notification classification, persistence and dispatch regression" { node scripts/verify-notification-preferences.mjs }
  Invoke-Step "Native notification routing and approval intents" { node scripts/verify-notification-delivery.mjs }
  Invoke-Step "Windows notification adapter contracts" {
    if ($IsWindows) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop-notifications.ps1 -OutDir .ref/parity/16.04/actual/16-04B/native-standard -Test }
  }
  Invoke-Step "Rust notification preferences, audio and native identity contracts" { cargo test --manifest-path src-tauri/Cargo.toml notification --lib }
  Invoke-Step "Rust cross-window notification arbitration regression" {
    cargo test --manifest-path src-tauri/Cargo.toml notification_broker
  }
  Invoke-Step "Model discovery, selection and settings route regression" { node scripts/verify-model-catalog.mjs }
  Invoke-Step "Model capability, eligibility and real tier regression" { node scripts/verify-model-capabilities-b.mjs }
  Invoke-Step "Model scope, persistence and confirmed use regression" { node scripts/verify-model-selection-state-b.mjs }
  Invoke-Step "Model picker and recent configuration UI regression" { node scripts/verify-model-selection-ui-b.mjs }
  Invoke-Step "Model parameters across actual submission paths" { node scripts/verify-model-requests-b.mjs }
  Invoke-Step "Rust model defaults and recent persistence regression" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib model_preferences }
  Invoke-Step "Archived settings shared lifecycle regression" { node scripts/verify-archived-settings.mjs }
  Invoke-Step "Archived settings project identity, grouping and honest source projection" { node scripts/verify-archive-settings-projection.mjs }
  Invoke-Step "Storage cloud capability and destructive entry regression" { node scripts/verify-storage-settings.mjs }
  Invoke-Step "Agent user config version, readback and lifecycle regression" { node scripts/verify-agent-settings.mjs }
  Invoke-Step "Agent scoped configuration, requirements and persistence regression" { node scripts/verify-agent-configuration-b.mjs }
  Invoke-Step "Configured and thread execution policy regression" { node scripts/verify-execution-policy-b.mjs }
  Invoke-Step "Agent defaults across actual App submission paths" { node scripts/verify-agent-execution-b.mjs }
  Invoke-Step "Rust scoped config and comment-preserving writes" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib agent_configuration }
  Invoke-Step "Personal Codex instructions editor and draft lifecycle regression" { node scripts/verify-personalization.mjs }
  Invoke-Step "Personal instruction global navigation regression" { node scripts/verify-personalization-navigation-b.mjs }
  Invoke-Step "Personal instruction notification and reset continuation regression" { node scripts/verify-personalization-action-guards-b.mjs }
  Invoke-Step "Memory settings state and actual component regression" { node scripts/verify-memory-preferences-c.mjs }
  Invoke-Step "Rust memory preferences and isolated operation contracts" { cargo test --locked --manifest-path src-tauri/Cargo.toml memory_preferences }
  Invoke-Step "Rust account instructions authenticated transport contracts" { cargo test --locked --manifest-path src-tauri/Cargo.toml account_instructions_ }
  Invoke-Step "Personal Codex instructions isolated file regression" { cargo test --manifest-path src-tauri/Cargo.toml personal_instructions }
  Invoke-Step "Account identity, partial failure and lifecycle regression" { node scripts/verify-account-snapshot.mjs }
  Invoke-Step "Account login, managed restrictions and cancellation regression" { node scripts/verify-account-session-b.mjs }
  Invoke-Step "Rust fixed usage service and identity contracts" { cargo test --locked --manifest-path src-tauri/Cargo.toml wham_usage_ }
  Invoke-Step "Account profile sources and authenticated client contracts" { node scripts/verify-account-profile-client-b.mjs }
  Invoke-Step "Account detail editors, username checks and navigation regression" { node scripts/verify-account-details-b.mjs }
  Invoke-Step "Public profile real read/write and draft lifecycle regression" { node scripts/verify-profile-settings.mjs }
  Invoke-Step "Rust account and public profile service contracts" { cargo test --locked --manifest-path src-tauri/Cargo.toml chatgpt_service::tests::profile_ }
  Invoke-Step "MCP runtime status discovery regression" { node scripts/verify-mcp-status.mjs }
  Invoke-Step "MCP scoped configuration and preserved-field regression" { node scripts/verify-mcp-settings-b.mjs }
  Invoke-Step "MCP settings component and lifecycle regression" { node scripts/verify-mcp-settings-ui-b.mjs }
  Invoke-Step "Rust MCP cross-window invalidation boundary" { cargo test --locked --manifest-path src-tauri/Cargo.toml mcp_config_event_tests }
  Invoke-Step "General open target and shell regression" { node scripts/verify-general-open.mjs }
  Invoke-Step "Workspace explicit open target and lifecycle regression" { node scripts/verify-workspace-open-targets.mjs }
  Invoke-Step "Native open target and isolated PTY regression" { cargo test --manifest-path src-tauri/Cargo.toml desktop_open }
  Invoke-Step "General Enter preference and composer regression" { node scripts/verify-general-enter.mjs }
  Invoke-Step "Composer multiline input regression" { node scripts/verify-composer-multiline.mjs }
  Invoke-Step "Composer menu keyboard regression" { node scripts/verify-composer-menus.mjs }
  Invoke-Step "Unit 01A Public Shell parity" { node scripts/verify-unit-01a-shell.mjs }
  Invoke-Step "Home Hero state and project entry regression" { node scripts/verify-home-hero.mjs }
  Invoke-Step "Unit 01 Home Shell & Composer parity" { node scripts/verify-unit-01-home-shell.mjs }
  Invoke-Step "Unit 02 Thread Basics parity" { node scripts/verify-unit-02-thread-basics.mjs }
  Invoke-Step "User message presentation regression" { node scripts/verify-user-message-presentation.mjs }
  Invoke-Step "Thread header rename regression" { node scripts/verify-thread-header.mjs }
  Invoke-Step "Duplicate user message regression" { node scripts/verify-duplicate-message-fix.mjs }
  Invoke-Step "Reasoning flow & rendering parity" { node scripts/verify-reasoning-rendering.mjs }
  Invoke-Step "Keyboard shortcut regression" { node scripts/verify-shortcuts.mjs }
  Invoke-Step "Composer follow-up keyboard regression" { node scripts/verify-composer-keys.mjs }
  Invoke-Step "Project move confirmation keyboard regression" { node scripts/verify-project-move-keyboard.mjs }
  Invoke-Step "Thread content regression" { node scripts/verify-thread-content.mjs }
  Invoke-Step "Clipboard failure regression" { node scripts/verify-clipboard.mjs }
  Invoke-Step "Approval lifecycle regression" { node scripts/verify-approval.mjs }
  Invoke-Step "Turn controls regression" { node scripts/verify-turn-controls.mjs }
  Invoke-Step "Thread queue regression" { node scripts/verify-queue.mjs }
  Invoke-Step "Thread identity replay" { node scripts/verify-thread-timeline.mjs }
  Invoke-Step "Execution item stream regression" { node scripts/verify-execution-items.mjs }
  Invoke-Step "Command execution card disclosure regression" { node scripts/verify-command-cards.mjs }
    Invoke-Step "Interleaved timeline order regression" { node scripts/verify-timeline-order.mjs }
    Invoke-Step "MCP raw output and result regression" { node scripts/verify-mcp-output.mjs }
    Invoke-Step "Project index identity and async regression" { node scripts/verify-project-index.mjs }
    Invoke-Step "File editor lifecycle regression" { node scripts/verify-file-editor-lifecycle.mjs }
    Invoke-Step "File editor disk conflict guard" { node scripts/verify-file-editor-save.mjs }
    Invoke-Step "Worktree root settings lifecycle" { node scripts/verify-worktree-settings.mjs }
    Invoke-Step "Local environment draft and command regression" { node scripts/verify-local-environment.mjs }
    Invoke-Step "Git preferences and real consumer regression" { node scripts/verify-git-preferences.mjs }
    Invoke-Step "Git diff and commit lifecycle regression" { node scripts/verify-git-lifecycle.mjs }
    Invoke-Step "Terminal view lifecycle regression" { node scripts/verify-terminal-lifecycle.mjs }
    Invoke-Step "Terminal output ordering and replay regression" { node scripts/verify-terminal-output.mjs }
    Invoke-Step "Rust terminal UTF-8, real PTY and environment action lifecycle regression" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib terminal::tests }
    Invoke-Step "Terminal command dispatch regression" { node scripts/verify-terminal-command.mjs }
  Invoke-Step "Tool cards & execution item parity" { node scripts/verify-tool-cards.mjs }
  Invoke-Step "Plan & Goal lifecycle parity" { node scripts/verify-plan-goal.mjs }
  Invoke-Step "Misc tool cards (Image/Sleep/Search) parity" { node scripts/verify-misc-tools.mjs }
  Invoke-Step "Projects & Thread Sections parity" { node scripts/verify-projects-sections.mjs }
  Invoke-Step "Files worksurface & live editor parity" { node scripts/verify-files-worksurface.mjs }
  Invoke-Step "Changes & Git worksurface parity" { node scripts/verify-git-worksurface.mjs }
  Invoke-Step "Terminal & layout resizer parity" { node scripts/verify-terminal-layout.mjs }
  Invoke-Step "Search & command palette parity" { node scripts/verify-search-palette.mjs }
  Invoke-Step "Search command routing regression" { node scripts/verify-search-routing.mjs }
  Invoke-Step "Search cache and mode lifecycle regression" { node scripts/verify-search-lifecycle.mjs }
  Invoke-Step "Search protocol completion ordering regression" { node scripts/verify-search-probe-completion.mjs }
  Invoke-Step "Fuzzy file session transport regression" { node scripts/verify-fuzzy-file-search.mjs }
  Invoke-Step "Activity & Inbox parity" { node scripts/verify-activity-inbox.mjs }
  Invoke-Step "Service-backed thread activity and menu regression" { node scripts/verify-thread-activity.mjs }
  Invoke-Step "Automation terminal status and event identity regression" { node scripts/verify-automation-completion.mjs }
  Invoke-Step "Inbox history and persistence regression" { node scripts/verify-inbox-lifecycle.mjs }
  Invoke-Step "Scheduled & Automations parity" { node scripts/verify-scheduled-automations.mjs }
  Invoke-Step "Automation mutation and run regression" { node scripts/verify-automation-actions.mjs }
  Invoke-Step "Automation local task table, detail and configuration lifecycle" { node scripts/verify-automation-ui.mjs }
  Invoke-Step "Worktrees worksurface parity" { node scripts/verify-worktrees.mjs }
  Invoke-Step "Worktree context and chat entry regression" { node scripts/verify-worktree-context.mjs }
  Invoke-Step "Plugins marketplace & management parity" { node scripts/verify-plugins.mjs }
  Invoke-Step "Plugin policy, lifecycle and readback regression" { node scripts/verify-plugin-actions.mjs }
  Invoke-Step "Plugin catalog capability and bounded rendering regression" { node scripts/verify-plugin-catalog.mjs }
  Invoke-Step "Skills management & editor parity" { node scripts/verify-skills.mjs }
  Invoke-Step "Skill content, identity and mutation regression" { node scripts/verify-skill-actions.mjs }
  Invoke-Step "Installed skill preview and raw content actions" { node scripts/verify-skill-preview-ui.mjs }
  Invoke-Step "Namespaced skill enable selector" { node scripts/verify-skill-selector.mjs }
  Invoke-Step "Skill trial prompt reference construction" { node scripts/verify-skill-trial.mjs }
  Invoke-Step "Skill trial real draft host" { node scripts/verify-skill-trial-host.mjs }
  Invoke-Step "Skill trial replacement and stale navigation guards" { node scripts/verify-skill-trial-prefill.mjs }
  Invoke-Step "Skill file host acknowledgment and dirty guard" { node scripts/verify-skill-file-host.mjs }
  Invoke-Step "Code review targets parity" { node scripts/verify-code-review.mjs }
  Invoke-Step "Review start, delivery and navigation regression" { node scripts/verify-review-actions.mjs }
  Invoke-Step "Model review prompt and findings regression" { node scripts/verify-review-findings.mjs }
  Invoke-Step "Review execution result lifecycle regression" { node scripts/verify-review-results.mjs }
  Invoke-Step "Review reconnect and offscreen notification regression" { node scripts/verify-review-reconnect.mjs }
  Invoke-Step "Model review file and line rendering regression" { node scripts/verify-review-findings-ui.mjs }
  Invoke-Step "Archive lifecycle parity" { node scripts/verify-archive.mjs }
  Invoke-Step "Archive pagination and real mutation regression" { node scripts/verify-archive-actions.mjs }
  Invoke-Step "Archive bulk confirmation and actual result regression" { node scripts/verify-archive-bulk.mjs }
  Invoke-Step "Archive shared service scope and partial result regression" { node scripts/verify-archive-service.mjs }
  Invoke-Step "Rust archived deletion enumeration and partial results" { cargo test --manifest-path src-tauri/Cargo.toml --lib archive_delete }
  Invoke-Step "Settings center 26 partitions parity" { node scripts/verify-settings-partitions.mjs }
  Invoke-Step "Extended worksurfaces & cross-page parity (17-23)" { node scripts/verify-extended-worksurfaces.mjs }
  Invoke-Step "Hooks source identity and trusted write boundaries" { node scripts/verify-hooks-settings-b.mjs }
  Invoke-Step "Hook state and settings regression" { node scripts/verify-hook-state.mjs }
  Invoke-Step "Plugin settings management" { node scripts/verify-plugin-settings.mjs }
  Invoke-Step "Plugin enablement and marketplace dependency regression" { node scripts/verify-plugin-management-b.mjs }
  Invoke-Step "Plugin management lifecycle and component regression" { node scripts/verify-plugin-management-ui-b.mjs }
  Invoke-Step "Rust shared plugin operation regression" { cargo test --locked --manifest-path src-tauri/Cargo.toml plugin_operations }

Invoke-Step "TypeScript typecheck (tsc --noEmit)" { npx tsc --noEmit }
  Invoke-Step "Frontend production build (vite)" { npm run build }
  Invoke-Step "External import selection, completion and readback" { node scripts/verify-external-import.mjs }
  Invoke-Step "Review preferences persistence and UI consumers" { node scripts/verify-review-preferences.mjs }
  Invoke-Step "Code Review provider settings lifecycle and actual controls" { node scripts/verify-review-provider-ui.mjs }
  Invoke-Step "Rust review preferences contracts" { cargo test --manifest-path src-tauri/Cargo.toml review_preferences }
  Invoke-Step "Rust Code Review provider capability contracts" { cargo test --locked --manifest-path src-tauri/Cargo.toml review_provider --lib }
  Invoke-Step "Remote PR surface identity, lifecycle and local-action boundaries" { node scripts/verify-remote-review.mjs }
  Invoke-Step "Fixed revision full-file paths, content and lifecycle" { node scripts/verify-remote-revision-files.mjs }
  Invoke-Step "Private review availability identity, lifecycle and cancellation" { node scripts/verify-private-review.mjs }
  Invoke-Step "Private review preflight and isolated dynamic tool bridge" { cargo test --locked --manifest-path src-tauri/Cargo.toml --lib private_review }
  Invoke-Step "Rust worktree root contracts" { cargo test --manifest-path src-tauri/Cargo.toml worktree_root }
  Invoke-Step "Rust local environment file contracts" { cargo test --manifest-path src-tauri/Cargo.toml local_environment::tests }
  Invoke-Step "Rust check (cargo check)" {
    cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust unit tests (cargo test automations)" {
    cargo test --manifest-path src-tauri/Cargo.toml automations 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust review merge-base and working diff regression" {
    cargo test --manifest-path src-tauri/Cargo.toml git::merge_base_tests
  }
  Invoke-Step "Rust Git index action roundtrips" {
    cargo test --locked --manifest-path src-tauri/Cargo.toml --lib index_action_tests
  }
  Invoke-Step "Rust workspace transition and identity regression" {
    cargo test --manifest-path src-tauri/Cargo.toml --lib workspace 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust project move contracts and worktree regression" {
    cargo test --manifest-path src-tauri/Cargo.toml --lib project_ 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust isolated skill write validation regression" {
    cargo test --manifest-path src-tauri/Cargo.toml config_skills::tests::skill_writes_reject_invalid_ids_and_invalid_sources_without_changing_existing_files -- --exact
  }

  if (-not $Fast) {
    $probes = @(
      "scripts/protocol-verify/verify-appserver-shapes.mjs",
      "scripts/protocol-verify/verify-batch2-shapes.mjs",
      "scripts/protocol-verify/verify-batch3-shapes.mjs",
      "scripts/protocol-verify/verify-batch4-shapes.mjs",
      "scripts/protocol-verify/verify-attachments.mjs"
      "scripts/protocol-verify/verify-idle-turn-controls.mjs"
      "scripts/protocol-verify/verify-thread-workspace-resume.mjs"
      "scripts/protocol-verify/verify-share-history.mjs"
      "scripts/protocol-verify/verify-search-lifecycle.mjs"
      "scripts/protocol-verify/verify-project-move-roots.mjs"
      "scripts/protocol-verify/verify-archive-actions.mjs"
      "scripts/protocol-verify/verify-archive-deletion.mjs"
      "scripts/protocol-verify/verify-plugin-preparation.mjs"
      "scripts/protocol-verify/verify-plugin-management-b.mjs"
      "scripts/protocol-verify/verify-recommended-skills.mjs"
      "scripts/protocol-verify/verify-model-catalog.mjs"
      "scripts/protocol-verify/verify-model-preferences.mjs"
      "scripts/protocol-verify/verify-agent-settings.mjs"
      "scripts/protocol-verify/verify-agent-scopes.mjs"
      "scripts/protocol-verify/verify-appearance-preferences.mjs"
      "scripts/protocol-verify/verify-keyboard-number-target.mjs"
      "scripts/protocol-verify/verify-notification-preferences.mjs"
      "scripts/protocol-verify/verify-personal-instructions.mjs"
      "scripts/protocol-verify/verify-memory-preferences.mjs"
      "scripts/protocol-verify/verify-account-snapshot.mjs"
      "scripts/protocol-verify/verify-service-auth-support.mjs"
      "scripts/protocol-verify/verify-mcp-status.mjs"
      "scripts/protocol-verify/verify-mcp-settings-b.mjs"
      "scripts/protocol-verify/verify-hook-state.mjs"
      "scripts/protocol-verify/verify-git-generation-b.mjs"
      "scripts/protocol-verify/verify-external-import.mjs"
      "scripts/protocol-verify/verify-experimental-features.mjs"
    )
    foreach ($probe in $probes) {
      Invoke-Step "Protocol probe: $probe" { node $probe }
    }
  } else {
    Write-Host ""
    Write-Host "(--Fast: skipped protocol probes)" -ForegroundColor Yellow
  }

  Write-Host ""
  if ($failed.Count -eq 0) {
    Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
    exit 0
  } else {
    Write-Host ("FAILED STEPS: " + ($failed -join ", ")) -ForegroundColor Red
    exit 1
  }
} finally {
  Pop-Location
}
