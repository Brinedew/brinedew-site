param(
    [string]$FirefoxBinary = 'C:\Program Files\Mozilla Firefox\firefox.exe',
    [string]$Paper = (Join-Path $env:USERPROFILE 'Downloads\PLOS_BRCA1_BRCA2_TP53.pdf'),
    [string]$Artifacts = (Join-Path $PSScriptRoot '..\artifacts\firefox-pdf-e2e')
)

$ErrorActionPreference = 'Stop'
$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$e2eRoot = (Resolve-Path $PSScriptRoot).Path
$distRoot = Join-Path $extensionRoot 'dist'
$zip = Get-ChildItem $distRoot -Filter 'iconoplasm-firefox-v*.zip' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $zip) {
    throw 'Build the Firefox package before running the Firefox PDF E2E suite.'
}
if (-not (Test-Path -LiteralPath $FirefoxBinary -PathType Leaf)) {
    throw "Firefox binary not found: $FirefoxBinary"
}
if (-not (Test-Path -LiteralPath $Paper -PathType Leaf)) {
    throw "Paper fixture not found: $Paper"
}

New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
$xpi = Join-Path $Artifacts 'iconoplasm-firefox-under-test.xpi'
Copy-Item -LiteralPath $zip.FullName -Destination $xpi -Force

Push-Location $e2eRoot
try {
    uv sync --frozen
    uv run pytest `
        "--firefox-binary=$FirefoxBinary" `
        "--xpi=$xpi" `
        "--paper=$Paper" `
        "--artifacts=$Artifacts"
}
finally {
    Pop-Location
}
