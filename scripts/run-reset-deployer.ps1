[CmdletBinding()]
param([switch]$VerifyReadiness)

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$evidenceDirectory = Join-Path $repoDirectory 'artifacts\reset-deploy'
$deadlineRunner = Join-Path (Split-Path -Parent $repoDirectory) 'scripts\Invoke-HardTimeout.ps1'
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$nodeArguments = @((Join-Path $PSScriptRoot 'dispatch-production-in-reset-window.mjs'))
if ($VerifyReadiness) { $nodeArguments += '--verify-readiness' }
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$logPath = Join-Path $evidenceDirectory 'dispatch.log'
try {
    $result = & $deadlineRunner -TimeoutSeconds 180 -FilePath $nodePath -ArgumentList $nodeArguments -WorkingDirectory $repoDirectory
    $line = '{0} {1}' -f [DateTime]::UtcNow.ToString('o'), ($result -join ' ')
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    Write-Output $line
}
catch {
    # Child stderr is intentionally not copied: it may contain transport data.
    # The Node executor retains its safe error and any dispatch reservation.
    $line = '{0} Reset executor failed. Inspect retained state; failure owner: Linear B-756 / current Codex recovery task.' -f [DateTime]::UtcNow.ToString('o')
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    Write-Output $line
    exit 1
}
