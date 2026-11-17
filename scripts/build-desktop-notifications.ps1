param([Parameter(Mandatory=$true)][string]$OutDir, [switch]$Test)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'MSVC x64 build tools are required' }
$vcvars = Join-Path $installation 'VC/Auxiliary/Build/vcvars64.bat'
$source = Join-Path $repository 'src-tauri/native/desktop_notifications.cpp'
$output = [IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$object = Join-Path $output 'desktop_notifications.obj'
$library = Join-Path $output 'desktop_notifications.lib'
$fontSource = Join-Path $repository 'src-tauri/native/system_fonts.cpp'
$fontObject = Join-Path $output 'system_fonts.obj'
$fontLibrary = Join-Path $output 'system_fonts.lib'
$appshotSource = Join-Path $repository 'src-tauri/native/appshots.cpp'
$appshotObject = Join-Path $output 'appshots.obj'
$appshotLibrary = Join-Path $output 'appshots.lib'
$entrySource = Join-Path $repository 'src-tauri/native/appshots_entry_native.cpp'
$entryObject = Join-Path $output 'appshots_entry_native.obj'
$entryLibrary = Join-Path $output 'appshots_entry_native.lib'
# Paths originate from this checked-out repository and OUT_DIR; cmd quoting is
# needed for MSVC's vcvars environment, never accept application/user content here.
if (($source + $object + $library + $fontSource + $fontObject + $fontLibrary + $appshotSource + $appshotObject + $appshotLibrary + $entrySource + $entryObject + $entryLibrary + $vcvars).Contains('"')) { throw 'Build paths cannot contain double quotes' }
$batch = Join-Path $output 'build-desktop-notifications.cmd'
# C++/WinRT needs the standard C++20 coroutine path: MSVC 14.51 rejects
# its C++17 fallback to experimental/coroutine. Keep both compiles aligned.
$testCommands = ''
if ($Test) {
    $testSource = Join-Path $repository 'src-tauri/native/desktop_notifications_test.cpp'
    $testObject = Join-Path $output 'desktop_notifications_test.obj'
    $testExe = Join-Path $output 'desktop_notifications_test.exe'
    $entryTestSource = Join-Path $repository 'src-tauri/native/appshots_entry_native_test.cpp'
    $entryTestObject = Join-Path $output 'appshots_entry_native_test.obj'
    $entryTestExe = Join-Path $output 'appshots_entry_native_test.exe'
    $testCommands = @"
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 "$testSource" /Fo"$testObject" /Fe"$testExe" /link windowsapp.lib ole32.lib propsys.lib shell32.lib uuid.lib
if errorlevel 1 exit /b %errorlevel%
"$testExe"
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 "$entryTestSource" /Fo"$entryTestObject" /Fe"$entryTestExe" /link user32.lib wtsapi32.lib
if errorlevel 1 exit /b %errorlevel%
"$entryTestExe"
if errorlevel 1 exit /b %errorlevel%
"@
}
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 /c "$source" /Fo"$object"
if errorlevel 1 exit /b %errorlevel%
lib.exe /nologo /OUT:"$library" "$object"
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 /c "$fontSource" /Fo"$fontObject"
if errorlevel 1 exit /b %errorlevel%
lib.exe /nologo /OUT:"$fontLibrary" "$fontObject"
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 /c "$appshotSource" /Fo"$appshotObject"
if errorlevel 1 exit /b %errorlevel%
lib.exe /nologo /OUT:"$appshotLibrary" "$appshotObject"
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /std:c++20 /EHsc /O2 /MD /utf-8 /c "$entrySource" /Fo"$entryObject"
if errorlevel 1 exit /b %errorlevel%
lib.exe /nologo /OUT:"$entryLibrary" "$entryObject"
if errorlevel 1 exit /b %errorlevel%
$testCommands
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $batch -Encoding ascii
& $env:ComSpec /d /c "`"$batch`""
if ($LASTEXITCODE -ne 0) { throw "Native notification adapter build failed: $LASTEXITCODE" }
