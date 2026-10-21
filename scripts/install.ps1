<#
.SYNOPSIS
  Installs (or removes) Shelf for the current user.

.DESCRIPTION
  Runs the installer that ./scripts/build.ps1 made (dist\Shelf_<version>_x64-setup.exe) silently: Shelf goes to
  %LOCALAPPDATA%\Programs\Shelf with a Start menu shortcut, so it shows up in Windows search. No admin rights needed.
  An earlier Shelf in that folder (including the old C# build) is replaced.
  Your library and settings (%APPDATA%\Shelf, %LOCALAPPDATA%\Shelf) are never touched, by install or by -Uninstall.

.PARAMETER Uninstall
  Remove the program, the Start menu shortcut and the start-with-Windows task.

.EXAMPLE
  ./scripts/install.ps1
#>
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:LOCALAPPDATA "Programs\Shelf"
$exe = Join-Path $target "Shelf.exe"

# A running Shelf would lock its exe.
Get-Process Shelf -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object {
    Write-Host "Closing the running Shelf..."
    $_ | Stop-Process -Force
    $_.WaitForExit(5000) | Out-Null
}

if ($Uninstall) {
    $uninstaller = Join-Path $target "uninstall.exe"
    if (Test-Path $uninstaller) {
        Start-Process $uninstaller -ArgumentList "/S" -Wait
    } else {
        # The old C# build had no uninstaller: remove its files and shortcut directly.
        $shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Shelf.lnk"
        if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    }
    schtasks /Delete /TN "Shelf" /F 2>$null | Out-Null
    Write-Host "Shelf removed. Your library is still in $env:APPDATA\Shelf if you ever reinstall."
    return
}

$setup = Get-ChildItem (Join-Path $root "dist") -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1
if (-not $setup) { throw "No installer found in $root\dist. Run ./scripts/build.ps1 first." }

Start-Process $setup.FullName -ArgumentList "/S" -Wait
if (-not (Test-Path $exe)) { throw "The installer finished but $exe isn't there." }
Write-Host "Installed: $exe"
Write-Host "Start menu: search for 'Shelf'. Command line: $target\shelf-cli.exe"
