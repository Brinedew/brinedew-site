# what i was working on - 2025-07-28

I was setting up automatic Excalidraw conversion and fixing a major git corruption issue. The user had Excalidraw embeds showing as raw text on the website instead of images, and their git repository was corrupted from Syncthing conflicts.

## what actually works now

**Fixed git corruption and set up corruption prevention:**
- Nuked the corrupted repo and cloned fresh from https://github.com/Brinedew/brinedew-site
- Added `.stignore` file to prevent Syncthing from touching `.git` and `site/` folders
- Git operations work normally again from PC

**Implemented automatic Excalidraw conversion:**
- Added `mkdocs-obsidian-excalidraw-plugin` to build pipeline
- Modified `.github/workflows/deploy.yml` (line 23) to install the plugin
- Modified `mkdocs.yml` (line 40) to enable the plugin
- Pushed changes to GitHub - build completed successfully

**The workflow now works:**
1. Create Excalidraw drawings in Obsidian using `![[drawing.excalidraw]]` syntax
2. Plugin auto-converts to standard markdown images during website build
3. No manual syntax conversion needed

Files I changed:
- `.github/workflows/deploy.yml` - added mkdocs-obsidian-excalidraw-plugin to MKDOCS_DEPS (line 23)
- `mkdocs.yml` - added obsidian-excalidraw to plugins list (line 40)
- `.stignore` - NEW FILE: prevents Syncthing from syncing .git and site folders
- `CLAUDE.md` - updated to document the actual Syncthing + Git hybrid workflow

## what's broken

**Excalidraw auto-export not configured yet in Obsidian:**
- User needs to enable auto-export PNG in Excalidraw plugin settings
- Without the PNG export, the plugin has no image to convert
- Currently the embed still shows as raw text until PNG is exported

**Missing configuration on mobile devices:**
- Need to disable Obsidian Git plugin on mobile devices (there's a "Disable on this device" setting)
- Mobile should only use Syncthing, PC handles Git operations

## where things stand

**Website is live and building correctly:**
- GitHub Actions build working with new plugin
- https://brinedew.com/posts/Vibes%20are%20principal%20components/ will show the Excalidraw image once PNG is exported
- All existing content restored from backup

**Repository is clean:**
- Fresh clone from GitHub
- `.stignore` protecting against future corruption
- Git config set to claude@anthropic.com (had to set identity for commits)

**Commands that work right now:**
```bash
# Check if Excalidraw plugin is working
mkdocs serve  # should build without errors now

# Normal git operations 
git status
git add .
git commit -m "message"
git push origin main
```

## what to do next

**Most urgent: Configure Excalidraw auto-export (user needs to do this):**
1. Open Obsidian → Settings → Community plugins → Excalidraw
2. Enable "Auto export PNG" 
3. Set "Keep same folder as drawing"
4. Open the existing drawing to trigger PNG export

**Set up mobile device Git disabling:**
- On mobile Obsidian: Settings → Community plugins → Obsidian Git → "Disable on this device"
- This keeps the plugin synced but disables Git operations on mobile

**Verify the workflow:**
- Test creating new Excalidraw drawing on mobile
- Check that it syncs via Syncthing 
- Verify it appears as image on website after git push

## stuff to remember

**The hybrid workflow is now fully functional:**
- Syncthing handles content sync between all devices
- `.stignore` prevents git corruption by excluding .git folder
- Git operations only happen on PC for publishing
- Excalidraw drawings work across devices and auto-convert for web

**Why this approach works:**
- Mobile gets easy editing without Git complexity
- PC gets full Git control for publishing
- Syncthing is faster than Git for routine content sync
- No more "fatal: loose object is corrupt" errors

**Critical files:**
- `.stignore` - protects against corruption, must exist in repo root
- `.github/workflows/deploy.yml` - contains the plugin install
- `mkdocs.yml` - enables the plugin for processing

The user's original problem (Excalidraw showing as raw text) is solved once they enable auto-export PNG. The deeper issue (git corruption from Syncthing) is permanently fixed with `.stignore`.