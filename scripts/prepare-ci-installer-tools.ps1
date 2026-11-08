param([Parameter(Mandatory)][string]$ToolsRoot)

$ErrorActionPreference = 'Stop'
function Get-VerifiedReleaseAsset($Asset, $Path, $Sha256) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        gh api --header 'Accept: application/octet-stream' $Asset > $Path
        if ($LASTEXITCODE -eq 0) { break }
        if ($attempt -eq 3) { throw "Installer tool download failed: $Asset" }
        Start-Sleep -Seconds (5 * $attempt)
    }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Installer tool SHA-256 mismatch: $Asset"
    }
}

# Keep the releases, cache paths and required files aligned with Tauri CLI 2.12.3.
$wixDestination = Join-Path $ToolsRoot 'WixTools314'
$nsisDestination = Join-Path $ToolsRoot 'NSIS'
if ((Test-Path -LiteralPath $wixDestination) -or (Test-Path -LiteralPath $nsisDestination)) {
    throw "Installer tools already exist in $ToolsRoot."
}
$staging = Join-Path $ToolsRoot "installer-staging-$([guid]::NewGuid())"
$wixZip = Join-Path $staging 'wix314-binaries.zip'
$nsisZip = Join-Path $staging 'nsis-3.13.zip'
$wix = Join-Path $staging 'wix'
$nsis = Join-Path $staging 'nsis-3.13'
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Get-VerifiedReleaseAsset 'repos/wixtoolset/wix3/releases/assets/158158052' $wixZip '6AC824E1642D6F7277D0ED7EA09411A508F6116BA6FAE0AA5F2C7DAA2FF43D31'
Get-VerifiedReleaseAsset 'repos/tauri-apps/binary-releases/releases/assets/623832696' $nsisZip 'BA63DFFC4410EE89193E1CB5A41989991BD77C61068DA17E3156D136B7B0B3D8'
Expand-Archive -LiteralPath $wixZip -DestinationPath $wix
Expand-Archive -LiteralPath $nsisZip -DestinationPath $staging
$pluginFolder = Join-Path $nsis 'Plugins/x86-unicode/additional'
New-Item -ItemType Directory -Path $pluginFolder -Force | Out-Null
$plugin = Join-Path $pluginFolder 'nsis_tauri_utils.dll'
Get-VerifiedReleaseAsset 'repos/tauri-apps/nsis-tauri-utils/releases/assets/345882097' $plugin '5BA143B5DB4A87D32D6E7802E033330AAE56CBCEABE0D1E3BA41948385AD4709'

$wixFiles = 'candle.exe', 'candle.exe.config', 'darice.cub', 'light.exe', 'light.exe.config',
    'wconsole.dll', 'winterop.dll', 'wix.dll', 'WixUIExtension.dll', 'WixUtilExtension.dll'
$nsisFiles = 'makensis.exe', 'Bin/makensis.exe', 'Stubs/lzma-x86-unicode', 'Stubs/lzma_solid-x86-unicode',
    'Include/MUI2.nsh', 'Include/FileFunc.nsh', 'Include/x64.nsh', 'Include/nsDialogs.nsh', 'Include/WinMessages.nsh',
    'Include/Win/COM.nsh', 'Include/Win/Propkey.nsh', 'Include/Win/RestartManager.nsh'
foreach ($file in (($wixFiles | ForEach-Object { Join-Path $wix $_ }) + ($nsisFiles | ForEach-Object { Join-Path $nsis $_ }))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Installer tool archive lacks $file." }
}
if ((Get-FileHash -LiteralPath (Join-Path $nsis 'NSIS.exe') -Algorithm SHA1).Hash -ne '6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2' -or
    (Get-FileHash -LiteralPath $plugin -Algorithm SHA1).Hash -ne '75197FEE3C6A814FE035788D1C34EAD39349B860') {
    throw 'NSIS contents differ from the locked Tauri bundler.'
}
Move-Item -LiteralPath $wix -Destination $wixDestination
Move-Item -LiteralPath $nsis -Destination $nsisDestination
Remove-Item -LiteralPath $wixZip, $nsisZip
Remove-Item -LiteralPath $staging
Write-Output 'Verified WiX 3.14.1, NSIS 3.13 and NSIS Tauri plugin 0.5.3'
