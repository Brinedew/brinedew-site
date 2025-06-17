# CLAUDE.md

*Guidance for Claude Code (claude.ai/code) and other automated editors working with this repository.*

---

## Project Architecture

This personal website is a **Documentation Site** built with **MkDocs Material**.

### Key Components

* **MkDocs site** — primary content in `docs/`, Material theme, custom CSS, multiple markdown extensions
* **Content editing** — via Obsidian → GitHub workflow

---

## Common Commands

### Documentation Site (MkDocs)

```bash
# Serve locally
mkdocs serve

# Build static site to ./site (for local inspection)
mkdocs build
```

*(Local `mkdocs build` is optional; CI builds automatically on push.)*

---

## Configuration Files

* `mkdocs.yml` — site configuration, theme, plugins, markdown extensions
* `.github/workflows/deploy.yml` — GitHub Actions workflow (artifact‑based Pages deployment)

---

## Content Structure

* `docs/` — Markdown content
* `docs/assets/images/` — Media files
* `site/` — Local build output *(not committed; CI artifacts only)*

---

## Site Elements

### Sidebars

**Left sidebar** (site navigation):
* **Technical name**: Primary sidebar
* **MkDocs Material class**: `md-sidebar--primary`
* **Purpose**: Site-wide navigation, section menus (e.g., "posts")

**Right sidebar** (page navigation):
* **Technical name**: Secondary sidebar
* **MkDocs Material class**: `md-sidebar--secondary`
* **Purpose**: Page-specific table of contents, in-page navigation

---

## Deployment Workflow **(updated 2025‑05‑30)**

| Step                   | Action                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| **1. Trigger**         | Push to `main` branch.                                                    |
| **2. Build**           | CI installs MkDocs & plugins, then `mkdocs build --strict` into `./site`. |
| **3. Artifact Upload** | `actions/upload-pages-artifact@v3` stores `./site` as the Pages artifact. |
| **4. Deploy**          | `actions/deploy-pages@v4` publishes the artifact to GitHub Pages.         |

### Key Points

* **No `gh-pages` branch** is used; Pages serves the artifact produced by CI.
* Broken internal links cause CI failure because `mkdocs.yml` sets `strict: true`.
* Typical build + deploy time: **≈ 60 seconds**.
* Manual `mkdocs gh-deploy` is obsolete — do not run it.

---

## CSS and Styling Notes

> *Material theme overrides many styles; use `!important` sparingly and prefer theme variables.*

* Custom CSS: `extra_css:` in `mkdocs.yml` points to `stylesheets/extra.css`.
* Use Material CSS variables (`--md-*`) instead of hard‑coded colors.
* Hard‑refresh the browser when styles don't reflect.

### **CRITICAL: Material Theme Color Customization**

**✅ CORRECT Pattern - Component-Specific Variables:**
```css
[data-md-color-scheme="slate"] {
  /* Override ONLY component-specific variables */
  --md-typeset-table-color: #e8e6e3;
  --md-code-bg-color: #1a1b20;
  --md-admonition-bg-color: #1a1b20;
}
```

**❌ WRONG Pattern - Base System Variables:**
```css
[data-md-color-scheme="slate"] {
  /* DON'T override base system variables - breaks theme toggle */
  --md-default-bg-color: #14151a;  /* BREAKS LIGHT MODE */
  --md-default-fg-color: #e8e6e3;  /* BREAKS LIGHT MODE */
}
```

**Why:** Material's theme toggle depends on base variables being defined differently for "default" vs "slate" schemes. Overriding base variables breaks the switching logic.

**Safe Variables to Override:** Component-specific variables like `--md-typeset-*`, `--md-code-*`, `--md-admonition-*`, etc.

**Unsafe Variables:** Base system variables like `--md-default-*`, `--md-primary-*` that control fundamental color inheritance.

---

## Development Best Practices

1. Inspect existing elements before changing CSS.
2. Follow existing patterns; match fonts, sizes, colors.
3. Use theme variables; don't hard‑code.
4. Test responsive layouts.
5. Use proper DOM elements for interactivity.
6. **Test dark/light mode toggle after any color changes.**
7. **Use `/docs/posts/Dark Mode Test Page.md` to verify color customizations.**

**Avoid:** guessing values, pseudo‑element hacks, ignoring mobile, mixing fonts, hard‑coding theme colors, overriding Material's base color system variables.

---

## Git Troubleshooting & Merge Conflict Recovery

### Background (2025‑05‑30 incident)

* Concurrent edits to `.obsidian/workspace.json` created a merge conflict.
* Forced resets exposed an orphaned Git submodule (`decap-proxy`) and deleted built pages, causing a site outage.
* Continuous‑integration (CI) builds failed because MkDocs ran in strict mode and reported unresolved links.

Permanent mitigations now in place:

| Area                        | Commit               | Effect                                                                                     |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| Ignore Obsidian layout file | `xxxxxxx`            | `.obsidian/workspace.json` added to `.gitignore` to prevent further conflicts.             |
| Submodule removed           | `3cdfbcf`            | `decap-proxy` converted to a regular folder; CI no longer fails for missing submodule URL. |
| Modern Pages deployment     | current `deploy.yml` | Uses `actions/deploy-pages` artifact pipeline — no `gh-pages` branch required.             |

### Standard Workflow (AI Editor)

1. **Pull** `origin/main`.
2. Perform edits in the `docs/` directory or other tracked files.
3. **Commit** with a clear message.
4. **Push** to `main`. CI will build and deploy automatically.

> Do not commit `.obsidian/workspace.json`. Git ignores this file by design.

### Merge‑Conflict Recovery (clean, scriptable)

```bash
# Abort any merge in progress
git merge --abort || true

# Ensure local tree matches remote main
git fetch origin
git reset --hard origin/main

# Retry your edits, commit, push
```

The command sequence above is idempotent and safe. It discards only uncommitted local changes.

### Files and Settings to Avoid Modifying

| Item                                                                | Reason                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.git/` internals                                                   | Manual edits risk repository corruption.                                         |
| Permissions in `.github/workflows/deploy.yml` (`pages`, `id-token`) | Required for GitHub Pages OIDC authentication.                                   |
| `strict: true` in `mkdocs.yml`                                      | Disabling strict mode hides link errors; change only with project lead approval. |
| Force‑push to `main`                                                | Allowed only when reverting to a vetted commit hash.                             |

### Reference Commands

```bash
# List commits touching a specific file
git log --oneline -- docs/index.md

# Detect stray submodules (mode 160000)
git ls-files -s | findstr 160000

# Cherry‑pick the decap‑proxy fix onto another commit
git cherry-pick 3cdfbcf
```

---

## Obsolete Elements Removed in This Revision

* References to `mkdocs gh-deploy` and the `gh-pages` branch.
* Statement that `decap-proxy` is a Git submodule.
* Decap CMS configuration and authentication flow documentation.

---

**Last updated:** 2025‑06‑09