<#
.SYNOPSIS
Advances disjoint manifestation-cutover shards concurrently.

.DESCRIPTION
Each shard owns a deterministic subset of stable gene IDs, so requests cannot
select the same cutover item. One bounded page runs per shard and each Worker
request retains its own item-level CAS and final public-material proof.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^https://')]
    [string] $BaseUri,

    [ValidateSet(2, 4, 8, 16)]
    [int] $ShardCount = 4,

    [ValidateRange(1, 55)]
    [int] $RequestTimeoutSeconds = 55,

    [ValidateRange(1, 55)]
    [int] $OverallTimeoutMinutes = 55,

    [string] $StatePath = (Join-Path $PSScriptRoot '..\artifacts\caretaker-authority-cutover\cutover-state-iconoplasm.brinedew.bio.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedStatePath = [IO.Path]::GetFullPath($StatePath)
if (-not (Test-Path -LiteralPath $resolvedStatePath)) {
    throw "Cutover state does not exist: $resolvedStatePath"
}
$state = Get-Content -LiteralPath $resolvedStatePath -Raw | ConvertFrom-Json -Depth 20
$runId = [string] $state.cutover_run_id
if ($runId -notmatch '^cutover_[A-Za-z0-9_-]{8,128}$') {
    throw 'The saved cutover run identity is invalid.'
}
$token = [Environment]::GetEnvironmentVariable('ICONOPLASM_AUTHORITY_CUTOVER_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'The User-scope ICONOPLASM_AUTHORITY_CUTOVER_TOKEN is missing.'
}

$base = $BaseUri.TrimEnd('/')
$runPath = '/api/iconoplasm/authority/cutover/runs/{0}' -f [Uri]::EscapeDataString($runId)
$deadline = [DateTimeOffset]::UtcNow.AddMinutes($OverallTimeoutMinutes)
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSeconds)
$client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
$client.DefaultRequestHeaders.Accept.ParseAdd('application/json')

function Get-CutoverStatus {
    $response = $client.GetAsync("$base$runPath").GetAwaiter().GetResult()
    try {
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            throw "Cutover status returned HTTP $([int] $response.StatusCode)."
        }
        return $text | ConvertFrom-Json -Depth 30
    }
    finally {
        $response.Dispose()
    }
}

function Invoke-ShardRound {
    $requests = [Collections.Generic.List[Net.Http.HttpRequestMessage]]::new()
    $tasks = [Collections.Generic.List[Threading.Tasks.Task[Net.Http.HttpResponseMessage]]]::new()
    try {
        foreach ($shardIndex in 0..($ShardCount - 1)) {
            $payload = [ordered]@{
                action       = 'materialize'
                limit        = 10
                retry_failed = $true
                shard_count  = $ShardCount
                shard_index  = $shardIndex
            } | ConvertTo-Json -Compress
            $request = [Net.Http.HttpRequestMessage]::new(
                [Net.Http.HttpMethod]::Post,
                "$base$runPath/actions"
            )
            $request.Content = [Net.Http.StringContent]::new(
                $payload,
                [Text.Encoding]::UTF8,
                'application/json'
            )
            $requests.Add($request)
            $tasks.Add($client.SendAsync($request))
        }

        $failures = [Collections.Generic.List[string]]::new()
        foreach ($task in $tasks) {
            try {
                $response = $task.GetAwaiter().GetResult()
                try {
                    if (-not $response.IsSuccessStatusCode) {
                        $failures.Add("HTTP $([int] $response.StatusCode)")
                    }
                }
                finally {
                    $response.Dispose()
                }
            }
            catch {
                $failures.Add($_.Exception.GetType().Name)
            }
        }
        return @($failures)
    }
    finally {
        foreach ($request in $requests) { $request.Dispose() }
    }
}

try {
    $previous = $null
    $stalled = 0
    $round = 0
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $status = Get-CutoverStatus
        if ([string] $status.status -ne 'importing') {
            $status | ConvertTo-Json -Depth 20 -Compress
            return
        }
        $failures = Invoke-ShardRound
        $status = Get-CutoverStatus
        $round += 1
        $fingerprint = "$($status.status)|$($status.counts.verified)|$($status.counts.uploading)|$($status.counts.adopted)|$($status.counts.projected)|$($status.counts.failed)"
        if ($fingerprint -eq $previous) { $stalled += 1 } else { $stalled = 0 }
        $previous = $fingerprint
        if ($round -eq 1 -or $round % 10 -eq 0 -or $failures.Count -gt 0) {
            [ordered]@{
                status         = $status.status
                verified       = [int] $status.counts.verified
                uploading      = [int] $status.counts.uploading
                failed         = [int] $status.counts.failed
                shard_failures = $failures.Count
            } | ConvertTo-Json -Compress | Write-Information -InformationAction Continue
        }
        if ($stalled -ge 20) {
            throw 'Sharded cutover made no observable progress for 20 rounds.'
        }
        if ($failures.Count -gt 0) { Start-Sleep -Seconds 2 }
    }
    throw "Sharded cutover exceeded its $OverallTimeoutMinutes minute hard deadline."
}
finally {
    $client.Dispose()
    $token = $null
}
