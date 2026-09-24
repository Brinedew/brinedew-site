# B-830: registers the one Windows scheduled task that runs
# scripts/backup-d1-rotation.mjs. Re-running replaces the task in place.
#
# First attempt 00:30 UTC (07:30 in UTC+7), when the D1 read meter has just
# reset. It retries every 3 hours; the script is a no-op once the day's dump
# exists and refuses to start when readers already used 30% of the reads.
# Credentials come from the user's CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
# environment, so the task runs as the signed-in user.
param(
  [string]$Checkout = "D:\Coding\Website",
  [string]$TaskName = "Brinedew D1 Backup Rotation"
)
$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $Checkout "scripts\backup-d1-rotation.mjs"
if (-not (Test-Path $script)) { throw "Missing $script; pull main in $Checkout first." }

$firstRunUtc = [DateTime]::UtcNow.Date.AddMinutes(30)
if ($firstRunUtc -lt [DateTime]::UtcNow) { $firstRunUtc = $firstRunUtc.AddDays(1) }
$firstRunLocal = $firstRunUtc.ToLocalTime()

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $Checkout
$trigger = New-ScheduledTaskTrigger -Daily -At $firstRunLocal
$repeat = New-ScheduledTaskTrigger -Once -At $firstRunLocal `
  -RepetitionInterval (New-TimeSpan -Hours 3) -RepetitionDuration (New-TimeSpan -Hours 18)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description "B-830 nightly D1 backup rotation to D:\Backups\brinedew-d1 (see scripts/backup-d1-rotation.mjs)" -Force |
  Out-Null
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
  Select-Object TaskName, NextRunTime, LastTaskResult
