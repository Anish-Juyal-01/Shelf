<#
.SYNOPSIS
  Installs (or removes) Shelf for the current user.

.DESCRIPTION
  Copies dist\Shelf.exe to %LOCALAPPDATA%\Programs\Shelf and adds a Start menu shortcut, so Shelf shows up in
  Windows search. No admin rights needed. Run ./scripts/build.ps1 first.
  Your library and settings (%APPDATA%\Shelf, %LOCALAPPDATA%\Shelf) are never touched, by install or by -Uninstall.

.PARAMETER Uninstall
  Remove the program folder and the Start menu shortcut (and the start-with-Windows task, if it was turned on).

.EXAMPLE
  ./scripts/install.ps1
#>
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:LOCALAPPDATA "Programs\Shelf"
$exe = Join-Path $target "Shelf.exe"
$shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Shelf.lnk"

# A running Shelf would lock its exe.
Get-Process Shelf -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object {
    Write-Host "Closing the running Shelf..."
    $_ | Stop-Process -Force
    $_.WaitForExit(5000) | Out-Null
}

if ($Uninstall) {
    if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    schtasks /Delete /TN "Shelf" /F 2>$null | Out-Null
    Write-Host "Shelf removed. Your library is still in $env:APPDATA\Shelf if you ever reinstall."
    return
}

$built = Join-Path $root "dist\Shelf.exe"
if (-not (Test-Path $built)) { throw "No build found at $built. Run ./scripts/build.ps1 first." }

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item $built $exe -Force
$cli = Join-Path $root "dist\tools\shelf-cli.exe"
if (Test-Path $cli) { Copy-Item $cli (Join-Path $target "shelf-cli.exe") -Force }

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $target
$link.IconLocation = "$exe,0"
$link.Description = "Every game on your PC"
$link.Save()

Write-Host "Installed: $exe"
Write-Host "Start menu: $shortcut  (search for 'Shelf')"
