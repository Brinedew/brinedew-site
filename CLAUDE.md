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
- **All devices**: Single shared Obsidian vault in `content/` folder
- **Mobile devices**: Full Obsidian functionality, git plugin folder ignored by Syncthing
- **PC**: Same vault plus git plugin for commits/pushes
- **Syncthing ignores**: `.git` folder, git plugin folder, and build outputs via `.stignore`

Don't overthink it. Edit anywhere, publish from PC, CI does the rest.

## file structure that matters

- `content/` - **main Obsidian vault** with all markdown content
- `content/.obsidian/` - Obsidian vault settings and plugins (shared across devices)
- `content/posts/` - blog posts with `content/post` tags
- `content/wiki/` - **flat structure** with tag-based organization
- `content/Attachments/` - images and Excalidraw drawings
- `content/Templates/` - QuickAdd templates for posts, wiki pages, proteins
- `quartz.config.ts` - site config (theme, plugins, nav)
- `public/` - build output (ignored by git and Syncthing)

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

**Excalidraw drawings showing as text links instead of images?** Current settings have PNG auto-export **disabled** but SVG export enabled. Drawings appear as embedded SVG images on the website. If you want PNG export instead:
1. Open Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. Note: PNG files are ignored by git via `.gitignore` but SVG files are committed

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

## current wiki folder structure (flattened)

`content/wiki/` uses **flat organization with tags** instead of folder hierarchy. All 65+ wiki entries live directly in `/wiki/` root.

**Current tag taxonomy:**
- `content/wiki` - all wiki content
- `content/post` - blog posts
- `content/apps` - interactive pages
- `meta` - technical, infrastructure and maintenance pages
- `protein` tag for protein pages (AKT, p53, etc.)

**To add new wiki content:**
1. Create markdown file directly in `wiki/` folder
2. Add proper tags instead of using subfolders
3. Use QuickAdd (Ctrl+N → Wiki Page) for automated setup
4. Cross-reference with wikilinks: `[[cellular-senescence]]`

## excalidraw integration (current setup)

**How drawings work now:**
1. Create drawings using Excalidraw plugin: `![[drawing.excalidraw]]`
2. Drawings stored as `.excalidraw.md` files in `Attachments/` folder
3. **SVG auto-export enabled**, PNG auto-export disabled
4. Both .excalidraw.md and .svg files sync via Syncthing
5. Website displays embedded SVG images (vector graphics, scalable)

**Current settings:**
- Auto-export SVG: ✅ Enabled (committed to git)
- Auto-export PNG: ❌ Disabled (ignored by git anyway)
- Folder: `Excalidraw/` (but drawings can be anywhere)

**Result:** Draw on any device, SVG versions appear on website as crisp vector graphics.

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

## current obsidian plugin setup

**Active plugins in content vault:**
- **obsidian-excalidraw-plugin** - drawing integration with SVG export
- **quickadd** - automated note creation (Ctrl+N → Post/Wiki/Protein templates)
- **obsidian-git** - PC only, ignored on mobile via Syncthing
- **dataview** - dynamic content queries
- **templater-obsidian** - advanced templating
- **tag-wrangler** - tag management tools
- **obsidian-admonition** - callout blocks
- Plus: editing-toolbar, table-editor, multi-column-markdown, etc.

**Plugin configuration notes:**
- QuickAdd has working multi-choice setup: "Create New Note" → Post/Wiki Page/Protein Page
- Git plugin auto-pulls every 4 minutes, auto-commits after file changes
- All plugin settings sync between devices except git plugin (Syncthing ignores it)

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

## current workflow (updated for single vault)

**Working publishing workflow:**
1. Write/edit content in shared Obsidian vault (`content/`) on any device
2. Syncthing syncs vault automatically across all devices
3. Git operations happen from PC only (git plugin ignored on mobile)
4. Push commits → GitHub Actions builds and deploys via Quartz 4

**Device synchronization:**
- **All devices**: Share same `content/` vault via Syncthing
- **PC**: Git plugin active, handles commits/pushes automatically
- **Mobile**: Git plugin folder ignored, no git operations
- **Syncthing**: `.stignore` prevents git conflicts and build output sync

**Content creation workflow:**
- **PC or Mobile**: Ctrl+N → Choose Post/Wiki/Protein template
- **PC or Mobile**: Edit with full Obsidian features (tags, links, drawings)
- **PC only**: Git commits happen automatically after changes
- **All devices**: See updates via Syncthing within seconds

**Build commands (PC only):**
```bash
npx quartz build    # local build to public/
npm run docs        # build + serve locally at localhost:8080
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

## quickadd workflow automation

**Current working setup:**
- **Ctrl+N** opens multi-choice dialog: Post, Wiki Page, Protein Page
- **Post template** creates in `posts/` with `content/post` tag and draft: true
- **Wiki template** creates in `wiki/` with `content/wiki` tag
- **Protein template** creates structured protein pages with UniProt fields
- All templates use proper frontmatter with title, date, tags

**Template locations:**
- `content/Templates/Post Template.md`
- `content/Templates/Wiki Template QuickAdd.md` 
- `content/Templates/Protein Template QuickAdd.md`

**QuickAdd configuration stored in:** `content/.obsidian/plugins/quickadd/data.json`

## quartz draft system patterns

**RemoveDrafts is build-time filtering:** Files with `draft: true` don't exist on live site at all - they're excluded during build, not just hidden from navigation. Much stronger than tag-based hiding.

**Draft property vs status tags:** Use frontmatter `draft: true/false` instead of `status/published` tags. Integrates with Quartz's built-in filtering and follows static site conventions.

**Bulk content property changes:** When switching systems (tags → properties), use PowerShell scripts with regex frontmatter parsing instead of YAML libraries to avoid dependency issues.

**Content organization during migrations:** Always check for referenced files before deletion. `grep` for filenames/paths to avoid breaking image links or important data files disguised as "test" content.

**Put scripts in scripts/ folder:** Don't create PowerShell or Python scripts in the project root. Always use `scripts/` directory to keep tools organized and separate from content.

---

*Last updated: August 2025 (post-QuickAdd/Draft system implementation)*
