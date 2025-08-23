# QuickAdd Note Creation Workflow - 2025-08-23

The user wanted a custom note creation workflow where hitting Ctrl+N brings up a dialog with 4 options: Post (goes to posts/ folder), Wiki Page (goes to wiki/ folder), Protein Page (goes to wiki/ folder with special protein template), or Default Note (normal Obsidian behavior). Plus they wanted the protein option to eventually fetch data from UniProt API.

## what actually works now

Nothing. The QuickAdd plugin is completely clean after reinstalling it.

But here's what we built that's ready to work:

**Files created:**
- `content/Templates/Post Template.md` - basic post template with proper frontmatter
- `content/Templates/Smart Wiki Template.md` - existed already, prompts for protein vs regular wiki page
- `.obsidian/scripts/default-new-note.js` - script to trigger Obsidian's core "new note" command
- `.obsidian/hotkeys.json` - has binding for Ctrl+N but references a dead QuickAdd choice UUID
- `setup-quickadd.ps1` - PowerShell script that creates the full QuickAdd configuration
- `reset-quickadd.ps1` - More robust version that wipes QuickAdd config completely and recreates it

**What the configuration should do:**
- Multi choice called "Create New Note" containing 4 sub-choices
- Post choice: uses Post Template, creates in content/posts/
- Wiki Page choice: uses Smart Wiki Template, creates in content/wiki/, asks protein/not protein
- Protein Page choice: uses Smart Wiki Template, creates in content/wiki/ (placeholder for UniProt integration)
- Default Note choice: macro that runs the default-new-note.js script

## what's broken

QuickAdd plugin configuration gets wiped when you reinstall the plugin. We discovered the original QuickAdd installation was corrupted - it only had data.json but was missing main.js, manifest.json, and styles.css files. That's why our JSON configuration wasn't working.

When we reinstalled QuickAdd properly, it came back completely clean. The user said "Now there's nothing. Completely clean. Not even an old multi."

## where things stand

**Current QuickAdd state:** Fresh installation, no choices configured
**Templates:** All exist and ready
**Scripts:** Default note script exists and should work
**Hotkeys:** Has a dead reference to our old Multi choice UUID

**Working commands right now:**
```bash
# Check if templates exist
ls "D:\Coding\Website\content\Templates\"
# Should show: Post Template.md, Smart Wiki Template.md

# Check if script exists  
ls "D:\Coding\Website\.obsidian\scripts\"
# Should show: default-new-note.js
```

## what to do next

The most urgent thing is to get the QuickAdd configuration working. The user has been trying to set this up for a while and got frustrated with the GUI approach.

**Option 1: Run the reset script again**
```bash
cd "D:\Coding\Website"
pwsh -File "reset-quickadd.ps1"
```

This should create a fresh QuickAdd configuration with:
- Multi choice "Create New Note" 
- 4 sub-choices with proper folder routing
- Fresh UUIDs for everything
- New hotkey binding for Ctrl+N

**Option 2: Try the GUI approach**
Go to Settings → QuickAdd and manually create:
1. Multi choice called "Create New Note"
2. Add 4 sub-choices to it
3. Configure each choice's template path and folder

The PowerShell approach is more reliable because QuickAdd's GUI is confusing and prone to conflicts.

## stuff to remember

**Why we chose the JSON approach:** QuickAdd's GUI is terrible. The "Add Choice" button doesn't let you select choice type - it defaults to Template and there's no obvious way to change it to Multi. We tried for hours to make a Multi choice through the GUI and failed.

**The corruption discovery:** Spent a lot of time debugging why our perfect JSON configuration wasn't loading. Turns out QuickAdd was missing its main.js and manifest.json files - it wasn't actually running as a plugin, just had leftover config data.

**Uninstall behavior:** Obsidian smartly preserves user data (data.json) when uninstalling plugins, only removing the executable files. This is good for users but meant our config survived the corrupted installation.

**UniProt integration:** Not implemented yet. The plan was to enhance the "Protein Page" choice with a macro that prompts for protein symbol/UniProt ID, fetches data from UniProt API, and auto-populates template fields. We have the basic template structure ready for this.

**Templates work well:** The Smart Wiki Template with Templater integration asks protein/not-protein and creates appropriate frontmatter. Meta Bind plugin is installed for interactive property editing.

**Static site integration:** The ProteinInfobox component is already built and working on brinedew.com - it reads the protein frontmatter properties and renders Wikipedia-style infoboxes. So once the note creation workflow works, the protein pages will display beautifully on the published site.

The user really wants this workflow to work. They've been patient but I can tell they're getting frustrated with how long it's taking. The technical pieces are all there - we just need to get QuickAdd configured properly.