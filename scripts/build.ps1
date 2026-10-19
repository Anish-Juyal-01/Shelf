<#
.SYNOPSIS
  Builds, tests and publishes Shelf.

.DESCRIPTION
  1. Installs UI dependencies (if needed) and builds the React UI (ui/dist, embedded into Shelf.exe).
  2. Runs the UI unit tests (Vitest) and the .NET unit tests (xUnit).
  3. Publishes a single self-contained Shelf.exe for win-x64 to ./dist, and shelf-cli.exe to ./dist/tools.

.PARAMETER SkipTests
  Skip both test suites.

.PARAMETER Runtime
  .NET runtime identifier to publish for (default win-x64; win-arm64 is also supported).

.EXAMPLE
  ./scripts/build.ps1
#>
param(
    [switch]$SkipTests,
    [string]$Runtime = "win-x64"
)

# Not "Stop": Windows PowerShell 5 would treat npm/dotnet notices on stderr as errors. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Step "Building UI"
Push-Location ui
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; Check "npm ci" }
npm run build; Check "UI build"
if (-not $SkipTests) { npm test; Check "UI tests" }
Pop-Location

if (-not $SkipTests) {
    Step "Running .NET tests"
    dotnet test tests/Shelf.Core.Tests -c Release --nologo; Check "dotnet test"
}

Step "Publishing Shelf ($Runtime)"
$out = Join-Path $root "dist"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

# Carries its own .NET, so it runs on any Windows 10/11 PC. Not compressed inside the exe: that would make every
# launch unpack the runtime into memory.
dotnet publish src/Shelf.App/Shelf.App.csproj -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -p:SatelliteResourceLanguages=en -p:SkipUiBuild=true `
    -o $out --nologo
Check "dotnet publish"

dotnet publish src/Shelf.Cli/Shelf.Cli.csproj -c Release -r $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o (Join-Path $out "tools") --nologo
Check "CLI publish"

# XML IntelliSense docs from NuGet packages are not needed at runtime.
Get-ChildItem $out -Filter *.xml -Recurse | Remove-Item -Force

Step "Done"
foreach ($file in @((Join-Path $out "Shelf.exe"), (Join-Path $out "tools\shelf-cli.exe"))) {
    "{0,8:N1} MB  {1}" -f ((Get-Item $file).Length / 1MB), $file
}
Write-Host "`nInstall it for this user (Start menu shortcut): ./scripts/install.ps1"
