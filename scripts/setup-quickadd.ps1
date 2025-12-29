# QuickAdd Configuration Script for Website Vault
# Run this with Obsidian CLOSED

# --- CONFIG ---
$Vault = "D:\Coding\Website"

# --- Paths ---
$qaDir   = Join-Path $Vault ".obsidian\plugins\quickadd"
$qaJson  = Join-Path $qaDir "data.json"
$scripts = Join-Path $Vault ".obsidian\scripts"
$hotkeys = Join-Path $Vault ".obsidian\hotkeys.json"

Write-Host "Setting up QuickAdd configuration for $Vault"

# --- Safety: back up existing config ---
New-Item -ItemType Directory -Force -Path $qaDir | Out-Null
if (Test-Path $qaJson) { 
    $backup = "$qaJson.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item $qaJson $backup
    Write-Host "Backed up existing config to: $backup"
}

# --- Ensure content folders exist ---
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "content\posts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault "content\wiki")  | Out-Null

# --- Create missing templates (if needed) ---
$templatesDir = Join-Path $Vault "content\Templates"

# Check if Post Template exists, create if missing
$postTemplate = Join-Path $templatesDir "Post Template.md"
if (-not (Test-Path $postTemplate)) {
    Write-Host "Post Template not found, creating basic one..."
    @"
---
title: {{VALUE:title}}
tags:
  - content/post
date: {{DATE:YYYY-MM-DD}}
status: draft
---
# {{VALUE:title}}
"@ | Set-Content -NoNewline $postTemplate
}

# Check if Smart Wiki Template exists
$wikiTemplate = Join-Path $templatesDir "Smart Wiki Template.md"
if (-not (Test-Path $wikiTemplate)) {
    Write-Host "ERROR: Smart Wiki Template.md not found in $templatesDir"
    Write-Host "Please make sure your template exists before running this script."
    exit 1
}

# --- User script for Default Note behavior ---
New-Item -ItemType Directory -Force -Path $scripts | Out-Null
$defaultNewNoteJs = @"
module.exports = async (params) => {
  try {
    const app = params.app || window.app;
    const candidates = (app?.commands?.listCommands?.() || [])
      .filter(c => /new\s*note/i.test(c.name));
    
    // Prefer known core IDs for "New note"
    const preferred = [
      "file-explorer:new-file",
      "app:workspace:new-note", 
      "file:new"
    ];
    
    let id = preferred.find(pid => candidates.some(c => c.id === pid));
    if (!id && candidates.length) id = candidates[0].id;
    
    if (!id) { 
      new Notice("QuickAdd: could not find the core New note command."); 
      return; 
    }
    
    app.commands.executeCommandById(id);
  } catch (e) {
    new Notice("QuickAdd: error executing Default Note: " + e.message);
    console.error(e);
  }
};
"@

$defaultNewNotePath = Join-Path $scripts "default-new-note.js"
$defaultNewNoteJs | Set-Content -NoNewline $defaultNewNotePath

# --- Load or initialize QuickAdd config ---
$cfg = if (Test-Path $qaJson) {
  Get-Content $qaJson -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{
    choices = @()
    macros  = @()
    settings = @{}
  }
}

# Ensure arrays exist
if (-not $cfg.PSObject.Properties.Name.Contains("choices")) { 
    $cfg | Add-Member -Name choices -Value @() -MemberType NoteProperty 
}
if (-not $cfg.PSObject.Properties.Name.Contains("macros")) { 
    $cfg | Add-Member -Name macros  -Value @() -MemberType NoteProperty 
}

# Helper functions
function Upsert-Choice($name, $obj) {
  $existingNames = @($cfg.choices | ForEach-Object { $_.name })
  $i = [Array]::IndexOf($existingNames, $name)
  if ($i -ge 0) { $cfg.choices[$i] = $obj } else { $cfg.choices += $obj }
}

function New-Id { [guid]::NewGuid().ToString() }

# Create choice IDs
$postId     = New-Id
$wikiId     = New-Id  
$proteinId  = New-Id
$macroId    = New-Id
$defaultId  = New-Id
$multiId    = New-Id

Write-Host "Creating choices with IDs:"
Write-Host "  Post: $postId"
Write-Host "  Wiki: $wikiId" 
Write-Host "  Protein: $proteinId"
Write-Host "  Default: $defaultId"
Write-Host "  Multi: $multiId"

# Template choice factory
function New-TemplateChoice($id, $name, $tplPath, $targetFolder) {
  return [pscustomobject]@{
    id   = $id
    name = $name
    type = "Template"
    command = $true
    templatePath = $tplPath
    fileNameFormat = @{
      enabled = $true
      format = "{{VALUE:title}}"
    }
    folder = @{
      enabled = $true
      folders = @($targetFolder)
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
}

# Add the Template choices
Upsert-Choice "Post" (New-TemplateChoice $postId "Post" "content/Templates/Post Template.md" "content/posts")
Upsert-Choice "Wiki Page" (New-TemplateChoice $wikiId "Wiki Page" "content/Templates/Smart Wiki Template.md" "content/wiki")

# Protein page - UserScript that fetches UniProt data
$proteinChoice = [pscustomobject]@{
  id   = $proteinId
  name = "Protein Page"
  type = "UserScript"
  command = $true
  path = ".obsidian/scripts/create-protein-page.js"
}
Upsert-Choice "Protein Page" $proteinChoice

# Macro for Default Note
$macroObj = [pscustomobject]@{
  id = $macroId
  name = "Default Note macro"
  commands = @(
    [pscustomobject]@{
      type = "UserScript"
      path = ".obsidian/scripts/default-new-note.js"
    }
  )
}

# Upsert macro
$macroNames = @($cfg.macros | ForEach-Object { $_.name })
$macroIndex = [Array]::IndexOf($macroNames, "Default Note macro")
if ($macroIndex -ge 0) { 
    $cfg.macros[$macroIndex] = $macroObj 
} else { 
    $cfg.macros += $macroObj 
}

# Macro choice
$macroChoice = [pscustomobject]@{
  id   = $defaultId
  name = "Default Note"
  type = "Macro"
  command = $true
  macroId = $macroId
}
Upsert-Choice $macroChoice.name $macroChoice

# Multi choice that contains all sub-choices
$multiChoice = [pscustomobject]@{
  id   = $multiId
  name = "Create new note"
  type = "Multi"
  command = $true
  children = @($postId, $wikiId, $proteinId, $defaultId)
}
Upsert-Choice $multiChoice.name $multiChoice

# Save QuickAdd config
$cfg | ConvertTo-Json -Depth 100 | Set-Content -NoNewline $qaJson
Write-Host "QuickAdd configuration saved to: $qaJson"

# Set up hotkey (Ctrl+N to override default new note)
$hkObj = if (Test-Path $hotkeys) { 
    Get-Content $hotkeys -Raw | ConvertFrom-Json 
} else { 
    @{} 
}

$cmdId = "quickadd:choice:$multiId"
$hkObj.$cmdId = @(@{ modifiers = @("Ctrl"); key = "N" })
$hkObj | ConvertTo-Json -Depth 5 | Set-Content -NoNewline $hotkeys

Write-Host "Hotkey configured: Ctrl+N -> Create new note"
Write-Host ""
Write-Host "DONE! Now:"
Write-Host "1. Start Obsidian"
Write-Host "2. Press Ctrl+N to test your new note creation workflow"
Write-Host "3. You should see options for: Post, Wiki Page, Protein Page, Default Note"
Write-Host ""
Write-Host "Next step: We'll enhance the Protein Page choice to add UniProt integration"
