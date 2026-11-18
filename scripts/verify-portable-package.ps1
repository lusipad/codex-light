param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
$reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead((Resolve-Path -LiteralPath $ExecutablePath).Path))
try {
  if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'Portable executable has no MZ header' }
  $reader.BaseStream.Position = 0x3c
  $peOffset = $reader.ReadUInt32()
  if ($peOffset + 6 -gt $reader.BaseStream.Length) { throw 'Portable executable has an invalid PE header offset' }
  $reader.BaseStream.Position = $peOffset
  if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) {
    throw 'Portable executable is not a Windows x64 PE'
  }
} finally {
  $reader.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
try {
  $entry = $archive.GetEntry('Codex-Light.exe')
  if (!$entry) { throw 'Portable archive is missing Codex-Light.exe' }
  $stream = $entry.Open()
  try {
    $packedHash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash
  } finally {
    $stream.Dispose()
  }
  $executableHash = (Get-FileHash -LiteralPath $ExecutablePath -Algorithm SHA256).Hash
  if ($packedHash -ne $executableHash) { throw 'Portable archive executable differs from the standalone executable' }
} finally {
  $archive.Dispose()
}
Write-Host 'PASS portable archive contains the matching Windows x64 executable'
