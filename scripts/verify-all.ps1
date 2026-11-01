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
  Invoke-Step "Titlebar native window state component regression" { node scripts/verify-titlebar-window-state.mjs }
  Invoke-Step "Sidebar project disclosure component regression" { node scripts/verify-sidebar-projects.mjs }
  Invoke-Step "Sidebar thread context menu regression" { node scripts/verify-sidebar-thread-menu.mjs }
  Invoke-Step "Sidebar section toggle and RPC regression" { node scripts/verify-sidebar-section-toggle.mjs }
  Invoke-Step "Sidebar section creation from session menu regression" { node scripts/verify-sidebar-section-create.mjs }
  Invoke-Step "Profile identity and keyboard component regression" { node scripts/verify-profile-menu.mjs }
  Invoke-Step "Help submenu and keyboard dialog regression" { node scripts/verify-help-menu.mjs }
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
  Invoke-Step "Composer draft identity and persistence regression" { node scripts/verify-composer-drafts.mjs }
  Invoke-Step "Composer attachment draft scope regression" { node scripts/verify-composer-attachment-drafts.mjs }
  Invoke-Step "Unit 01A Public Shell parity" { node scripts/verify-unit-01a-shell.mjs }
  Invoke-Step "Unit 01 Home Shell & Composer parity" { node scripts/verify-unit-01-home-shell.mjs }
  Invoke-Step "Unit 02 Thread Basics parity" { node scripts/verify-unit-02-thread-basics.mjs }
  Invoke-Step "Duplicate user message regression" { node scripts/verify-duplicate-message-fix.mjs }
  Invoke-Step "Reasoning flow & rendering parity" { node scripts/verify-reasoning-rendering.mjs }
  Invoke-Step "Keyboard shortcut regression" { node scripts/verify-shortcuts.mjs }
  Invoke-Step "Composer follow-up keyboard regression" { node scripts/verify-composer-keys.mjs }
  Invoke-Step "Thread content regression" { node scripts/verify-thread-content.mjs }
  Invoke-Step "Clipboard failure regression" { node scripts/verify-clipboard.mjs }
  Invoke-Step "Approval lifecycle regression" { node scripts/verify-approval.mjs }
  Invoke-Step "Turn controls regression" { node scripts/verify-turn-controls.mjs }
  Invoke-Step "Thread queue regression" { node scripts/verify-queue.mjs }
  Invoke-Step "Thread identity replay" { node scripts/verify-thread-timeline.mjs }
  Invoke-Step "Execution item stream regression" { node scripts/verify-execution-items.mjs }
  Invoke-Step "Tool cards & execution item parity" { node scripts/verify-tool-cards.mjs }
  Invoke-Step "Plan & Goal lifecycle parity" { node scripts/verify-plan-goal.mjs }
  Invoke-Step "Misc tool cards (Image/Sleep/Search) parity" { node scripts/verify-misc-tools.mjs }
  Invoke-Step "Projects & Thread Sections parity" { node scripts/verify-projects-sections.mjs }
  Invoke-Step "Files worksurface & live editor parity" { node scripts/verify-files-worksurface.mjs }
  Invoke-Step "Changes & Git worksurface parity" { node scripts/verify-git-worksurface.mjs }
  Invoke-Step "Terminal & layout resizer parity" { node scripts/verify-terminal-layout.mjs }
  Invoke-Step "Search & command palette parity" { node scripts/verify-search-palette.mjs }
  Invoke-Step "Activity & Inbox parity" { node scripts/verify-activity-inbox.mjs }
  Invoke-Step "Scheduled & Automations parity" { node scripts/verify-scheduled-automations.mjs }
  Invoke-Step "Worktrees worksurface parity" { node scripts/verify-worktrees.mjs }
  Invoke-Step "Plugins marketplace & management parity" { node scripts/verify-plugins.mjs }
  Invoke-Step "Skills management & editor parity" { node scripts/verify-skills.mjs }
  Invoke-Step "Code review targets parity" { node scripts/verify-code-review.mjs }
  Invoke-Step "Archive lifecycle parity" { node scripts/verify-archive.mjs }
  Invoke-Step "Settings center 26 partitions parity" { node scripts/verify-settings-partitions.mjs }
  Invoke-Step "Extended worksurfaces & cross-page parity (17-23)" { node scripts/verify-extended-worksurfaces.mjs }
  Invoke-Step "TypeScript typecheck (tsc --noEmit)" { npx tsc --noEmit }
  Invoke-Step "Frontend production build (vite)" { npm run build }
  Invoke-Step "Rust check (cargo check)" {
    cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust unit tests (cargo test automations)" {
    cargo test --manifest-path src-tauri/Cargo.toml automations 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust workspace transition and identity regression" {
    cargo test --manifest-path src-tauri/Cargo.toml --lib workspace 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust project move contracts and worktree regression" {
    cargo test --manifest-path src-tauri/Cargo.toml --lib project_ 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
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
      "scripts/protocol-verify/verify-project-move-roots.mjs"
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
