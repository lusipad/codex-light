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
  Invoke-Step "Keyboard shortcut regression" { node scripts/verify-shortcuts.mjs }
  Invoke-Step "Thread content regression" { node scripts/verify-thread-content.mjs }
  Invoke-Step "Clipboard failure regression" { node scripts/verify-clipboard.mjs }
  Invoke-Step "Approval lifecycle regression" { node scripts/verify-approval.mjs }
  Invoke-Step "Turn controls regression" { node scripts/verify-turn-controls.mjs }
  Invoke-Step "Thread queue regression" { node scripts/verify-queue.mjs }
  Invoke-Step "Thread identity replay" { node scripts/verify-thread-timeline.mjs }
  Invoke-Step "TypeScript typecheck (tsc --noEmit)" { npx tsc --noEmit }
  Invoke-Step "Frontend production build (vite)" { npm run build }
  Invoke-Step "Rust check (cargo check)" {
    cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }
  }
  Invoke-Step "Rust unit tests (cargo test automations)" {
    cargo test --manifest-path src-tauri/Cargo.toml automations 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
  }

  if (-not $Fast) {
    $probes = @(
      "scripts/protocol-verify/verify-appserver-shapes.mjs",
      "scripts/protocol-verify/verify-batch2-shapes.mjs",
      "scripts/protocol-verify/verify-batch3-shapes.mjs",
      "scripts/protocol-verify/verify-batch4-shapes.mjs",
      "scripts/protocol-verify/verify-attachments.mjs"
      "scripts/protocol-verify/verify-idle-turn-controls.mjs"
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
