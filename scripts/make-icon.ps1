<#
.SYNOPSIS
  Renders the Shelf app icon (multi-resolution .ico with PNG frames) with GDI+: three book spines on a shelf,
  on a bottle-green tile. Matches ui/public/icon.svg.
  Output: src-tauri/icons/icon.ico and ui/public/icon.png
#>
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$tile  = [System.Drawing.Color]::FromArgb(255, 0x1F, 0x3A, 0x2E)
$cream = [System.Drawing.Color]::FromArgb(255, 0xE9, 0xDF, 0xC8)
$brass = [System.Drawing.Color]::FromArgb(255, 0xC9, 0xA5, 0x5A)
$red   = [System.Drawing.Color]::FromArgb(255, 0xB5, 0x47, 0x3A)

function RoundRect($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose()
}

function Render-Icon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = if ($size -le 20) { 'None' } else { 'AntiAlias' }
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 64.0
    $tileBrush = New-Object System.Drawing.SolidBrush $tile
    $creamBrush = New-Object System.Drawing.SolidBrush $cream
    $brassBrush = New-Object System.Drawing.SolidBrush $brass
    $redBrush = New-Object System.Drawing.SolidBrush $red

    RoundRect $g $tileBrush (2 * $s) (2 * $s) (60 * $s) (60 * $s) ([math]::Max(1, 12 * $s))
    # Small sizes: chunkier spines so they survive 16 px.
    if ($size -le 20) {
        $g.FillRectangle($creamBrush, [int](13 * $s), [int](15 * $s), [int][math]::Max(2, 9 * $s), [int](32 * $s))
        $g.FillRectangle($brassBrush, [int](25 * $s), [int](11 * $s), [int][math]::Max(3, 11 * $s), [int](36 * $s))
        $g.FillRectangle($redBrush, [int](39 * $s), [int](18 * $s), [int][math]::Max(2, 9 * $s), [int](29 * $s))
        $g.FillRectangle($creamBrush, [int](10 * $s), [int](47 * $s), [int](44 * $s), [int][math]::Max(1, 5 * $s))
    } else {
        RoundRect $g $creamBrush (14 * $s) (16 * $s) (8 * $s) (30 * $s) (1.5 * $s)
        RoundRect $g $brassBrush (24 * $s) (12 * $s) (10 * $s) (34 * $s) (1.5 * $s)
        $state = $g.Save()
        $g.TranslateTransform(39.5 * $s, 32.5 * $s)
        $g.RotateTransform(-8)
        RoundRect $g $redBrush (-3.5 * $s) (-13.5 * $s) (7 * $s) (27 * $s) (1.5 * $s)
        $g.Restore($state)
        RoundRect $g $creamBrush (12 * $s) (46 * $s) (40 * $s) (5 * $s) (1.5 * $s)
    }
    $g.Dispose()
    return $bmp
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) {
    $bmp = Render-Icon $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($sz -eq 256) {
        $uiPublic = Join-Path $Root 'ui/public'
        New-Item -ItemType Directory -Force $uiPublic | Out-Null
        $bmp.Save((Join-Path $uiPublic 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bmp.Dispose()
    [pscustomobject]@{ Size = $sz; Bytes = $ms.ToArray() }
}

# ICO container: ICONDIR + ICONDIRENTRY[] + PNG payloads.
$out = Join-Path $Root 'src-tauri/icons/icon.ico'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
    $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$f.Bytes.Length); $w.Write([UInt32]$offset)
    $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $w.Write($f.Bytes) }
$w.Dispose()
Write-Host "Wrote $out"
