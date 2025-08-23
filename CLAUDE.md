# brinedew.com setup notes

*For Claude Code and anyone else working on this site*

---

## what this thing is

Personal longevity research blog built with Quartz 4. This is a modern static site generator optimized for Obsidian integration, with features like graph view, backlinks, full-text search, and proper digital garden functionality.

The basic flow: write markdown in `content/`, push to GitHub, CI builds the site with Quartz, GitHub Pages serves it at brinedew.com. Takes about 60 seconds from push to live.

## how to actually use it

**Local development (PC only):**
```bash
npx quartz build    # builds static site to public/
```

**Content workflow (mobile-first):**
1. Write markdown in Obsidian on any device (phone, tablet, PC)
2. Syncthing syncs content automatically across all devices
3. When ready to publish: Git commit and push from PC
4. Wait a minute, check brinedew.com

**Device setup:**
- **Mobile devices**: Obsidian with Git plugins disabled, Syncthing enabled
- **PC**: Obsidian with Git enabled, Syncthing enabled with `.stignore` protection
- **Syncthing ignores**: `.git` folder (prevents corruption) and `public/` folder (build output)

Don't overthink it. Edit anywhere, publish from PC, CI does the rest.

## file structure that matters

- `content/` - all your markdown content lives here (migrated from `docs/`)
- `content/posts/assets/images/` - throw images here
- `quartz.config.ts` - site config (theme, plugins, nav)
- `.github/workflows/deploy-quartz.yml` - GitHub Actions workflow for Quartz builds
- `public/` - build output (git ignores this, CI handles it)
- `quartz/static/` - static assets like CSS, images that get copied to public
- `scripts/` - migration and utility scripts

## navigation works automatically

Quartz generates navigation from your file structure:
- **New markdown files show up in navigation automatically**
- **Explorer sidebar** shows entire site structure as a tree
- **Breadcrumbs** show your current location in the hierarchy
- **Backlinks** automatically generated for pages that reference each other
- Files appear in alphabetical order by default
- Put `index.md` in folders to create section landing pages

**No manual navigation configuration needed.** Just create the markdown files and folders you want.

## styling notes

Using Quartz's default theme with custom CSS in `quartz/static/custom.css`. Dark mode is the default.

**Don't append CSS to .scss files** - it breaks the Sass compiler. Use static CSS files only.

**Custom CSS is included via Head component** - check `quartz/components/Head.tsx` line 88.

Use `content/posts/dark-mode-test-page.md` to test that all content types render properly.

## when things break

**Site not updating?** Check GitHub Actions first: https://github.com/Brinedew/brinedew-site/actions
- Green checkmark = deployment succeeded, changes should be live in ~60 seconds
- Red X = build failed, check the logs for errors
- Yellow circle = build in progress, wait for completion

**Build failing?** Check that:
- All markdown files have proper frontmatter (title and date)
- No spaces in filenames (use hyphens instead)
- No raw HTML in markdown files

**Interactive web apps disappeared?** Check if migration scripts removed embedded HTML:
- Look in `scripts/` for content conversion scripts that strip HTML
- Check git history: `git log --oneline --grep="app\|html\|frontend"`
- Embedded HTML gets nuked during static site migrations - use external JS/CSS files instead

**Excalidraw drawings showing as text links instead of images?** You need to enable PNG auto-export in Obsidian:
1. Open Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. ✅ Enable "Keep same folder as drawing"
4. Your drawings will now automatically export as PNG files alongside the .excalidraw files
5. The website will display the PNG images instead of text links

**Git corruption (fatal: loose object is corrupt)?** This happens when Syncthing and Git conflict:
1. Back up your `content/` directory to a safe location
2. Delete the corrupted Website folder
3. `git clone https://github.com/Brinedew/brinedew-site.git Website`
4. Restore your content from backup
5. Verify `.stignore` file exists with `.git` and `public` entries
6. **Critical**: Never sync the `.git` folder via Syncthing again

**Merge conflicts?** The nuclear option that works:
```bash
git fetch origin
git reset --hard origin/main
```

**Everything's on fire?** Check if you accidentally committed `.obsidian/workspace.json` (which is gitignored for a reason).

## the deployment pipeline

1. Push to main
2. GitHub Actions spins up Ubuntu runner
3. Installs Node.js + Quartz dependencies
4. Runs `npx quartz build` 
5. Uploads the `./public` directory as a Pages artifact
6. Deploys to GitHub Pages

No gh-pages branch, no manual deployment commands. Just push and wait.

## quartz features we're using

- **Graph View** - interactive visualization of content connections
- **Full-text Search** - search across all content
- **Backlinks** - automatic cross-references between pages  
- **Explorer** - hierarchical navigation sidebar
- **SPA Routing** - fast page transitions
- **Obsidian Compatibility** - handles wikilinks and basic Obsidian syntax
- **Dark Mode** - enabled by default with toggle available

All features built into Quartz, no additional plugins needed.

## interactive web apps

**How to add working frontends to static sites:**

Instead of embedding 600-line HTML/CSS/JavaScript blobs in markdown (migration scripts will strip them), use clean architecture:

1. **Minimal markdown shell** with data attributes:
```markdown
<div id="app-root" data-api-origin="https://api.example.com"></div>
```

2. **External assets** in `quartz/static/apps/appname/`:
   - `app.css` - themed styles using Quartz CSS variables
   - `app.js` - SPA-safe JavaScript with MutationObserver initialization

3. **Load globally** in `quartz/components/Head.tsx`:
```tsx
<link rel="stylesheet" href="/static/apps/appname/app.css?v=1" />
<script defer src="/static/apps/appname/app.js?v=1"></script>
```

**SPA compatibility:** Use MutationObserver to reinitialize when DOM changes:
```js
function tryInit() { /* initialize app */ }
tryInit(); // run now
new MutationObserver(tryInit).observe(document.documentElement, {childList:true, subtree:true});
```

This survives Quartz's dynamic navigation and won't get nuked by migration scripts.

## things to not touch

- `.github/workflows/deploy-quartz.yml` permissions (required for Pages)
- `quartz.config.ts` core configuration (themes, plugins)
- Don't append CSS to .scss files (breaks Sass compilation)

## wiki structure

`content/wiki/` has hierarchical organization for longevity research concepts. Navigation auto-generates from file structure. Each category gets its own subfolder with an index page.

**To add new wiki content:**
1. Create markdown files in the appropriate folder with proper frontmatter
2. That's it - navigation updates automatically
3. Cross-reference everything with wikilinks or relative links

**Current categories:** concepts, theories, mechanisms, organisms

**Quartz handles all navigation automatically** - no manual configuration files needed.

## excalidraw integration

Excalidraw drawings work seamlessly across all devices and auto-convert to images on the website.

**How it works:**
1. Create drawings in Obsidian using Excalidraw plugin on any device
2. Use standard Obsidian syntax: `![[drawing.excalidraw]]` in your markdown
3. Enable auto-export in Excalidraw settings (PNG format, same folder as drawing)
4. Syncthing syncs both the .excalidraw.md file and the exported PNG
5. When published, mkdocs-obsidian-excalidraw-plugin converts the syntax to standard markdown images

**Setup (one time):**
- Excalidraw plugin settings → ✅ Auto export PNG → ✅ Keep same folder as drawing
- No manual syntax conversion needed - it's fully automatic

**Result:** Mobile editing, cross-device sync, automatic web publishing. Draw on phone, appears on website.

## debugging css problems properly

**Don't guess at CSS selectors based on React/TSX components** - the actual DOM might have extra wrapper divs. Always check DevTools Elements panel first.

**For click blocking issues on mobile:**
```js
// In browser console at mobile viewport, find what's actually catching clicks:
document.elementFromPoint(10, 10)  // returns the topmost element at that coordinate
```

**For CSS custom property cascade issues:**
```js  
// Check if attribute is set correctly:
document.documentElement.getAttribute('saved-theme')

// Check what value actually wins the cascade:
getComputedStyle(document.documentElement).getPropertyValue('--light').trim()
```

**In DevTools:**
- Elements panel → select :root → Computed tab → filter for custom property name to see which rule wins
- Layers panel (More tools → Layers) to visualize z-index stacking
- Check for `@media (prefers-color-scheme)` blocks that might override theme variables later in cascade

## obsidian plugin debugging patterns

**Check for corrupted plugin installations first:**
```bash
# Plugin should have these 3 files at minimum:
ls .obsidian/plugins/plugin-name/
# Expected: main.js, manifest.json, data.json
# Missing main.js/manifest.json = corrupted installation
```

**Plugin data persistence across uninstall/reinstall:**
- Obsidian preserves `data.json` (user settings) when uninstalling plugins
- Removes `main.js`, `manifest.json`, `styles.css` (executable files)
- This means broken configs can survive reinstallation
- For clean slate: manually delete entire plugin folder before reinstalling

**QuickAdd GUI is broken - use JSON configuration:**
- "Add Choice" button defaults to Template type with no way to change to Multi
- Direct JSON editing in `data.json` is more reliable than GUI
- Use UUIDs for choice IDs: `[System.Guid]::NewGuid().ToString()` in PowerShell
- Multi choice format: `"children": ["uuid1", "uuid2"]` array of child choice IDs

## gemini analysis templates

Use these prompts with the `gemini -p "prompt" @file.md` command to get structural analysis of documents:

### structural analysis template
```
I am trying to improve the structure and flow of this article. The goal is to create a document that builds logically from first principles, introduces problems before solutions, and maintains consistent voice throughout. The intended audience is intelligent readers familiar with rationalist concepts who do not need dumbed-down explanations but appreciate clear progression of ideas.

What structural problems do you notice in this article? Are there issues with redundancy, flow, logical progression, or sections that feel disconnected? Does the article successfully motivate each concept before explaining it, or does it jump to solutions without properly setting up the problems? Please be specific about which sections have issues and suggest concrete improvements.
```

### voice consistency template  
```
Analyze this document for voice and tone consistency. The target audience is LessWrong veterans and researchers who prefer precise, substantive content. Look for: patronizing language, inconsistent formality levels, sections that sound like different authors, unclear transitions between concepts. Point out specific examples of voice problems and suggest how to fix them.
```

## writing for intelligent readers

This site's audience includes LessWrong veterans, researchers, and people who read technical content for fun. Avoid patronizing tone:

- **Don't use condescending phrases** ("Think of it as...", "This is essentially...", "How do you...")
- **Avoid oversimplified explanations** of sophisticated concepts 
- **Use precise technical language** instead of dumbed-down analogies
- **Build from first principles is fine** - just don't talk down while doing it

Wrong: "Think of it as evolution turning against itself to stop cells from competing"
Right: "Multicellular organisms suppress intra-organismal evolution through..."

## current workflow (quartz 4 setup)

**Working publishing workflow:**
1. Write/edit content in Obsidian on any device
2. Syncthing syncs content automatically across devices (mobile ↔ PC)
3. Git commit and push from PC only (when ready to publish)
4. GitHub Actions builds and deploys via Quartz 4

**Critical workflow requirements:**
- **PC**: Both Syncthing + Git enabled
- **Mobile**: Syncthing only - Git plugin must be DISABLED on mobile devices
- **Syncthing**: `.stignore` file protects `.git` and `public/` from sync conflicts

**Excalidraw integration:**
- Create drawings using `![[drawing.excalidraw]]` syntax in Obsidian
- Must enable PNG auto-export in Obsidian Excalidraw plugin settings
- Drawings sync across devices via Syncthing, display as images on web

**Build commands:**
```bash
npx quartz build    # local build to public/
npm run docs        # build + serve locally
```

## Quartz Component Architecture Patterns

**CRITICAL: Don't reinvent Quartz components with inline hacks**

When creating or modifying Quartz components, ALWAYS follow the established patterns. The TagExplorer disaster showed what happens when you ignore these:

### How Quartz components actually work

**External files pattern (the right way):**
- `ComponentName.tsx` - Clean JSX template with proper TypeScript types
- `styles/componentName.scss` - External SCSS file for all styling
- `scripts/componentName.inline.ts` - External TypeScript for interaction logic
- Import external files: `import style from "./styles/componentName.scss"`

**DON'T do inline hacks:**
```typescript
// WRONG - inline CSS strings
ComponentName.css = `
  .some-class { color: red; }
`

// WRONG - inline JavaScript strings  
ComponentName.afterDOMLoaded = `
  document.querySelector('.thing').addEventListener('click', ...);
`
```

### Study existing components before coding

Before implementing any new component functionality, study how existing components handle it:

- **Collapsible behavior**: Check `Explorer.tsx` and `TableOfContents.tsx` 
- **Grid animations**: Use `grid-template-rows: 0fr` to `1fr`, not max-height hacks
- **Mobile responsive**: Check Explorer's mobile patterns with proper breakpoint handling
- **State persistence**: Look at how Explorer saves/restores state in localStorage
- **Accessibility**: Copy ARIA patterns from existing components

### Component checklist before submitting

- [ ] External SCSS file with proper imports and variables
- [ ] External TypeScript file for interactions (no inline strings)
- [ ] Clean JSX template without inline styles/scripts
- [ ] Follows existing component patterns (Explorer, TOC, etc.)
- [ ] Uses established animation patterns (CSS Grid, not hacks)
- [ ] Proper TypeScript types and error handling
- [ ] ARIA attributes copied from similar components

### Red flags that indicate you're doing it wrong

- Writing CSS in template literal strings
- Writing JavaScript in template literal strings  
- Trying to "fix" animation with `max-height` transitions
- Reinventing interaction patterns that already exist
- Not studying how similar components work first

### When you see bad patterns in the codebase

If you encounter components with inline CSS/JS (legacy code), don't copy those patterns. Always check the newest, cleanest components like Explorer and TableOfContents for the right way to structure things.

**The rule**: If Explorer or TOC doesn't do it that way, you probably shouldn't either.

---

*Last updated: August 2025 (post-TagExplorer architecture lesson)*