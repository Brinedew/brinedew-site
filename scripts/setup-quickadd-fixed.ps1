# Fixed QuickAdd Configuration Script - UTF-8 No BOM
# Run this with Obsidian CLOSED

$Vault = "D:\Coding\Website\content"  # Correct vault location
$qaJson = Join-Path $Vault ".obsidian\plugins\quickadd\data.json"
$scripts = Join-Path $Vault ".obsidian\scripts"
$hotkeys = Join-Path $Vault ".obsidian\hotkeys.json"

Write-Host "Setting up QuickAdd for content vault: $Vault"

# Backup existing config
if (Test-Path $qaJson) {
    $backup = "$qaJson.backup_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item $qaJson $backup
    Write-Host "Backed up to: $backup"
}

# Ensure directories exist
New-Item -ItemType Directory -Force -Path $scripts | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "Templates") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "..\posts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "wiki") | Out-Null

# Create Post Template if missing
$postTemplate = Join-Path $Vault "Templates\Post Template.md"
if (-not (Test-Path $postTemplate)) {
    $postContent = @"
---
title: {{VALUE:title}}
tags:
  - type/post
date: {{DATE:YYYY-MM-DD}}
status: draft
---
# {{VALUE:title}}
"@
    # Write with UTF-8 No BOM
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($postTemplate, $postContent, $Utf8NoBom)
}

# Create Default Note script
$defaultScript = @"
module.exports = async (params) => {
  try {
    const app = params.app || window.app;
    const commands = app.commands.listCommands();
    const newNoteCommand = commands.find(cmd => 
      cmd.id === 'file-explorer:new-file' || 
      cmd.id === 'workspace:new-file' ||
      cmd.name.toLowerCase().includes('new note')
    );
    
    if (newNoteCommand) {
      app.commands.executeCommandById(newNoteCommand.id);
    } else {
      new Notice('Could not find default new note command');
    }
  } catch (error) {
    new Notice('Error: ' + error.message);
  }
};
"@

$scriptPath = Join-Path $scripts "default-new-note.js"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($scriptPath, $defaultScript, $Utf8NoBom)

# Generate UUIDs
$postId = [System.Guid]::NewGuid().ToString()
$wikiId = [System.Guid]::NewGuid().ToString()
$proteinId = [System.Guid]::NewGuid().ToString()
$defaultId = [System.Guid]::NewGuid().ToString()
$macroId = [System.Guid]::NewGuid().ToString()
$multiId = [System.Guid]::NewGuid().ToString()

Write-Host "Generated IDs:"
Write-Host "  Multi: $multiId"
Write-Host "  Post: $postId"
Write-Host "  Wiki: $wikiId"
Write-Host "  Protein: $proteinId"

# Create configuration object
$config = @{
    choices = @(
        @{
            id = $postId
            name = "Post"
            type = "Template"
            command = $true
            templatePath = "Templates/Post Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("../posts")
                chooseWhenCreatingNote = $false
                createInSameFolderAsActiveFile = $false
                chooseFromSubfolders = $false
            }
            appendLink = $false
            openFileInNewTab = @{ enabled = $false; direction = "vertical"; focus = $true }
            openFile = $true
            openFileInMode = "default"
            fileExistsMode = "Increment the file name"
            setFileExistsBehavior = $false
        }
        @{
            id = $wikiId
            name = "Wiki Page"
            type = "Template"
            command = $true
            templatePath = "Templates/Smart Wiki Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("wiki")
                chooseWhenCreatingNote = $false
                createInSameFolderAsActiveFile = $false
                chooseFromSubfolders = $false
            }
            appendLink = $false
            openFileInNewTab = @{ enabled = $false; direction = "vertical"; focus = $true }
            openFile = $true
            openFileInMode = "default"
            fileExistsMode = "Increment the file name"
            setFileExistsBehavior = $false
        }
        @{
            id = $proteinId
            name = "Protein Page"
            type = "Template"
            command = $true
            templatePath = "Templates/Smart Wiki Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("wiki")
                chooseWhenCreatingNote = $false
                createInSameFolderAsActiveFile = $false
                chooseFromSubfolders = $false
            }
            appendLink = $false
            openFileInNewTab = @{ enabled = $false; direction = "vertical"; focus = $true }
            openFile = $true
            openFileInMode = "default"
            fileExistsMode = "Increment the file name"
            setFileExistsBehavior = $false
        }
        @{
            id = $defaultId
            name = "Default Note"
            type = "Macro"
            command = $true
            macroId = $macroId
        }
        @{
            id = $multiId
            name = "Create New Note"
            type = "Multi"
            command = $true
            children = @($postId, $wikiId, $proteinId, $defaultId)
        }
    )
    macros = @(
        @{
            id = $macroId
            name = "Default Note Macro"
            commands = @(
                @{
                    type = "UserScript"
                    path = ".obsidian/scripts/default-new-note.js"
                }
            )
        }
    )
    inputPrompt = "single-line"
    devMode = $false
    templateFolderPath = ""
    announceUpdates = $true
    version = "2.1.0"
    disableOnlineFeatures = $true
    enableRibbonIcon = $false
    showCaptureNotification = $true
    ai = @{
        defaultModel = "Ask me"
        defaultSystemPrompt = "You are an AI assistant within Obsidian. Help users manage their knowledge effectively using Markdown syntax and Obsidian link format."
        promptTemplatesFolderPath = ""
        showAssistant = $true
        providers = @()
    }
    migrations = @{
        migrateToMacroIDFromEmbeddedMacro = $true
        useQuickAddTemplateFolder = $true
        incrementFileNameSettingMoveToDefaultBehavior = $true
        mutualExclusionInsertAfterAndWriteToBottomOfFile = $true
        setVersionAfterUpdateModalRelease = $true
        addDefaultAIProviders = $true
        removeMacroIndirection = $true
        migrateFileOpeningSettings = $true
    }
}

# Write JSON with UTF-8 No BOM (CRITICAL FIX)
$jsonOutput = $config | ConvertTo-Json -Depth 10
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($qaJson, $jsonOutput, $Utf8NoBom)

Write-Host "QuickAdd config written with UTF-8 No BOM"

# Set hotkey
$hkConfig = if (Test-Path $hotkeys) {
    Get-Content $hotkeys -Raw | ConvertFrom-Json
} else {
    @{}
}

$cmdId = "quickadd:choice:$multiId"
$hkConfig.$cmdId = @(@{ modifiers = @("Ctrl"); key = "N" })

$hkJson = $hkConfig | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($hotkeys, $hkJson, $Utf8NoBom)

Write-Host "Hotkey set: Ctrl+N -> $cmdId"
Write-Host ""
Write-Host "DONE! Start Obsidian and press Ctrl+N to test."