# CLAUDE.md

*Guidance for Claude Code (claude.ai/code) and other automated editors working with this repository.*

---

## Project Architecture

This personal website combines:

1. **Documentation Site** (`docs/` → build output): Main content rendered with **MkDocs Material**
2. **Decap CMS** (`docs/admin/`): In‑browser markdown editing using the GitHub backend
3. **Cloudflare Worker Proxy** (`decap-proxy/`): GitHub OAuth proxy for Decap CMS authentication

### Key Components *(unchanged)*

* **MkDocs site** — primary content in `docs/`, Material theme, custom CSS, multiple markdown extensions
* **Decap CMS** — admin interface at `/admin/` for content editing
* **Cloudflare Worker** — handles OAuth and CORS for the CMS (regular folder; *no longer a Git submodule*)

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

### Decap Proxy (Cloudflare Worker)

```bash
cd decap-proxy

# Local dev
yarn dev   # or npm run dev

# Deploy to Cloudflare
yarn deploy   # or npm run deploy

yarn test     # run unit tests
yarn test:debug
```

---

## Configuration Files

* `mkdocs.yml` — site configuration, theme, plugins, markdown extensions
* `docs/admin/config.yml` — Decap CMS configuration
* `decap-proxy/wrangler.toml` — Cloudflare Worker deployment settings
* `decap-proxy/package.json` — dependencies & scripts for the worker
* `.github/workflows/deploy.yml` — GitHub Actions workflow (artifact‑based Pages deployment)

---

## Content Structure

* `docs/` — Markdown content
* `docs/assets/images/` — Media managed by Decap CMS
* `docs/admin/` — CMS UI
* `site/` — Local build output *(not committed; CI artifacts only)*

---

## Authentication Flow (CMS)

1. User visits `/admin/`.
2. CMS initiates GitHub OAuth.
3. Cloudflare Worker (`decap‑proxy`) exchanges the code for a token and returns it to the CMS.

---

## Deployment Workflow **(updated 2025‑05‑30)**

| Step                   | Action                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| **1. Trigger**         | Push to `main` branch.                                                    |
| **2. Build**           | CI installs MkDocs & plugins, then `mkdocs build --strict` into `./site`. |
| **3. Artifact Upload** | `actions/upload-pages-artifact@v3` stores `./site` as the Pages artifact. |
| **4. Deploy**          | `actions/deploy-pages@v4` publishes the artifact to GitHub Pages.         |

### Key Points

* **No `gh-pages` branch** is used; Pages serves the artifact produced by CI.
* Broken internal links cause CI failure because `mkdocs.yml` sets `strict: true`.
* Typical build + deploy time: **≈ 60 seconds**.
* Manual `mkdocs gh-deploy` is obsolete — do not run it.

---

## CSS and Styling Notes *(verbatim — still relevant)*

> *Material theme overrides many styles; use `!important` sparingly and prefer theme variables.*

* Custom CSS: `extra_css:` in `mkdocs.yml` points to `stylesheets/extra.css`.
* Use Material CSS variables (`--md-*`) instead of hard‑coded colors.
* Hard‑refresh the browser when styles don’t reflect.

---

## Development Best Practices *(verbatim — still relevant)*

1. Inspect existing elements before changing CSS.
2. Follow existing patterns; match fonts, sizes, colors.
3. Use theme variables; don’t hard‑code.
4. Test responsive layouts.
5. Use proper DOM elements for interactivity.

**Avoid:** guessing values, pseudo‑element hacks, ignoring mobile, mixing fonts, hard‑coding theme colors.

---

## Obsolete Elements Removed in This Revision

* References to `mkdocs gh-deploy` and the `gh-pages` branch.
* Statement that `decap-proxy` is a Git submodule.

---

**Last updated:** 2025‑05‑30
