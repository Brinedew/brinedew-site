# Reset QuickAdd Configuration Script
# Run this with Obsidian CLOSED to completely reset and recreate QuickAdd config

# --- CONFIG ---
$Vault = "D:\Coding\Website"

# --- Paths ---
$qaDir   = Join-Path $Vault ".obsidian\plugins\quickadd"
$qaJson  = Join-Path $qaDir "data.json"
$scripts = Join-Path $Vault ".obsidian\scripts"
$hotkeys = Join-Path $Vault ".obsidian\hotkeys.json"

Write-Host "RESETTING QuickAdd configuration for $Vault" -ForegroundColor Red
Write-Host "This will delete ALL existing QuickAdd choices and recreate from scratch" -ForegroundColor Yellow
Write-Host ""

# --- Complete backup of old config ---
if (Test-Path $qaJson) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backup = "${qaJson}.FULL_BACKUP_${timestamp}"
    Copy-Item $qaJson $backup
    Write-Host "Full backup created: $backup" -ForegroundColor Green
    
    # Show what we're about to delete
    Write-Host "Current configuration being replaced:" -ForegroundColor Yellow
    $oldConfig = Get-Content $qaJson -Raw | ConvertFrom-Json
    if ($oldConfig.choices) {
        $oldConfig.choices | ForEach-Object { Write-Host "  - $($_.name) ($($_.type))" }
    }
    Write-Host ""
}

# --- COMPLETELY WIPE QuickAdd configuration ---
Write-Host "Deleting existing QuickAdd data.json..." -ForegroundColor Red
if (Test-Path $qaJson) {
    Remove-Item $qaJson -Force
}

# --- Create fresh directories ---
New-Item -ItemType Directory -Force -Path $qaDir | Out-Null
New-Item -ItemType Directory -Force -Path $scripts | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "content\posts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "content\wiki") | Out-Null

# --- Create Post Template if missing ---
$postTemplate = Join-Path $Vault "content\Templates\Post Template.md"
if (-not (Test-Path $postTemplate)) {
    Write-Host "Creating Post Template..." -ForegroundColor Green
    @"
---
title: {{VALUE:title}}
tags:
  - type/post
date: {{DATE:YYYY-MM-DD}}
status: draft
---
# {{VALUE:title}}
"@ | Set-Content -NoNewline $postTemplate
}

# --- Verify Smart Wiki Template exists ---
$wikiTemplate = Join-Path $Vault "content\Templates\Smart Wiki Template.md"
if (-not (Test-Path $wikiTemplate)) {
    Write-Host "ERROR: Smart Wiki Template.md not found!" -ForegroundColor Red
    exit 1
}

# --- Create Default Note script ---
$defaultNoteScript = @"
module.exports = async (params) => {
  try {
    const app = params.app || window.app;
    
    // Find the core "New note" command
    const commands = app.commands.listCommands();
    const newNoteCommand = commands.find(cmd => 
      cmd.id === 'file-explorer:new-file' || 
      cmd.id === 'app:workspace:new-note' ||
      cmd.name.toLowerCase().includes('new note')
    );
    
    if (newNoteCommand) {
      app.commands.executeCommandById(newNoteCommand.id);
      console.log('QuickAdd: Executed default new note command:', newNoteCommand.id);
    } else {
      new Notice('QuickAdd: Could not find default new note command');
      console.error('QuickAdd: Available commands:', commands.map(c => c.id));
    }
  } catch (error) {
    new Notice('QuickAdd: Error executing default note: ' + error.message);
    console.error('QuickAdd default note error:', error);
  }
};
"@

$scriptPath = Join-Path $scripts "default-new-note.js"
$defaultNoteScript | Set-Content -NoNewline $scriptPath
Write-Host "Created default note script: $scriptPath" -ForegroundColor Green

# --- Generate fresh UUIDs ---
function New-UUID { [System.Guid]::NewGuid().ToString() }

$postId = New-UUID
$wikiId = New-UUID
$proteinId = New-UUID
$defaultId = New-UUID
$macroId = New-UUID
$multiId = New-UUID

Write-Host ""
Write-Host "Generated fresh UUIDs:" -ForegroundColor Green
Write-Host "  Multi Choice ID: $multiId" -ForegroundColor Cyan
Write-Host "  Post ID: $postId"
Write-Host "  Wiki ID: $wikiId"
Write-Host "  Protein ID: $proteinId"
Write-Host "  Default ID: $defaultId"
Write-Host "  Macro ID: $macroId"

# --- Create COMPLETELY FRESH configuration ---
$freshConfig = @{
    choices = @(
        # Post Template Choice
        @{
            id = $postId
            name = "Post"
            type = "Template"
            command = $true
            templatePath = "content/Templates/Post Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("content/posts")
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
        
        # Wiki Page Template Choice  
        @{
            id = $wikiId
            name = "Wiki Page"
            type = "Template"
            command = $true
            templatePath = "content/Templates/Smart Wiki Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("content/wiki")
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
        
        # Protein Page Template Choice
        @{
            id = $proteinId
            name = "Protein Page"
            type = "Template"  
            command = $true
            templatePath = "content/Templates/Smart Wiki Template.md"
            fileNameFormat = @{
                enabled = $true
                format = "{{VALUE:title}}"
            }
            folder = @{
                enabled = $true
                folders = @("content/wiki")
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
        
        # Default Note Macro Choice
        @{
            id = $defaultId
            name = "Default Note"
            type = "Macro"
            command = $true
            macroId = $macroId
        }
        
        # Multi Choice (Container)
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
    
    settings = @{}
}

# --- Write fresh configuration ---
$jsonConfig = $freshConfig | ConvertTo-Json -Depth 10
$jsonConfig | Set-Content -NoNewline $qaJson -Encoding UTF8

Write-Host ""
Write-Host "Created fresh QuickAdd configuration:" -ForegroundColor Green
Write-Host "  File: $qaJson"
Write-Host "  Choices: $($freshConfig.choices.Count)"
Write-Host "  Macros: $($freshConfig.macros.Count)"

# --- Remove old hotkey conflicts and set new one ---
if (Test-Path $hotkeys) {
    $hkConfig = Get-Content $hotkeys -Raw | ConvertFrom-Json
    
    # Remove any old QuickAdd hotkeys
    $keysToRemove = @()
    foreach ($key in $hkConfig.PSObject.Properties.Name) {
        if ($key.StartsWith("quickadd:")) {
            $keysToRemove += $key
        }
    }
    foreach ($key in $keysToRemove) {
        $hkConfig.PSObject.Properties.Remove($key)
        Write-Host "Removed old hotkey: $key" -ForegroundColor Yellow
    }
} else {
    $hkConfig = @{}
}

# Set new hotkey for our Multi choice
$newHotkeyCmd = "quickadd:choice:$multiId"
$hkConfig.$newHotkeyCmd = @(
    @{
        modifiers = @("Ctrl")
        key = "N"
    }
)

$hkConfig | ConvertTo-Json -Depth 5 | Set-Content -NoNewline $hotkeys -Encoding UTF8
Write-Host "Set hotkey Ctrl+N -> $newHotkeyCmd" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RESET COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Start Obsidian" -ForegroundColor White  
Write-Host "2. Go to Settings -> QuickAdd" -ForegroundColor White
Write-Host "3. You should see 'Create New Note' Multi choice" -ForegroundColor White
Write-Host "4. Press Ctrl+N to test" -ForegroundColor White
Write-Host ""
Write-Host "If it still doesn't work, check the Obsidian console (Ctrl+Shift+I) for errors." -ForegroundColor Yellow