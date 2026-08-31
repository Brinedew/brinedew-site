Set-StrictMode -Version Latest

# ARCHITECTURE FENCE [IPD-012]: bulk authority traffic must never consume the
# account capacity required to keep the public dynamic site reachable.

$script:CloudflareWorkerRequestBudgetSchemaVersion = 1
$script:CloudflareWorkerRequestBudgetMaximum = 2500
$script:CloudflareWorkerRequestBudgetLockTimeoutSeconds = 10
$script:CloudflareWorkerRequestTelemetryCeiling = 75000

function Assert-CloudflareWorkerRequestHeadroom {
    [CmdletBinding()]
    param(
        [ValidateRange(1, 75000)][int] $SafeAccountRequestCeiling = $script:CloudflareWorkerRequestTelemetryCeiling,
        [ValidateRange(5, 60)][int] $TimeoutSeconds = 20
    )

    $apiToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
    $accountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User')
    if ([string]::IsNullOrWhiteSpace($apiToken) -or [string]::IsNullOrWhiteSpace($accountId)) {
        throw 'Live Cloudflare request telemetry is unavailable. The User-scope CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required; no Worker request was sent.'
    }

    $utcDay = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-dd')
    $query = @'
query IconoplasmWorkerRequestPreflight($accountTag: string, $day: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { date_geq: $day, date_leq: $day }
      ) {
        sum { requests }
      }
    }
  }
}
'@
    $body = @{
        query = $query
        variables = @{ accountTag = $accountId; day = $utcDay }
    } | ConvertTo-Json -Depth 8 -Compress

    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new(
        'Bearer',
        $apiToken
    )
    try {
        $request = [Net.Http.HttpRequestMessage]::new(
            [Net.Http.HttpMethod]::Post,
            'https://api.cloudflare.com/client/v4/graphql'
        )
        try {
            $request.Content = [Net.Http.StringContent]::new(
                $body,
                [Text.Encoding]::UTF8,
                'application/json'
            )
            $response = $null
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                if (-not $response.IsSuccessStatusCode) {
                    throw "Live Cloudflare request telemetry failed with HTTP $([int] $response.StatusCode); no Worker request was sent."
                }
                $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            }
            finally {
                if ($null -ne $response) {
                    $response.Dispose()
                }
            }
        }
        finally {
            $request.Dispose()
        }

        try {
            $payload = $text | ConvertFrom-Json -Depth 20
        }
        catch {
            throw 'Live Cloudflare request telemetry returned invalid JSON; no Worker request was sent.'
        }
        $errorsProperty = $payload.PSObject.Properties['errors']
        if ($null -ne $errorsProperty -and $null -ne $errorsProperty.Value) {
            throw 'Live Cloudflare request telemetry returned GraphQL errors; no Worker request was sent.'
        }
        $dataProperty = $payload.PSObject.Properties['data']
        if ($null -eq $dataProperty -or $null -eq $payload.data) {
            throw 'Live Cloudflare request telemetry did not return a data payload; no Worker request was sent.'
        }
        $accounts = @($payload.data.viewer.accounts)
        if ($accounts.Count -ne 1) {
            throw 'Live Cloudflare request telemetry did not return exactly one account; no Worker request was sent.'
        }
        $requests = [int64] 0
        foreach ($row in @($accounts[0].workersInvocationsAdaptive)) {
            $requests += [int64] ($row.sum.requests ?? 0)
        }
        if ($requests -ge $SafeAccountRequestCeiling) {
            $resetAt = [DateTimeOffset]::new(
                [DateTimeOffset]::UtcNow.Date.AddDays(1),
                [TimeSpan]::Zero
            ).ToString('o')
            throw (
                "Cloudflare account request preflight refused bulk traffic: analytics reports $requests " +
                "requests for $utcDay UTC, at or above the $SafeAccountRequestCeiling safety ceiling. " +
                "No Worker request was sent. Resume after $resetAt."
            )
        }
        return [pscustomobject]@{
            utc_day                 = $utcDay
            observed_requests       = $requests
            safety_ceiling          = $SafeAccountRequestCeiling
            requests_below_ceiling  = $SafeAccountRequestCeiling - $requests
            checked_at              = [DateTimeOffset]::UtcNow.ToString('o')
        }
    }
    catch [System.Threading.Tasks.TaskCanceledException] {
        throw "Live Cloudflare request telemetry exceeded its $TimeoutSeconds second deadline; no Worker request was sent."
    }
    catch [System.Net.Http.HttpRequestException] {
        throw 'Live Cloudflare request telemetry failed at the network boundary; no Worker request was sent.'
    }
    finally {
        $client.Dispose()
        $apiToken = $null
    }
}

function Resolve-CloudflareWorkerRequestBudgetPath {
    param([string] $RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return [IO.Path]::GetFullPath($RequestedPath)
    }

    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'LOCALAPPDATA is unavailable; refusing to run without a Windows-user-wide Cloudflare request ledger.'
    }
    return Join-Path $localAppData 'Brinedew\Cloudflare\operator-worker-request-budget.json'
}

function Reserve-CloudflareWorkerRequests {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateRange(1, 2500)][int] $Count,
        [ValidateRange(1, 2500)][int] $DailyLimit = 2500,
        [string] $StatePath,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string] $Operation
    )

    if ($DailyLimit -gt $script:CloudflareWorkerRequestBudgetMaximum) {
        throw "The operator request budget cannot exceed $($script:CloudflareWorkerRequestBudgetMaximum) requests per UTC day."
    }

    $resolvedPath = Resolve-CloudflareWorkerRequestBudgetPath -RequestedPath $StatePath
    $directory = Split-Path -Parent $resolvedPath
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $lockPath = "$resolvedPath.lock"
    $lock = $null
    $lockDeadline = [DateTimeOffset]::UtcNow.AddSeconds(
        $script:CloudflareWorkerRequestBudgetLockTimeoutSeconds
    )
    while ($null -eq $lock -and [DateTimeOffset]::UtcNow -lt $lockDeadline) {
        try {
            $lock = [IO.FileStream]::new(
                $lockPath,
                [IO.FileMode]::OpenOrCreate,
                [IO.FileAccess]::ReadWrite,
                [IO.FileShare]::None
            )
        }
        catch [IO.IOException] {
            Start-Sleep -Milliseconds 25
        }
    }
    if ($null -eq $lock) {
        throw 'Could not acquire the shared Cloudflare request-budget lock within 10 seconds. No request was sent.'
    }

    try {
        $utcDay = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-dd')
        $reserved = 0
        $effectiveDailyLimit = $DailyLimit
        if (Test-Path -LiteralPath $resolvedPath) {
            try {
                $saved = Get-Content -LiteralPath $resolvedPath -Raw | ConvertFrom-Json -Depth 8
            }
            catch {
                throw "The Cloudflare request-budget ledger is unreadable; refusing to send any request: $resolvedPath"
            }
            if (
                [int] $saved.schema_version -ne $script:CloudflareWorkerRequestBudgetSchemaVersion -or
                [string]::IsNullOrWhiteSpace([string] $saved.utc_day) -or
                [int64] $saved.requests_reserved -lt 0 -or
                [int] $saved.daily_limit -lt 1 -or
                [int] $saved.daily_limit -gt $script:CloudflareWorkerRequestBudgetMaximum
            ) {
                throw "The Cloudflare request-budget ledger is invalid; refusing to send any request: $resolvedPath"
            }
            if ([string] $saved.utc_day -eq $utcDay) {
                $reserved = [int] $saved.requests_reserved
                # A second process may choose a stricter ceiling, but no process
                # may raise the day's already-persisted allocation.
                $effectiveDailyLimit = [Math]::Min($DailyLimit, [int] $saved.daily_limit)
            }
        }

        if ($reserved + $Count -gt $effectiveDailyLimit) {
            $resetAt = [DateTimeOffset]::new(
                [DateTimeOffset]::UtcNow.Date.AddDays(1),
                [TimeSpan]::Zero
            ).ToString('o')
            throw (
                "Cloudflare operator request budget exhausted: $reserved of $effectiveDailyLimit requests are already " +
                "reserved for $utcDay UTC; '$Operation' needs $Count more. No request was sent. " +
                "Resume after $resetAt. The remaining Free-plan allowance is reserved for the live site."
            )
        }

        $nextReserved = $reserved + $Count
        $payload = [ordered]@{
            schema_version    = $script:CloudflareWorkerRequestBudgetSchemaVersion
            utc_day           = $utcDay
            daily_limit       = $effectiveDailyLimit
            requests_reserved = $nextReserved
            last_operation    = $Operation
            updated_at        = [DateTimeOffset]::UtcNow.ToString('o')
        }
        $temporaryPath = "$resolvedPath.$([Guid]::NewGuid().ToString('N')).tmp"
        try {
            $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding utf8NoBOM
            Move-Item -LiteralPath $temporaryPath -Destination $resolvedPath -Force
        }
        finally {
            if (Test-Path -LiteralPath $temporaryPath) {
                Remove-Item -LiteralPath $temporaryPath -Force
            }
        }

        return [pscustomobject]@{
            utc_day           = $utcDay
            daily_limit       = $effectiveDailyLimit
            requests_reserved = $nextReserved
            requests_remaining = $effectiveDailyLimit - $nextReserved
            state_path        = $resolvedPath
        }
    }
    finally {
        $lock.Dispose()
    }
}
