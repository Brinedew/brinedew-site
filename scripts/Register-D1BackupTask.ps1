# B-830: registers the one Windows scheduled task that runs
# scripts/backup-d1-rotation.mjs. Re-running replaces the task in place.
#
# First attempt 00:15 UTC, then every 2 hours through the UTC day. The script
# is a no-op once the day's dump exists, and it sheds like any batch work
# (sheddable_plus, B-1026): it skips while the account's reads plus the
# database's last measured dump would reach 85% of the daily wall.
# The D1 read token is the backup's own (B-1002): backup-token.txt next to the dumps, or the
# file named by D1_BACKUP_TOKEN_FILE. CLOUDFLARE_ACCOUNT_ID comes from the user's environment,
# so the task runs as the signed-in user. CLOUDFLARE_API_TOKEN is only a fallback for a machine
# that has no token file yet; the token every agent shell inherits has no D1 permission.
param(
  [string]$Checkout = "D:\Coding\Website",
  [string]$TaskName = "Brinedew D1 Backup Rotation"
)
$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $Checkout "scripts\backup-d1-rotation.mjs"
if (-not (Test-Path $script)) { throw "Missing $script; pull main in $Checkout first." }

$firstRunUtc = [DateTime]::UtcNow.Date.AddMinutes(15)
if ($firstRunUtc -lt [DateTime]::UtcNow) { $firstRunUtc = $firstRunUtc.AddDays(1) }
$firstRunLocal = $firstRunUtc.ToLocalTime()

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $Checkout
$trigger = New-ScheduledTaskTrigger -Daily -At $firstRunLocal
$repeat = New-ScheduledTaskTrigger -Once -At $firstRunLocal `
  -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 22)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew -DontStopOnIdleEnd
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description "B-830 nightly D1 backup rotation to D:\Backups\brinedew-d1 (see scripts/backup-d1-rotation.mjs)" -Force |
  Out-Null
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
  Select-Object TaskName, NextRunTime, LastTaskResult
