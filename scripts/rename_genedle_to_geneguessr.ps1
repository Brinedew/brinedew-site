param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..'))
)

$primaryOldName = 'genedle'
$primaryNewName = 'geneguessr'
$renameVariants = @(
    @{ Old = 'genedle'; New = 'geneguessr' },
    @{ Old = 'Genedle'; New = 'Geneguessr' },
    @{ Old = 'GENEDLE'; New = 'GENEGUESSR' }
)
$scriptFullPath = $PSCommandPath

$appsDirectory = Join-Path $ProjectRoot 'content/apps'
$oldFolderPath = Join-Path $appsDirectory $primaryOldName
$newFolderPath = Join-Path $appsDirectory $primaryNewName

Write-Output "Renaming folder '$oldFolderPath' to '$newFolderPath' if needed..."

if (Test-Path $oldFolderPath) {
    Rename-Item -Path $oldFolderPath -NewName $primaryNewName -ErrorAction Stop
} elseif (-not (Test-Path $newFolderPath)) {
    throw "Expected folder '$oldFolderPath' but it was not found."
}

$excludedFoldersPattern = '[\\/](node_modules|\.git|dist|build|\.cache|coverage)[\\/]'
$excludedPathFragments = @('tools\thoteins\nul')

function Test-ExcludedPath {
    param(
        [string]$CandidatePath,
        [string]$ScriptPath,
        [string]$FolderPattern,
        [string[]]$ExcludedFragments
    )

    if ([IO.Path]::GetFullPath($CandidatePath) -eq [IO.Path]::GetFullPath($ScriptPath)) {
        return $true
    }

    if ($CandidatePath -match $FolderPattern) {
        return $true
    }

    foreach ($fragment in $ExcludedFragments) {
        if ($CandidatePath -like "*$fragment*") {
            return $true
        }
    }

    return $false
}

Write-Output "Scanning for files and directories that still reference the old name..."
foreach ($variant in $renameVariants) {
    $searchToken = $variant.Old
    $replaceToken = $variant.New

    Write-Output "Renaming items containing '$searchToken' in their names..."
    $itemsToRename = Get-ChildItem -Path $ProjectRoot -Recurse -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-ExcludedPath -CandidatePath $_.FullName -ScriptPath $scriptFullPath -FolderPattern $excludedFoldersPattern -ExcludedFragments $excludedPathFragments) } |
        Where-Object { $_.Name -like "*$searchToken*" } |
        Sort-Object { $_.FullName.Length } -Descending

    foreach ($item in $itemsToRename) {
        $targetName = $item.Name.Replace($searchToken, $replaceToken)
        if ($targetName -ne $item.Name) {
            Rename-Item -Path $item.FullName -NewName $targetName -ErrorAction Stop
        }
    }

    Write-Output "Replacing '$searchToken' occurrences inside text files..."
    $filesToUpdate = Get-ChildItem -Path $ProjectRoot -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-ExcludedPath -CandidatePath $_.FullName -ScriptPath $scriptFullPath -FolderPattern $excludedFoldersPattern -ExcludedFragments $excludedPathFragments) } |
        Where-Object { Select-String -Path $_.FullName -Pattern $searchToken -CaseSensitive -SimpleMatch -Quiet }

    foreach ($file in $filesToUpdate) {
        $content = Get-Content -Path $file.FullName -Raw
        $pattern = [regex]::Escape($searchToken)
        $updatedContent = [regex]::Replace($content, $pattern, $replaceToken)
        if ($updatedContent -ne $content) {
            Set-Content -Path $file.FullName -Value $updatedContent -Encoding utf8
        }
    }
}

Write-Output "Done."
