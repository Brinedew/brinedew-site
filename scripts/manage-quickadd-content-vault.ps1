# Canonical QuickAdd manager for the Website/content vault.
# Hard cutover: rewrites QuickAdd config to one modern "Create New Note" flow.
# Usage:
#   powershell -File scripts/manage-quickadd-content-vault.ps1
#   powershell -File scripts/manage-quickadd-content-vault.ps1 -DryRun
#   powershell -File scripts/manage-quickadd-content-vault.ps1 -SkipHotkey

param(
    [switch]$DryRun,
    [switch]$SkipHotkey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[quickadd-cutover] $Message"
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Save-Json([string]$Path, [object]$Object, [switch]$DryRun) {
    $json = $Object | ConvertTo-Json -Depth 30
    if ($DryRun) {
        Write-Step "DRY RUN: would write JSON to $Path"
        return
    }
    Write-Utf8NoBom -Path $Path -Content $json
}

function Backup-File([string]$Path, [switch]$DryRun) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = "$Path.backup_$stamp"

    if ($DryRun) {
        Write-Step "DRY RUN: would backup $Path -> $backupPath"
        return
    }

    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    Write-Step "Backed up $Path -> $backupPath"
}

function Ensure-Directory([string]$Path, [switch]$DryRun) {
    if (Test-Path -LiteralPath $Path) {
        return
    }

    if ($DryRun) {
        Write-Step "DRY RUN: would create directory $Path"
        return
    }

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "Failed to parse JSON at '$Path': $($_.Exception.Message)"
    }
}

function Set-ObjectProperty([object]$Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Get-ExistingValue([object]$Object, [string]$Name, $Default) {
    if ($null -eq $Object) {
        return $Default
    }

    if ($Object.PSObject.Properties.Name -contains $Name) {
        return $Object.$Name
    }

    return $Default
}

function Resolve-ChoiceId([object]$ExistingConfig, [string]$Name) {
    if ($null -eq $ExistingConfig -or -not ($ExistingConfig.PSObject.Properties.Name -contains "choices")) {
        return [System.Guid]::NewGuid().ToString()
    }

    $stack = New-Object System.Collections.Generic.Stack[object]
    foreach ($choice in @($ExistingConfig.choices)) {
        if ($null -ne $choice) {
            $stack.Push($choice)
        }
    }

    while ($stack.Count -gt 0) {
        $choice = $stack.Pop()

        if (
            ($choice.PSObject.Properties.Name -contains "name") -and
            ($choice.PSObject.Properties.Name -contains "id") -and
            $choice.name -eq $Name -and
            $choice.id
        ) {
            return [string]$choice.id
        }

        if (
            ($choice.PSObject.Properties.Name -contains "type") -and
            $choice.type -eq "Multi" -and
            ($choice.PSObject.Properties.Name -contains "choices")
        ) {
            foreach ($child in @($choice.choices)) {
                if ($null -ne $child) {
                    $stack.Push($child)
                }
            }
        }
    }

    return [System.Guid]::NewGuid().ToString()
}

function Ensure-TextFile([string]$Path, [string]$Content, [switch]$DryRun) {
    if (Test-Path -LiteralPath $Path) {
        return
    }

    if ($DryRun) {
        Write-Step "DRY RUN: would create $Path"
        return
    }

    Write-Utf8NoBom -Path $Path -Content $Content
    Write-Step "Created $Path"
}

function Normalize-PostTemplate([string]$Path, [switch]$DryRun) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $content = Get-Content -LiteralPath $Path -Raw
    $updated = $content

    $updated = [regex]::Replace($updated, '(?m)^\s*status:\s*draft\s*$', 'draft: true')

    if ($updated -notmatch '(?m)^\s*draft:\s*(true|false)\s*$') {
        if ($updated -match '(?m)^\s*date:.*$') {
            $updated = [regex]::Replace($updated, '(?m)^(\s*date:.*)$', "`$1`r`ndraft: true", 1)
        } else {
            $updated = "draft: true`r`n$updated"
        }
    }

    if ($updated -eq $content) {
        return
    }

    if ($DryRun) {
        Write-Step "DRY RUN: would normalize draft frontmatter in $Path"
        return
    }

    Write-Utf8NoBom -Path $Path -Content $updated
    Write-Step "Normalized draft frontmatter in $Path"
}

function New-TemplateChoice([string]$Id, [string]$Name, [string]$TemplatePath, [string]$Folder) {
    return [ordered]@{
        appendLink = $false
        id = $Id
        fileExistsMode = "Increment the file name"
        openFileInMode = "default"
        command = $true
        setFileExistsBehavior = $false
        templatePath = $TemplatePath
        openFile = $true
        fileOpening = [ordered]@{
            location = "tab"
            direction = "vertical"
            focus = $true
            mode = "default"
        }
        folder = [ordered]@{
            createInSameFolderAsActiveFile = $false
            chooseFromSubfolders = $false
            enabled = $true
            folders = @($Folder)
            chooseWhenCreatingNote = $false
        }
        name = $Name
        fileNameFormat = [ordered]@{
            enabled = $true
            format = "{{VALUE:title}}"
        }
        type = "Template"
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$vaultRoot = Join-Path $repoRoot "content"
$obsidianRoot = Join-Path $vaultRoot ".obsidian"
$quickAddDir = Join-Path $obsidianRoot "plugins\quickadd"
$quickAddJson = Join-Path $quickAddDir "data.json"
$quickAddManifest = Join-Path $quickAddDir "manifest.json"
$hotkeysJson = Join-Path $obsidianRoot "hotkeys.json"
$scriptsDir = Join-Path $obsidianRoot "scripts"
$templatesDir = Join-Path $vaultRoot "Templates"
$postDir = Join-Path $vaultRoot "posts"
$wikiDir = Join-Path $vaultRoot "wiki"

if (-not (Test-Path -LiteralPath $vaultRoot)) {
    throw "Vault root not found at '$vaultRoot'. Run this from the Website repo."
}

Ensure-Directory -Path $quickAddDir -DryRun:$DryRun
Ensure-Directory -Path $scriptsDir -DryRun:$DryRun
Ensure-Directory -Path $templatesDir -DryRun:$DryRun
Ensure-Directory -Path $postDir -DryRun:$DryRun
Ensure-Directory -Path $wikiDir -DryRun:$DryRun

$postTemplatePath = Join-Path $templatesDir "Post Template.md"
$wikiTemplatePath = Join-Path $templatesDir "Wiki Template QuickAdd.md"
$proteinTemplatePath = Join-Path $templatesDir "Protein Template QuickAdd.md"
$defaultNoteScriptPath = Join-Path $scriptsDir "default-new-note.js"

$postTemplateContent = @"
---
title: {{VALUE:title}}
tags:
  - content/post
date: {{DATE:YYYY-MM-DD}}
draft: true
---
# {{VALUE:title}}
"@

$wikiTemplateContent = @"
---
title: {{VALUE:title}}
tags:
  - content/wiki
date: {{DATE:YYYY-MM-DD}}
draft: true
---
# {{VALUE:title}}
"@

$proteinTemplateContent = @"
---
title: {{VALUE:title}}
tags:
  - content/wiki
  - protein
date: {{DATE:YYYY-MM-DD}}
draft: true
---
# {{VALUE:title}}
"@

$defaultNoteScript = @"
module.exports = async (params) => {
  try {
    const app = params.app || window.app;
    const commands = app.commands.listCommands();
    const preferred = [
      "file-explorer:new-file",
      "app:workspace:new-note",
      "workspace:new-file"
    ];

    const byId = preferred.find((id) => commands.some((cmd) => cmd.id === id));
    const fallback = commands.find((cmd) => /new\\s*note/i.test(cmd.name));
    const commandId = byId || (fallback && fallback.id);

    if (!commandId) {
      new Notice("QuickAdd: Could not find the default New note command");
      return;
    }

    app.commands.executeCommandById(commandId);
  } catch (error) {
    new Notice("QuickAdd: Error executing Default Note: " + error.message);
    console.error("QuickAdd default note error:", error);
  }
};
"@

Ensure-TextFile -Path $postTemplatePath -Content $postTemplateContent -DryRun:$DryRun
Ensure-TextFile -Path $wikiTemplatePath -Content $wikiTemplateContent -DryRun:$DryRun
Ensure-TextFile -Path $proteinTemplatePath -Content $proteinTemplateContent -DryRun:$DryRun
Normalize-PostTemplate -Path $postTemplatePath -DryRun:$DryRun

if ($DryRun) {
    Write-Step "DRY RUN: would write $defaultNoteScriptPath"
} else {
    Write-Utf8NoBom -Path $defaultNoteScriptPath -Content $defaultNoteScript
    Write-Step "Wrote $defaultNoteScriptPath"
}

$existingConfig = Read-JsonFile -Path $quickAddJson
$existingHotkeys = Read-JsonFile -Path $hotkeysJson
$manifest = Read-JsonFile -Path $quickAddManifest

$quickAddVersion = Get-ExistingValue -Object $manifest -Name "version" -Default (Get-ExistingValue -Object $existingConfig -Name "version" -Default "2.9.4")

$postId = Resolve-ChoiceId -ExistingConfig $existingConfig -Name "Post"
$wikiId = Resolve-ChoiceId -ExistingConfig $existingConfig -Name "Wiki Page"
$proteinId = Resolve-ChoiceId -ExistingConfig $existingConfig -Name "Protein Page"
$multiId = Resolve-ChoiceId -ExistingConfig $existingConfig -Name "Create New Note"

$postChoice = New-TemplateChoice -Id $postId -Name "Post" -TemplatePath "Templates/Post Template.md" -Folder "posts"
$wikiChoice = New-TemplateChoice -Id $wikiId -Name "Wiki Page" -TemplatePath "Templates/Wiki Template QuickAdd.md" -Folder "wiki"
$proteinChoice = New-TemplateChoice -Id $proteinId -Name "Protein Page" -TemplatePath "Templates/Protein Template QuickAdd.md" -Folder "wiki"

$announceUpdates = Get-ExistingValue -Object $existingConfig -Name "announceUpdates" -Default "all"
if ($announceUpdates -is [bool]) {
    $announceUpdates = if ($announceUpdates) { "all" } else { "none" }
}

$existingAi = Get-ExistingValue -Object $existingConfig -Name "ai" -Default $null
$existingProviders = Get-ExistingValue -Object $existingAi -Name "providers" -Default @()
if ($null -eq $existingProviders) {
    $providerList = @()
} elseif ($existingProviders -is [System.Array]) {
    $providerList = $existingProviders
} elseif (
    ($existingProviders -is [System.Management.Automation.PSCustomObject]) -and
    (@($existingProviders.PSObject.Properties).Count -eq 0)
) {
    $providerList = @()
} else {
    $providerList = @($existingProviders)
}

$aiConfig = [ordered]@{
    defaultSystemPrompt = Get-ExistingValue -Object $existingAi -Name "defaultSystemPrompt" -Default "You are an AI assistant within Obsidian. Help users manage their knowledge effectively using Markdown syntax and Obsidian link format."
    providers = $providerList
    promptTemplatesFolderPath = Get-ExistingValue -Object $existingAi -Name "promptTemplatesFolderPath" -Default ""
    showAssistant = [bool](Get-ExistingValue -Object $existingAi -Name "showAssistant" -Default $true)
    defaultModel = Get-ExistingValue -Object $existingAi -Name "defaultModel" -Default "Ask me"
}

$migrationsDefaults = [ordered]@{
    mutualExclusionInsertAfterAndWriteToBottomOfFile = $true
    removeMacroIndirection = $true
    migrateFileOpeningSettings = $true
    migrateToMacroIDFromEmbeddedMacro = $true
    useQuickAddTemplateFolder = $true
    setVersionAfterUpdateModalRelease = $true
    incrementFileNameSettingMoveToDefaultBehavior = $true
    addDefaultAIProviders = $true
    setProviderModelDiscoveryMode = $true
}

$existingMigrations = Get-ExistingValue -Object $existingConfig -Name "migrations" -Default $null
$migrationsConfig = [ordered]@{}
foreach ($key in $migrationsDefaults.Keys) {
    $value = Get-ExistingValue -Object $existingMigrations -Name $key -Default $migrationsDefaults[$key]
    $migrationsConfig[$key] = [bool]$value
}

$newConfig = [ordered]@{
    choices = @(
        [ordered]@{
            name = "Create New Note"
            type = "Multi"
            children = @($postId, $wikiId, $proteinId)
            id = $multiId
            command = $true
            choices = @($postChoice, $wikiChoice, $proteinChoice)
            collapsed = $false
        }
    )
    inputPrompt = Get-ExistingValue -Object $existingConfig -Name "inputPrompt" -Default "single-line"
    devMode = [bool](Get-ExistingValue -Object $existingConfig -Name "devMode" -Default $false)
    templateFolderPath = "Templates"
    announceUpdates = $announceUpdates
    version = $quickAddVersion
    globalVariables = Get-ExistingValue -Object $existingConfig -Name "globalVariables" -Default @{}
    onePageInputEnabled = [bool](Get-ExistingValue -Object $existingConfig -Name "onePageInputEnabled" -Default $false)
    disableOnlineFeatures = [bool](Get-ExistingValue -Object $existingConfig -Name "disableOnlineFeatures" -Default $true)
    enableRibbonIcon = [bool](Get-ExistingValue -Object $existingConfig -Name "enableRibbonIcon" -Default $true)
    showCaptureNotification = [bool](Get-ExistingValue -Object $existingConfig -Name "showCaptureNotification" -Default $true)
    showInputCancellationNotification = [bool](Get-ExistingValue -Object $existingConfig -Name "showInputCancellationNotification" -Default $false)
    enableTemplatePropertyTypes = [bool](Get-ExistingValue -Object $existingConfig -Name "enableTemplatePropertyTypes" -Default $false)
    ai = $aiConfig
    migrations = $migrationsConfig
    macros = @()
}

Backup-File -Path $quickAddJson -DryRun:$DryRun
Save-Json -Path $quickAddJson -Object $newConfig -DryRun:$DryRun
Write-Step "QuickAdd config cutover complete: $quickAddJson"

if (-not $SkipHotkey) {
    $hotkeys = if ($null -eq $existingHotkeys) { [pscustomobject]@{} } else { $existingHotkeys }

    foreach ($propName in @($hotkeys.PSObject.Properties.Name)) {
        if ($propName -like "quickadd:choice:*") {
            $hotkeys.PSObject.Properties.Remove($propName)
        }
    }

    $newHotkeyCommand = "quickadd:choice:$multiId"
    $newHotkeyValue = @(
        @{
            modifiers = @("Ctrl")
            key = "N"
        }
    )

    Set-ObjectProperty -Object $hotkeys -Name $newHotkeyCommand -Value $newHotkeyValue

    Backup-File -Path $hotkeysJson -DryRun:$DryRun
    Save-Json -Path $hotkeysJson -Object $hotkeys -DryRun:$DryRun
    Write-Step "Hotkey cutover complete: Ctrl+N -> $newHotkeyCommand"
} else {
    Write-Step "Skipped hotkey update (-SkipHotkey)"
}

Write-Step "Done."
