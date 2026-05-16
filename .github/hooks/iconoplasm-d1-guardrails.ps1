$rawInput = [Console]::In.ReadToEnd()

function Test-IconoplasmD1GuardrailPayload-ForProtectedAlarmFiles {
    param(
        [string]$Payload
    )

    if ([string]::IsNullOrWhiteSpace($Payload)) {
        return $false
    }

    $protectedMarkers = @(
        'workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js',
        'workers/iconoplasm.d1-cost-barrier.test.js',
        'workers/iconoplasm.d1-hot-query-guard.test.js',
        'workers/iconoplasm.do-not-delete-cost-guards.test.js',
        'docs/ICONOPLASM_ONBOARDING.md',
        'CLAUDE.md',
        '.github/hooks/iconoplasm-d1-guardrails.json',
        '.github/hooks/iconoplasm-d1-guardrails.ps1',
        '.github/instructions/iconoplasm-d1-cost-barrier.instructions.md',
        'Website/workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js',
        'Website/workers/iconoplasm.d1-cost-barrier.test.js',
        'Website/workers/iconoplasm.d1-hot-query-guard.test.js',
        'Website/workers/iconoplasm.do-not-delete-cost-guards.test.js',
        'Website/docs/ICONOPLASM_ONBOARDING.md'
    )

    foreach ($marker in $protectedMarkers) {
        if ($Payload -like "*$marker*") {
            return $true
        }
    }

    return $false
}

function Test-IconoplasmD1GuardrailPayload-LooksLikeDeletionOrRenameAttempt {
    param(
        [string]$Payload
    )

    if ([string]::IsNullOrWhiteSpace($Payload)) {
        return $false
    }

    $dangerMarkers = @(
        '*** Delete File:',
        '"editType":"delete"',
        '"command":"delete"',
        '"old_path"',
        '"new_path"'
    )

    foreach ($marker in $dangerMarkers) {
        if ($Payload -like "*$marker*") {
            return $true
        }
    }

    return $false
}

function Write-IconoplasmD1GuardrailDenyDecision-BecauseDeletingAlarmFilesIsHowRealBillingIncidentsComeBack {
    $response = @{
        hookSpecificOutput = @{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = 'This looks like a delete or rename attempt on protected Iconoplasm D1 alarm files. Replace the guardrail with something stricter in the same change instead of silently removing it.'
        }
    }

    $response | ConvertTo-Json -Compress
}

function Write-IconoplasmD1GuardrailAskDecision-BecauseDeletingAlarmFilesCanReintroduceRealBillingIncidents {
    $response = @{
        hookSpecificOutput = @{
            hookEventName = 'PreToolUse'
            permissionDecision = 'ask'
            permissionDecisionReason = 'This touches protected Iconoplasm D1 alarm files. Stop and consciously confirm that you are strengthening the cost barrier instead of silencing it.'
        }
    }

    $response | ConvertTo-Json -Compress
}

if (Test-IconoplasmD1GuardrailPayload-ForProtectedAlarmFiles -Payload $rawInput) {
    if (Test-IconoplasmD1GuardrailPayload-LooksLikeDeletionOrRenameAttempt -Payload $rawInput) {
        Write-IconoplasmD1GuardrailDenyDecision-BecauseDeletingAlarmFilesIsHowRealBillingIncidentsComeBack
        exit 0
    }

    Write-IconoplasmD1GuardrailAskDecision-BecauseDeletingAlarmFilesCanReintroduceRealBillingIncidents
    exit 0
}

@{
    hookSpecificOutput = @{
        hookEventName = 'PreToolUse'
        permissionDecision = 'allow'
        permissionDecisionReason = 'No protected Iconoplasm D1 alarm files detected.'
    }
} | ConvertTo-Json -Compress
