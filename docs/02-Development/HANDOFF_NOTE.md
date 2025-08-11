# brinedew mkdocs → quartz migration - Aug 11, 2025

I was migrating brinedew.com from MkDocs Material to Quartz 4, following the detailed plan in `brinedew-v2-plan.md`. The goal was to switch static site generators while keeping the same Obsidian → Git → GitHub Pages → Cloudflare pipeline.

## what actually works now

The migration is basically complete - the site builds and runs at localhost:8080 with all major Quartz features working (search, graph view, backlinks, wikilinks). But there are CSS styling problems that need fixing.

**What I got working:**
- Complete Quartz installation (cloned from GitHub, not npm)
- All 139 markdown files migrated from `docs/` to `content/` with frontmatter added
- Working `quartz.config.ts` with Brinedew-specific settings (dark theme, custom fonts)
- GitHub Actions workflow at `.github/workflows/deploy-quartz.yml`
- CNAME file preserved for GitHub Pages deployment
- Build process works: `npx quartz build`
- Dev server works: `npx quartz serve` on port 8080

**Files I changed:**
- `D:\Coding\Website\quartz.config.ts` - Brinedew config with pageTitle, baseUrl, fonts, dark theme
- `D:\Coding\Website\.github\workflows\deploy-quartz.yml` - GitHub Actions for Quartz deployment
- `D:\Coding\Website\scripts\migrate-content.js` - ES module script that processed all content files
- `D:\Coding\Website\quartz\static\custom.css` - dark mode overrides and typography fixes
- `D:\Coding\Website\quartz\styles\base.scss` - reverted after I broke SCSS compilation

**Migration script worked perfectly:**
```bash
node scripts/migrate-content.js
```
Added proper frontmatter to 139 files, moved everything from `docs/` to `content/`.

## what's broken

**Critical CSS problem**: The custom styles aren't loading properly. Two specific pages have issues:

1. `http://localhost:8080/apps/scriptotic/` - broken styling
2. `http://localhost:8080/posts/Dark-Mode-Test-Page` - broken syntax rendering

The main site loads with Quartz's default styling, but my custom CSS in `quartz/static/custom.css` isn't being included in the HTML head. I created the CSS file and verified it's being served at `/static/custom.css`, but it's not linked in the page.

**What I tried that broke things:**
- First tried `@use "./custom.scss"` import in base.scss - didn't work
- Then appended custom CSS directly to base.scss - this completely broke SCSS compilation
- Had to revert base.scss with `git restore quartz/styles/base.scss`

**Current error:** Custom CSS file exists but isn't included in HTML head.

## where things stand

**Environment working:**
- Node.js v20+ installed and working
- Quartz dev server runs on http://localhost:8080
- All content accessible and searchable
- Git repo on `quartz-migration` branch

**Working commands:**
```bash
cd D:\Coding\Website
npx quartz serve  # starts dev server
npx quartz build  # builds static site
git status        # shows changes on branch
```

**Ready for deployment:** Once CSS is fixed, just need to merge branch and push to main for GitHub Pages deployment.

## what to do next

**URGENT: Fix CSS inclusion**
The custom.css file exists at `D:\Coding\Website\quartz\static\custom.css` but isn't being loaded. Need to modify the Head component to include:
```html
<link href="/static/custom.css" rel="stylesheet" type="text/css" />
```

Look at `D:\Coding\Website\quartz\components\Head.tsx` - that's where HTML head tags get generated. Add the link tag there.

**After CSS works:**
1. Test that both broken pages render properly
2. Complete Phase 6: merge `quartz-migration` branch to main and push to GitHub
3. Verify GitHub Actions deploys successfully
4. Check that brinedew.com loads with new Quartz site

## stuff to remember

**Critical installation insight:** Quartz can't be installed via npm. Must clone from GitHub:
```bash
git clone https://github.com/jackyzha0/quartz.git
# NOT: npm install @jackyzha0/quartz
```

**SCSS compilation is fragile:** Don't append raw CSS to .scss files - it breaks the Sass compiler completely. Use static CSS files instead.

**Port management:** If dev server won't start due to port in use, kill the process:
```bash
# Find the process
netstat -ano | findstr :8080
# Kill it
taskkill /PID <process-id> /F
```

**File structure:** Content lives in `content/`, not `docs/`. Static assets go in `quartz/static/`. The migration script handles frontmatter perfectly - don't redo that work.

The site is 95% working. Just need to get the custom CSS included properly, then deploy to production.