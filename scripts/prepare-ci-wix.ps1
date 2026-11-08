param([Parameter(Mandatory)][string]$ToolsRoot)

$ErrorActionPreference = 'Stop'
# Match the WiX URL, digest and directory in the locked Tauri CLI bundler.
$expectedHash = '6AC824E1642D6F7277D0ED7EA09411A508F6116BA6FAE0AA5F2C7DAA2FF43D31'
$asset = 'repos/wixtoolset/wix3/releases/assets/158158052'
$destination = Join-Path $ToolsRoot 'WixTools314'
$staging = Join-Path $ToolsRoot "wix-staging-$([guid]::NewGuid())"
$archive = Join-Path $staging 'wix314-binaries.zip'
$extracted = Join-Path $staging 'verified'
New-Item -ItemType Directory -Path $staging -Force | Out-Null

for ($attempt = 1; $attempt -le 3; $attempt++) {
    gh api --header 'Accept: application/octet-stream' $asset > $archive
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 3) { throw "WiX asset download failed after $attempt attempts." }
    Start-Sleep -Seconds (5 * $attempt)
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'WiX archive SHA-256 differs from the locked Tauri bundler.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $extracted
$required = 'candle.exe', 'candle.exe.config', 'darice.cub', 'light.exe', 'light.exe.config',
    'wconsole.dll', 'winterop.dll', 'wix.dll', 'WixUIExtension.dll', 'WixUtilExtension.dll'
foreach ($file in $required) {
    $verifiedFile = Join-Path $extracted $file
    if (!(Test-Path -LiteralPath $verifiedFile -PathType Leaf)) { throw "WiX archive lacks $file." }
}
if (Test-Path -LiteralPath $destination) {
    throw "WiX tools directory already exists: $destination"
}
Move-Item -LiteralPath $extracted -Destination $destination
Remove-Item -LiteralPath $archive
Remove-Item -LiteralPath $staging
Write-Output "Verified WiX $expectedHash at $destination"
