# brinedew.com setup notes

*For Claude Code and anyone else working on this site*

---

## what this thing is

Personal longevity research blog built with MkDocs Material. Think of it as a fancy markdown-to-website converter that handles all the boring stuff automatically.

The basic flow: write markdown in `docs/`, push to GitHub, CI builds the site, GitHub Pages serves it at brinedew.com. Takes about 60 seconds from push to live.

## how to actually use it

**Local development (PC only):**
```bash
mkdocs serve    # preview at localhost:8000
mkdocs build    # build to ./site (optional, CI does this)
```

**Content workflow (mobile-first):**
1. Write markdown in Obsidian on any device (phone, tablet, PC)
2. Syncthing syncs content automatically across all devices
3. When ready to publish: Git commit and push from PC
4. Wait a minute, check brinedew.com

**Device setup:**
- **Mobile devices**: Obsidian with Git plugins disabled, Syncthing enabled
- **PC**: Obsidian with Git enabled, Syncthing enabled with `.stignore` protection
- **Syncthing ignores**: `.git` folder (prevents corruption) and `site/` folder (build output)

Don't overthink it. Edit anywhere, publish from PC, CI does the rest.

## file structure that matters

- `docs/` - all your markdown content lives here
- `docs/assets/images/` - throw images here
- `mkdocs.yml` - site config (theme, plugins, nav)
- `.github/workflows/deploy.yml` - the magic that builds and deploys
- `site/` - build output (git ignores this, CI handles it)

## navigation works automatically

We're using the awesome-pages plugin, which means:
- **New markdown files show up in nav automatically**
- **No need to create .pages files** - navigation is generated from file structure
- **No need to manually edit mkdocs.yml** for every new page
- Files appear in alphabetical order by default
- Put `index.md` in folders to create section landing pages

**Important: Don't create .pages files.** The wiki navigation auto-generates from your actual file structure, so just create the markdown files you want.

## styling notes

Using Material theme with custom CSS in `docs/stylesheets/extra.css`. 

**Don't mess with base theme variables** - it breaks the dark/light mode toggle. Only override component-specific stuff like `--md-typeset-table-color`.

Use `/docs/posts/Dark Mode Test Page.md` to test color changes work in both modes.

## when things break

**Links broken?** CI fails with strict mode enabled. Fix the markdown links.

**Site not updating?** Check GitHub Actions tab. Build probably failed.

**Git corruption (fatal: loose object is corrupt)?** This happens when Syncthing and Git conflict:
1. Back up your `docs/` content to a safe location
2. Delete the corrupted Website folder
3. `git clone https://github.com/Brinedew/brinedew-site.git Website`
4. Restore your content from backup
5. Verify `.stignore` file exists with `.git` and `site` entries
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
3. Installs Python + MkDocs + plugins 
4. Runs `mkdocs build --strict --verbose`
5. Uploads the `./site` directory as a Pages artifact
6. Deploys to GitHub Pages

No gh-pages branch, no manual deployment commands. Just push and wait.

## plugins we're using

- `mkdocs-material` - the pretty theme
- `mkdocs-awesome-pages-plugin` - automatic navigation
- `mkdocs-redirects` - URL redirects
- `pymdown-extensions` - better markdown (math, syntax highlighting, etc.)

All installed automatically by CI.

## things to not touch

- `.github/workflows/deploy.yml` permissions (required for Pages)
- `strict: true` in mkdocs.yml (catches broken links)
- Base theme color variables (breaks dark mode toggle)

## wiki structure

`/docs/wiki/` has hierarchical organization for longevity research concepts. Navigation auto-generates from file structure. Each category gets its own subfolder with an index page.

**To add new wiki content:**
1. Create markdown files in the appropriate folder
2. That's it - navigation updates automatically
3. Cross-reference everything with relative links

**Current categories:** concepts, theories, mechanisms, organisms

**Don't create .pages files** - they're not needed and will break the auto-navigation.

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

---

*Last updated: whenever I remembered to update this*