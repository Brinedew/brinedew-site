[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$RequiredHeadSha,
    [Parameter(Mandatory)][ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$ResetDay
)

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$evidenceDirectory = Join-Path $repoDirectory 'artifacts\reset-deploy'
$intentPath = Join-Path $evidenceDirectory 'intent.json'
$taskName = 'Iconoplasm Deploy Window Dispatcher'
$resetUtc = [DateTimeOffset]::ParseExact("${ResetDay}T00:00:00+00:00", 'yyyy-MM-ddTHH:mm:sszzz', [Globalization.CultureInfo]::InvariantCulture)
if ($resetUtc.UtcDateTime.Date -lt [DateTime]::UtcNow.Date) { throw 'The reset day is already past.' }
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
if (Test-Path -LiteralPath $intentPath) {
    $previousIntent = Get-Content -LiteralPath $intentPath -Raw | ConvertFrom-Json
    if ($previousIntent.required_head_sha -ne $RequiredHeadSha -or $previousIntent.reset_day -ne $ResetDay) {
        throw 'An armed release already exists. Reconcile its retained outcome before changing the intent.'
    }
}
$intent = [ordered]@{
    version = 2
    required_head_sha = $RequiredHeadSha
    reset_day = $ResetDay
    deadline = $resetUtc.AddMinutes(30).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    failure_destination = 'Linear B-756 / current Codex recovery task'
}
$intent | ConvertTo-Json | Set-Content -LiteralPath "$intentPath.tmp" -Encoding utf8
Move-Item -LiteralPath "$intentPath.tmp" -Destination $intentPath -Force
$pwshPath = Join-Path $PSHOME 'pwsh.exe'
$runnerPath = Join-Path $PSScriptRoot 'run-reset-deployer.ps1'
$action = New-ScheduledTaskAction -Execute $pwshPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}"' -f $runnerPath) -WorkingDirectory $repoDirectory
$trigger = New-ScheduledTaskTrigger -Daily -At $resetUtc.LocalDateTime
$repeatingTrigger = New-ScheduledTaskTrigger -Once -At $resetUtc.LocalDateTime -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Minutes 390)
$trigger.Repetition = $repeatingTrigger.Repetition
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'previous-task.xml') -Encoding utf8
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
} else {
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Canonical reset release with retained dispatch reservation, exact CI and full activation proofs. Failure owner: B-756.' | Out-Null
}
Enable-ScheduledTask -TaskName $taskName | Out-Null
$installed = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[ordered]@{
    task = $taskName
    required_head_sha = $RequiredHeadSha
    reset_utc = $resetUtc.ToString('o')
    next_run_local = $info.NextRunTime.ToString('o')
    executable = $installed.Actions[0].Execute
    arguments = $installed.Actions[0].Arguments
    wake_to_run = $installed.Settings.WakeToRun
    execution_deadline = $installed.Settings.ExecutionTimeLimit
    repeat_interval = $installed.Triggers[0].Repetition.Interval
} | ConvertTo-Json
