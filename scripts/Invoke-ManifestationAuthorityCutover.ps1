<#
.SYNOPSIS
Resumes and verifies the one-time manifestation authority cutover.

.DESCRIPTION
Verify plans the source inventory, freezes the legacy writer, materializes the
encrypted authority, and verifies the shadow projection. Activate additionally
switches canonical authority and creates a verified independent backup.
BeginRetirement records the backup-bound retention gate and stops deliberately,
so a separate Retire invocation proves resume behavior before erasing and
independently verifying every legacy plaintext manifestation value.

Stable run, snapshot, and backup identities are persisted outside source files.
Rerunning the same command resumes safely. The cutover token is read only from
the Windows User environment and is never written to the state artifact.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^https://')]
    [string] $BaseUri,

    [ValidateSet('Verify', 'Activate', 'BeginRetirement', 'Retire')]
    [string] $Mode = 'Verify',

    [ValidateRange(2, 2147483647)]
    [int] $TargetAuthorityEpoch = 2,

    [ValidateRange(5, 55)]
    [int] $RequestTimeoutSeconds = 45,

    [ValidateRange(1, 1440)]
    [int] $OverallTimeoutMinutes = 240,

    [string] $CutoverRunId,

    [string] $SourceSnapshotId,

    [string] $BackupArtifactId,

    [string] $StatePath,

    [switch] $ResetState,

    [string] $ResetConfirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-OpaqueOperatorId {
    param([Parameter(Mandatory)][string] $Prefix)

    return '{0}_{1}' -f $Prefix, ([Guid]::NewGuid().ToString('N').ToLowerInvariant())
}

function Resolve-StatePath {
    param(
        [string] $RequestedPath,
        [Parameter(Mandatory)][string] $NormalizedBaseUri
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return [IO.Path]::GetFullPath($RequestedPath)
    }
    $artifactDirectory = [IO.Path]::GetFullPath(
        (Join-Path $PSScriptRoot '..\artifacts\caretaker-authority-cutover')
    )
    $authorityHost = ([Uri] $NormalizedBaseUri).Authority -replace '[^A-Za-z0-9._-]', '_'
    return Join-Path $artifactDirectory "cutover-state-$authorityHost.json"
}

function Read-OperatorState {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    $raw = Get-Content -LiteralPath $Path -Raw
    try {
        return $raw | ConvertFrom-Json -Depth 20
    }
    catch {
        throw "Cutover state is not valid JSON: $Path"
    }
}

function Write-OperatorState {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][object] $State,
        [object] $Status
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $payload = [ordered]@{
        schema_version          = 1
        base_uri               = $State.base_uri
        cutover_run_id          = $State.cutover_run_id
        source_snapshot_id      = $State.source_snapshot_id
        backup_artifact_id      = $State.backup_artifact_id
        target_authority_epoch  = [int] $State.target_authority_epoch
        mode                    = $State.mode
        updated_at              = [DateTimeOffset]::UtcNow.ToString('o')
        last_status             = $Status
    }
    $temporaryPath = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporaryPath -Encoding utf8NoBOM
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Assert-StateIdentity {
    param(
        [Parameter(Mandatory)][object] $State,
        [Parameter(Mandatory)][string] $ExpectedBaseUri,
        [Parameter(Mandatory)][int] $ExpectedEpoch
    )

    if ([string] $State.base_uri -ne $ExpectedBaseUri) {
        throw 'The saved cutover state belongs to a different base URI. Use an explicit separate -StatePath.'
    }
    if ([int] $State.target_authority_epoch -ne $ExpectedEpoch) {
        throw 'The saved cutover state belongs to a different authority epoch. Do not reuse it.'
    }
}

function Test-TransientStatus {
    param([int] $StatusCode)
    return $StatusCode -eq 408 -or $StatusCode -eq 425 -or $StatusCode -eq 429 -or $StatusCode -ge 500
}

$normalizedBaseUri = $BaseUri.TrimEnd('/')
$resolvedStatePath = Resolve-StatePath -RequestedPath $StatePath -NormalizedBaseUri $normalizedBaseUri
$stateDirectory = Split-Path -Parent $resolvedStatePath
if (-not (Test-Path -LiteralPath $stateDirectory)) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
}
$stateLockPath = "$resolvedStatePath.lock"
try {
    $stateLock = [IO.FileStream]::new(
        $stateLockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
}
catch [IO.IOException] {
    throw "Another cutover operator owns the state lock: $stateLockPath"
}

if ($ResetState) {
    if ($ResetConfirmation -ne 'archive_and_replace_cutover_identity') {
        throw '-ResetState requires -ResetConfirmation archive_and_replace_cutover_identity.'
    }
    if (Test-Path -LiteralPath $resolvedStatePath) {
        $archiveTimestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $archivePath = "$resolvedStatePath.reset-$archiveTimestamp.json"
        Move-Item -LiteralPath $resolvedStatePath -Destination $archivePath
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($ResetConfirmation)) {
    throw '-ResetConfirmation is valid only together with -ResetState.'
}

$savedState = Read-OperatorState -Path $resolvedStatePath
if ($null -ne $savedState) {
    Assert-StateIdentity -State $savedState -ExpectedBaseUri $normalizedBaseUri -ExpectedEpoch $TargetAuthorityEpoch
    if (-not [string]::IsNullOrWhiteSpace($CutoverRunId) -and $CutoverRunId -ne $savedState.cutover_run_id) {
        throw '-CutoverRunId conflicts with the saved operator state.'
    }
    if (-not [string]::IsNullOrWhiteSpace($SourceSnapshotId) -and $SourceSnapshotId -ne $savedState.source_snapshot_id) {
        throw '-SourceSnapshotId conflicts with the saved operator state.'
    }
    if (-not [string]::IsNullOrWhiteSpace($BackupArtifactId) -and $BackupArtifactId -ne $savedState.backup_artifact_id) {
        throw '-BackupArtifactId conflicts with the saved operator state.'
    }
    $state = [ordered]@{
        base_uri              = $normalizedBaseUri
        cutover_run_id        = [string] $savedState.cutover_run_id
        source_snapshot_id    = [string] $savedState.source_snapshot_id
        backup_artifact_id    = [string] $savedState.backup_artifact_id
        target_authority_epoch = [int] $savedState.target_authority_epoch
        mode                  = $Mode
    }
}
else {
    $state = [ordered]@{
        base_uri              = $normalizedBaseUri
        cutover_run_id        = if ($CutoverRunId) { $CutoverRunId } else { New-OpaqueOperatorId -Prefix 'cutover' }
        source_snapshot_id    = if ($SourceSnapshotId) { $SourceSnapshotId } else { New-OpaqueOperatorId -Prefix 'source' }
        backup_artifact_id    = if ($BackupArtifactId) { $BackupArtifactId } else { New-OpaqueOperatorId -Prefix 'cutover_backup' }
        target_authority_epoch = $TargetAuthorityEpoch
        mode                  = $Mode
    }
    Write-OperatorState -Path $resolvedStatePath -State $state -Status $null
}

$cutoverToken = [Environment]::GetEnvironmentVariable('ICONOPLASM_AUTHORITY_CUTOVER_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($cutoverToken)) {
    throw 'The User-scope ICONOPLASM_AUTHORITY_CUTOVER_TOKEN is missing.'
}

$deadline = [DateTimeOffset]::UtcNow.AddMinutes($OverallTimeoutMinutes)
$handler = [Net.Http.HttpClientHandler]::new()
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSeconds)
$client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $cutoverToken)
$client.DefaultRequestHeaders.Accept.ParseAdd('application/json')

function Assert-BeforeDeadline {
    if ([DateTimeOffset]::UtcNow -ge $deadline) {
        throw "The cutover exceeded its $OverallTimeoutMinutes minute hard deadline. It is resumable from $resolvedStatePath."
    }
}

function Invoke-AuthorityRequest {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST')][string] $Method,
        [Parameter(Mandatory)][string] $Path,
        [object] $Body,
        [int] $MaximumAttempts = 5
    )

    $lastFailure = $null
    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt += 1) {
        Assert-BeforeDeadline
        $response = $null
        $request = [Net.Http.HttpRequestMessage]::new(
            [Net.Http.HttpMethod]::new($Method),
            "$normalizedBaseUri$Path"
        )
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 12 -Compress
            $request.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        try {
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $statusCode = [int] $response.StatusCode
            if ($response.IsSuccessStatusCode) {
                if ([string]::IsNullOrWhiteSpace($responseText)) {
                    throw "Authority returned an empty HTTP $statusCode response."
                }
                try {
                    return $responseText | ConvertFrom-Json -Depth 30
                }
                catch {
                    throw "Authority returned invalid JSON with HTTP $statusCode."
                }
            }
            $errorCode = $null
            try { $errorCode = ($responseText | ConvertFrom-Json -Depth 8).error.code } catch {}
            $lastFailure = "HTTP $statusCode" + $(if ($errorCode) { " ($errorCode)" } else { '' })
            if (-not (Test-TransientStatus -StatusCode $statusCode) -or $attempt -eq $MaximumAttempts) {
                throw "Authority request failed: $lastFailure"
            }
        }
        catch [System.Threading.Tasks.TaskCanceledException] {
            $lastFailure = "request deadline of $RequestTimeoutSeconds seconds"
            if ($attempt -eq $MaximumAttempts) { throw "Authority request failed after $MaximumAttempts attempts: $lastFailure" }
        }
        catch [System.Net.Http.HttpRequestException] {
            $lastFailure = 'transient network failure'
            if ($attempt -eq $MaximumAttempts) { throw "Authority request failed after $MaximumAttempts attempts: $lastFailure" }
        }
        finally {
            $request.Dispose()
            if ($null -ne $response) { $response.Dispose() }
            $response = $null
        }
        $delaySeconds = [Math]::Min(8, [Math]::Pow(2, $attempt - 1))
        Start-Sleep -Seconds $delaySeconds
    }
    throw "Authority request failed: $lastFailure"
}

$runPath = '/api/iconoplasm/authority/cutover/runs/{0}' -f [Uri]::EscapeDataString($state.cutover_run_id)

function Get-CutoverStatus {
    return Invoke-AuthorityRequest -Method GET -Path $runPath
}

function Invoke-CutoverAction {
    param(
        [Parameter(Mandatory)][string] $Action,
        [hashtable] $AdditionalBody = @{}
    )

    $body = [ordered]@{ action = $Action }
    foreach ($entry in $AdditionalBody.GetEnumerator()) {
        $body[$entry.Key] = $entry.Value
    }
    $result = Invoke-AuthorityRequest -Method POST -Path "$runPath/actions" -Body $body
    Write-OperatorState -Path $resolvedStatePath -State $state -Status $result
    return $result
}

function Write-BoundedProgress {
    param([Parameter(Mandatory)][object] $Status)

    $backupStatus = if ($null -ne $Status.backup) { [string] $Status.backup.status } else { $null }
    $backupVerified = if ($null -ne $Status.backup) { [int] $Status.backup.verified_entries } else { 0 }
    $retirementStatus = if ($null -ne $Status.retirement) { [string] $Status.retirement.status } else { $null }
    $retiredRows = if ($null -ne $Status.retirement) { [int] $Status.retirement.retired_rows } else { 0 }
    $progress = [ordered]@{
        status          = $Status.status
        planned         = [int] $Status.planned_items
        verified        = [int] $Status.counts.verified
        failed          = [int] $Status.counts.failed
        backup_status   = $backupStatus
        backup_verified = $backupVerified
        retirement      = $retirementStatus
        retired_rows    = $retiredRows
    }
    # Progress must not enter the success-output pipeline: callers assign the
    # returned status object, and pipeline text would turn that assignment into
    # a heterogeneous array after the first long-running page loop.
    Write-Information ($progress | ConvertTo-Json -Compress) -InformationAction Continue
}

function Invoke-ProgressLoop {
    param(
        [Parameter(Mandatory)][string] $Action,
        [Parameter(Mandatory)][scriptblock] $IsComplete,
        [Parameter(Mandatory)][scriptblock] $Fingerprint,
        [hashtable] $AdditionalBody = @{},
        [int] $MaximumStalledIterations = 20
    )

    $stalled = 0
    $previous = $null
    $iteration = 0
    while ($true) {
        Assert-BeforeDeadline
        $status = Get-CutoverStatus
        if (& $IsComplete $status) {
            Write-OperatorState -Path $resolvedStatePath -State $state -Status $status
            Write-BoundedProgress -Status $status
            return $status
        }
        $status = Invoke-CutoverAction -Action $Action -AdditionalBody $AdditionalBody
        $iteration += 1
        if ($iteration -eq 1 -or $iteration % 50 -eq 0 -or (& $IsComplete $status)) {
            Write-BoundedProgress -Status $status
        }
        $current = [string] (& $Fingerprint $status)
        if ($current -eq $previous) { $stalled += 1 } else { $stalled = 0 }
        if ($stalled -ge $MaximumStalledIterations) {
            throw "Cutover action '$Action' made no observable progress for $MaximumStalledIterations iterations. State is preserved for diagnosis."
        }
        $previous = $current
        if ([int] ($status.counts.failed ?? 0) -gt 0) {
            Start-Sleep -Seconds 2
        }
    }
}

try {
    $status = $null
    try { $status = Get-CutoverStatus }
    catch {
        if ($_.Exception.Message -notmatch 'HTTP 404') { throw }
        $status = Invoke-CutoverAction -Action 'create' -AdditionalBody @{
            source_snapshot_id    = $state.source_snapshot_id
            target_authority_epoch = [int] $state.target_authority_epoch
        }
    }

    if ($status.status -eq 'planning') {
        $status = Invoke-ProgressLoop -Action 'plan' `
            -AdditionalBody @{ limit = 250 } `
            -IsComplete { param($value) $value.status -ne 'planning' } `
            -Fingerprint { param($value) "$($value.status)|$($value.planned_items)|$($value.scan_after_symbol)" }
    }
    if ($status.status -eq 'ready') {
        $status = Invoke-CutoverAction -Action 'freeze'
    }
    if ($status.status -eq 'importing') {
        $status = Invoke-ProgressLoop -Action 'materialize' `
            -AdditionalBody @{ limit = 5; retry_failed = $true } `
            -IsComplete { param($value) $value.status -ne 'importing' } `
            -Fingerprint { param($value) "$($value.status)|$($value.counts.verified)|$($value.counts.failed)|$($value.counts.uploading)|$($value.counts.adopted)|$($value.counts.projected)" }
    }
    if ($status.status -eq 'seeded') {
        $status = Invoke-CutoverAction -Action 'verify'
    }

    if ($Mode -eq 'Verify') {
        Write-BoundedProgress -Status $status
        return
    }
    if ($status.status -eq 'shadow_verified') {
        $status = Invoke-CutoverAction -Action 'activate' -AdditionalBody @{
            confirm = 'activate_verified_authority'
        }
    }
    if ($status.status -ne 'authoritative') {
        throw "Authority activation did not reach the authoritative state; current status is '$($status.status)'."
    }
    if ($null -eq $status.backup) {
        $status = Invoke-CutoverAction -Action 'begin_backup' -AdditionalBody @{
            backup_artifact_id = $state.backup_artifact_id
        }
    }
    if ($status.backup.status -eq 'building') {
        $status = Invoke-ProgressLoop -Action 'backup' `
            -AdditionalBody @{ limit = 10 } `
            -IsComplete { param($value) $value.backup.status -eq 'verified' } `
            -Fingerprint { param($value) "$($value.backup.status)|$($value.backup.verified_entries)|$($value.backup.part_count)" }
    }
    $verifiedBackupStates = @(
        'verified', 'retention_pending', 'held', 'deleting', 'delete_failed', 'deleted'
    )
    if ($status.backup.status -notin $verifiedBackupStates) {
        throw "Cutover backup did not verify; current backup status is '$($status.backup.status)'."
    }

    if ($Mode -eq 'Activate') {
        Write-BoundedProgress -Status $status
        return
    }
    if ($null -eq $status.retirement) {
        $status = Invoke-CutoverAction -Action 'begin_retirement' -AdditionalBody @{
            backup_artifact_id = $state.backup_artifact_id
            confirm            = 'retire_verified_legacy_plaintext'
        }
    }
    if ($Mode -eq 'BeginRetirement') {
        if ($status.retirement.status -ne 'running' -or $status.backup.status -ne 'retention_pending') {
            throw 'Retirement did not persist its running state and backup-retention deadline.'
        }
        Write-BoundedProgress -Status $status
        return
    }
    if ($status.retirement.status -eq 'running') {
        $status = Invoke-ProgressLoop -Action 'retire_plaintext' `
            -AdditionalBody @{ limit = 250 } `
            -IsComplete { param($value) $value.retirement.status -eq 'verified' } `
            -Fingerprint { param($value) "$($value.retirement.status)|$($value.retirement.retired_rows)|$($value.retirement.scan_after_symbol)" }
    }
    if ($status.retirement.status -ne 'verified' -or $null -eq $status.primary.plaintext_retired_at) {
        throw 'Plaintext retirement did not reach its independently verified terminal state.'
    }
    Write-BoundedProgress -Status $status
}
finally {
    $client.Dispose()
    $handler.Dispose()
    $stateLock.Dispose()
    $cutoverToken = $null
}
