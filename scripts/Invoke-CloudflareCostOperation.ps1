<#
.SYNOPSIS
Registers, executes, or reads a receipt for an explicit immutable cost plan.
.DESCRIPTION
The server owns query bounds and actual-cost receipts. This client never
invents a prediction, changes a refused plan, or retries ambiguous execution.
Control requests also reserve the existing shared workstation request budget.
Run through Invoke-HardTimeout.ps1 with a 60-second command deadline.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Register', 'Execute', 'Receipt')][string] $Action,
    [Parameter(Mandatory)][string] $PlanPath,
    [string] $StepPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-BoundedCostDocument {
    param([Parameter(Mandatory)][string] $Path)
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Length -gt 65536) {
        throw 'Cost documents must be files of at most 65536 bytes.'
    }
    return [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json -AsHashtable -Depth 20
}

# Validate before loading credentials or making even a telemetry request.
$plan = Read-BoundedCostDocument -Path $PlanPath
if ($plan -isnot [Collections.IDictionary] -or -not $plan.Contains('prediction') -or
    $plan.prediction -isnot [Collections.IDictionary]) {
    throw 'COST_PREDICTION_REQUIRED: provide the explicit prediction document.'
}
foreach ($meter in @('rows_read', 'rows_written', 'requests')) {
    $value = $plan.prediction[$meter]
    if (($value -isnot [long] -and $value -isnot [int]) -or $value -lt 0) {
        throw "COST_PREDICTION_INVALID: $meter must be a nonnegative integer."
    }
}
foreach ($field in @('id', 'adapter_id', 'resource', 'executable_sha256', 'schema_sha256', 'expires_at')) {
    if (-not $plan.Contains($field)) { throw "COST_PLAN_INVALID: missing $field." }
}
foreach ($field in @('executable_sha256', 'schema_sha256')) {
    if ([string] $plan[$field] -notmatch '^[a-f0-9]{64}$') { throw "COST_PLAN_INVALID: invalid $field." }
}
foreach ($field in @('id', 'adapter_id', 'resource')) {
    if ([string] $plan[$field] -notmatch '^[A-Za-z0-9_.:-]{1,128}$') { throw "COST_PLAN_INVALID: invalid $field." }
}
if ($Action -eq 'Execute') {
    if (-not $StepPath) { throw 'COST_STEP_REQUIRED: supply the explicit step document.' }
    $body = Read-BoundedCostDocument -Path $StepPath
    if ($body -isnot [Collections.IDictionary] -or $body.operation_id -ne $plan.id -or $body.adapter_id -ne $plan.adapter_id) {
        throw 'COST_PLAN_IDENTITY_MISMATCH: step and plan must refer to the same operation.'
    }
} elseif ($Action -eq 'Register') {
    $body = $plan
} else {
    $body = @{ id = $plan.id }
}

$token = [Environment]::GetEnvironmentVariable('ICONOPLASM_ADMIN_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:ICONOPLASM_ADMIN_TOKEN }
if ([string]::IsNullOrWhiteSpace($token)) { throw 'ICONOPLASM_ADMIN_TOKEN is unavailable.' }
. (Join-Path $PSScriptRoot 'lib\CloudflareWorkerRequestBudget.ps1')
Assert-CloudflareWorkerRequestHeadroom -TimeoutSeconds 15 | Out-Null
Reserve-CloudflareWorkerRequests -Count 1 -Operation "cost-plan:$($plan.id):$Action" | Out-Null

$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(20)
$client.DefaultRequestHeaders.Add('x-iconoplasm-admin-token', $token)
$content = [Net.Http.StringContent]::new(($body | ConvertTo-Json -Depth 20 -Compress), [Text.Encoding]::UTF8, 'application/json')
try {
    # Fixed origin; never forward an administrative token to a caller's URL.
    $uri = 'https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations/' + $Action.ToLowerInvariant()
    $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
    try {
        $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $code = 'COST_REQUEST_REFUSED'
            try {
                $parsed = $result | ConvertFrom-Json -AsHashtable
                if ([string] $parsed.code -match '^COST_[A-Z_]+$') { $code = $parsed.code }
            } catch { }
            throw "$code (HTTP $([int] $response.StatusCode)); no automatic retry or replacement plan."
        }
        $result
    } finally { $response.Dispose() }
} finally {
    $content.Dispose()
    $client.Dispose()
    $token = $null
}
