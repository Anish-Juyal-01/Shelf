<#
.SYNOPSIS
  Builds, tests and packages Shelf.

.DESCRIPTION
  1. Installs UI dependencies (if needed) and runs the UI unit tests (Vitest).
  2. Runs the Rust tests (cargo test).
  3. Builds shelf-cli, then the app and its per-user installer with Tauri (the UI is built into the app).
  4. Copies the results to ./dist: Shelf_<version>_x64-setup.exe, Shelf.exe and shelf-cli.exe.

.PARAMETER SkipTests
  Skip both test suites.

.EXAMPLE
  ./scripts/build.ps1
#>
param([switch]$SkipTests)

# Not "Stop": Windows PowerShell 5 would treat npm/cargo notices on stderr as errors. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Step "Preparing the UI"
Push-Location ui
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; Check "npm ci" }
if (-not $SkipTests) { npm test; Check "UI tests" }
Pop-Location

if (-not $SkipTests) {
    Step "Running Rust tests"
    cargo test --workspace; Check "cargo test"
}

Step "Building shelf-cli"
cargo build --release -p shelf-cli; Check "CLI build"
# Tauri bundles it next to Shelf.exe; it wants the target triple in the file name.
$triple = (rustc -vV | Select-String "^host: (.+)$").Matches[0].Groups[1].Value
New-Item -ItemType Directory -Force src-tauri\binaries | Out-Null
Copy-Item target\release\shelf-cli.exe "src-tauri\binaries\shelf-cli-$triple.exe" -Force

Step "Building Shelf and its installer"
# Run from the repo root (not through npx --prefix, which would run the UI build from inside ui\).
& (Join-Path $root "ui\node_modules\.bin\tauri.cmd") build --config src-tauri/tauri.bundle.json; Check "tauri build"

$out = Join-Path $root "dist"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
$setup = Get-ChildItem target\release\bundle\nsis\*-setup.exe | Sort-Object LastWriteTime | Select-Object -Last 1
Copy-Item $setup.FullName $out
Copy-Item target\release\Shelf.exe $out
Copy-Item target\release\shelf-cli.exe $out

Step "Done"
Get-ChildItem $out | ForEach-Object { "{0,8:N1} MB  {1}" -f ($_.Length / 1MB), $_.FullName }
Write-Host "`nInstall it for this user (Start menu, no admin): ./scripts/install.ps1  (or run the setup exe)"
