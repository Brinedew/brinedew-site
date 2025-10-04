Param(
  [Parameter(Position=0)]
  [string]$CsvPath
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $here

$logDir = Join-Path $here '..' | Join-Path -ChildPath 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$log = Join-Path $logDir 'batch_builder_pwsh.log'
"==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==== " | Add-Content -Path $log
"PWD: $(Get-Location)" | Add-Content -Path $log
"ARG1: $CsvPath" | Add-Content -Path $log

function Find-Python {
  try {
    $py = (Get-Command py -ErrorAction Stop).Source
    return @{ exe = 'py'; args = '-3' }
  } catch {}
  try {
    $python = (Get-Command python -ErrorAction Stop).Source
    return @{ exe = $python; args = '' }
  } catch {}
  return $null
}

$pyInfo = Find-Python
if (-not $pyInfo) {
  Write-Host '[error] Python 3 not found. Please install from https://www.python.org/' -ForegroundColor Red
  '[error] Python 3 not found.' | Add-Content -Path $log
  Read-Host 'Press Enter to close'
  exit 1
}
"PY_EXE: $($pyInfo.exe)" | Add-Content -Path $log
"PY_ARGS: $($pyInfo.args)" | Add-Content -Path $log

$outPath = Join-Path $here '..' | Join-Path -ChildPath 'data/proteins/batch_top100.csv'

if ([string]::IsNullOrWhiteSpace($CsvPath)) {
  Write-Host "[info] Online mode: fetching top 100 human (Swiss-Prot) via UniProt"
  Write-Host "        Output: $outPath"
  'MODE: online' | Add-Content -Path $log
  $args = @()
  if ($pyInfo.args) { $args += $pyInfo.args }
  $args += '-u','build_protein_batch.py','--limit','100','--taxon','9606','--include-mapped','--out',"$outPath"
  "CMD: $($pyInfo.exe) $($args -join ' ')" | Add-Content -Path $log
  & $pyInfo.exe @args 2>&1 | Tee-Object -FilePath $log -Append
} else {
  Write-Host "[info] Offline mode: converting downloaded SPARQL CSV"
  Write-Host "        Source: $CsvPath"
  Write-Host "        Output: $outPath"
  'MODE: offline' | Add-Content -Path $log
  $args = @()
  if ($pyInfo.args) { $args += $pyInfo.args }
  $args += '-u','build_protein_batch.py','--from-sparql-csv',"$CsvPath",'--out',"$outPath",'--ids-only'
  "CMD: $($pyInfo.exe) $($args -join ' ')" | Add-Content -Path $log
  & $pyInfo.exe @args 2>&1 | Tee-Object -FilePath $log -Append
}

$rc = $LASTEXITCODE
Write-Host ""
Write-Host ("Exit code: {0}" -f $rc)
Write-Host ("CSV path (if success): {0}" -f (Resolve-Path -LiteralPath $outPath -ErrorAction SilentlyContinue))
("Exit code: {0}" -f $rc) | Add-Content -Path $log
("CSV: {0}" -f $outPath) | Add-Content -Path $log
Write-Host ''
Read-Host 'Press Enter to close'
exit $rc

