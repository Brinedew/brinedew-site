# B-830: registers the one Windows scheduled task that runs
# scripts/backup-d1-rotation.mjs. Re-running replaces the task in place.
#
# First attempt 12:00 UTC (19:00 in UTC+7), in the second half of the D1
# budget day, so the dump spends reads that would otherwise expire instead of
# the fresh day's. It retries every 2 hours until 22:00 UTC. The script is a
# no-op once the day's dump exists, before 12:00 UTC (a laptop catching up
# after midnight), and when readers already used 50% of the reads.
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

$firstRunUtc = [DateTime]::UtcNow.Date.AddHours(12)
if ($firstRunUtc -lt [DateTime]::UtcNow) { $firstRunUtc = $firstRunUtc.AddDays(1) }
$firstRunLocal = $firstRunUtc.ToLocalTime()

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $Checkout
$trigger = New-ScheduledTaskTrigger -Daily -At $firstRunLocal
$repeat = New-ScheduledTaskTrigger -Once -At $firstRunLocal `
  -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 10)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description "B-830 nightly D1 backup rotation to D:\Backups\brinedew-d1 (see scripts/backup-d1-rotation.mjs)" -Force |
  Out-Null
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
  Select-Object TaskName, NextRunTime, LastTaskResult
