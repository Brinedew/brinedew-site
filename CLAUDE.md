# brinedew.com setup notes

*For Claude Code and anyone else working on this site*

---

## what this thing is

Personal longevity research blog built with MkDocs Material. Think of it as a fancy markdown-to-website converter that handles all the boring stuff automatically.

The basic flow: write markdown in `docs/`, push to GitHub, CI builds the site, GitHub Pages serves it at brinedew.com. Takes about 60 seconds from push to live.

## how to actually use it

**Local development:**
```bash
mkdocs serve    # preview at localhost:8000
mkdocs build    # build to ./site (optional, CI does this)
```

**Content workflow:**
1. Write markdown in `docs/`
2. Push to main branch
3. Wait a minute, check brinedew.com

Don't overthink it. The CI does everything.

## file structure that matters

- `docs/` - all your markdown content lives here
- `docs/assets/images/` - throw images here
- `mkdocs.yml` - site config (theme, plugins, nav)
- `.github/workflows/deploy.yml` - the magic that builds and deploys
- `site/` - build output (git ignores this, CI handles it)

## navigation works automatically

We're using the awesome-pages plugin, which means:
- New markdown files show up in nav automatically
- Want custom ordering? Add a `.pages` file in that directory
- No need to manually edit mkdocs.yml for every new page

Example `.pages` file:
```yaml
title: Section Name
arrange:
  - index.md
  - important-page.md
  - other-page.md
```

## styling notes

Using Material theme with custom CSS in `docs/stylesheets/extra.css`. 

**Don't mess with base theme variables** - it breaks the dark/light mode toggle. Only override component-specific stuff like `--md-typeset-table-color`.

Use `/docs/posts/Dark Mode Test Page.md` to test color changes work in both modes.

## when things break

**Links broken?** CI fails with strict mode enabled. Fix the markdown links.

**Site not updating?** Check GitHub Actions tab. Build probably failed.

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

New as of today: `/docs/wiki/` with hierarchical organization for longevity research concepts. Uses `.pages` files for navigation control. Each category gets its own subfolder with an index page.

Categories: concepts, theories, mechanisms, organisms, animal-models, proteins, pathways, research, papers, researchers.

Cross-reference everything. That's the whole point of a wiki.

---

*Last updated: whenever I remembered to update this*