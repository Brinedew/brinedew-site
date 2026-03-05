# Upload Iconoplasm color artifacts to Cloudflare KV.
# Run from the Website/ directory after generating artifacts.
#
# Usage: pwsh scripts/upload-iconoplasm-colors.ps1

param(
    [string]$ArtifactDir = "D:\Coding\Datasets\iconoplasm\artifacts",
    [string]$Env = "",  # empty = production, "staging" = staging
    [switch]$Remote = $true
)

$ErrorActionPreference = "Stop"

$manifestPath = Join-Path $ArtifactDir "colors-manifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest not found at $manifestPath. Run export_colors_artifact.py first."
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$hash = $manifest.current_hash
$artifactFilename = $manifest.filename
$artifactPath = Join-Path $ArtifactDir $artifactFilename

if (-not (Test-Path $artifactPath)) {
    Write-Error "Artifact not found at $artifactPath"
    exit 1
}

Write-Host "Uploading Iconoplasm color artifacts to KV..."
Write-Host "  Manifest hash: $hash"
Write-Host "  Artifact: $artifactFilename ($([math]::Round((Get-Item $artifactPath).Length / 1024, 1)) KB)"

$envFlag = if ($Env) { "--env", $Env } else { @() }
$remoteFlag = if ($Remote) { "--remote" } else { "--local" }

# Upload the fingerprinted artifact
Write-Host "`nUploading artifact as KV key: iconoplasm:colors:$hash"
npx wrangler kv key put "iconoplasm:colors:$hash" --path $artifactPath --binding KV @envFlag $remoteFlag
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to upload artifact"; exit 1 }

# Upload the manifest
Write-Host "Uploading manifest as KV key: iconoplasm:colors-manifest"
npx wrangler kv key put "iconoplasm:colors-manifest" --path $manifestPath --binding KV @envFlag $remoteFlag
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to upload manifest"; exit 1 }

Write-Host "`nDone. Artifacts are live."
Write-Host "  Manifest URL: https://iconoplasm.brinedew.bio/api/colors/manifest"
Write-Host "  Artifact URL: https://iconoplasm.brinedew.bio/api/colors/$artifactFilename"
