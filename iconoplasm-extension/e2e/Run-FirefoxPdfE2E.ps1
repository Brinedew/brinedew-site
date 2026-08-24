param(
    [string]$FirefoxBinary = 'C:\Program Files\Mozilla Firefox\firefox.exe',
    [string]$Paper = (Join-Path $env:USERPROFILE 'Downloads\PLOS_BRCA1_BRCA2_TP53.pdf'),
    [string]$Artifacts = (Join-Path $PSScriptRoot '..\artifacts\firefox-pdf-e2e')
)

$ErrorActionPreference = 'Stop'
$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$e2eRoot = (Resolve-Path $PSScriptRoot).Path
$validationZip = Join-Path $extensionRoot 'dist\validation\firefox\iconoplasm-firefox-validation.zip'
if (-not (Test-Path -LiteralPath $validationZip -PathType Leaf)) {
    throw 'Firefox validation package not found. Run pnpm run package:iconoplasm-firefox before the Firefox PDF E2E suite.'
}
if (-not (Test-Path -LiteralPath $FirefoxBinary -PathType Leaf)) {
    throw "Firefox binary not found: $FirefoxBinary"
}
if (-not (Test-Path -LiteralPath $Paper -PathType Leaf)) {
    throw "Paper fixture not found: $Paper"
}

New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
$xpi = Join-Path $Artifacts 'iconoplasm-firefox-under-test.xpi'
Copy-Item -LiteralPath $validationZip -Destination $xpi -Force

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
