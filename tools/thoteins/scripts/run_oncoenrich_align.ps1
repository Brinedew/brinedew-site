Param(
  [string]$Features = "Thoteins/data/proteins/features.csv",
  [string]$Out = "Thoteins/data/oncokb/alignments.csv"
)

$ErrorActionPreference = 'Stop'

function Find-Rscript {
  try {
    $r = (Get-Command Rscript -ErrorAction Stop).Source
    return $r
  } catch {
    return $null
  }
}

$rscript = Find-Rscript
if (-not $rscript) {
  Write-Host '[info] Rscript not found. Install R first.' -ForegroundColor Yellow
  Write-Host 'Option A (winget): winget install -e --id RProject.R --accept-source-agreements --accept-package-agreements'
  Write-Host 'Option B (choco):  choco install r.project -y'
  exit 1
}

Write-Host ("Using Rscript: {0}" -f $rscript)
& $rscript 'Thoteins/scripts/oncoenrich_align.R' $Features $Out
$rc = $LASTEXITCODE
Write-Host "Exit code: $rc"
if ($rc -eq 0) {
  Write-Host "Wrote: $Out"
}
exit $rc

