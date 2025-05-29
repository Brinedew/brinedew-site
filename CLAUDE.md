# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

This is a personal website built with MkDocs Material that combines:

1. **Documentation Site** (`docs/` → `site/`): Main website content using MkDocs Material theme
2. **Decap CMS Integration**: Content management system for editing markdown files via web interface
3. **Cloudflare Worker Proxy** (`decap-proxy/`): GitHub OAuth proxy for Decap CMS authentication

### Key Components

- **MkDocs Site**: Primary content in `docs/` with Material theme, custom CSS, and multiple markdown extensions
- **Decap CMS**: Admin interface at `/admin/` for content editing with GitHub backend
- **Cloudflare Worker**: Separate authentication proxy deployed to handle GitHub OAuth for Decap CMS

## Common Commands

### Documentation Site (MkDocs)
```bash
# Build and serve the site locally (if mkdocs installed)
mkdocs serve

# Build static site to site/ directory
mkdocs build
```

**Important**: The site uses automated deployment via GitHub Actions. Changes to `docs/` content and CSS are automatically built and deployed when pushed to the main branch. Manual building is only needed for local development.

### Decap Proxy (Cloudflare Worker)
```bash
# Navigate to decap-proxy directory first
cd decap-proxy

# Local development
npm run dev
# or
yarn dev

# Deploy to Cloudflare
npm run deploy
# or 
yarn deploy

# Run tests
npm test
# or
yarn test

# Debug tests
npm run test:debug
# or
yarn test:debug
```

## Configuration Files

- `mkdocs.yml`: Site configuration, theme settings, plugins, and markdown extensions
- `docs/admin/config.yml`: Decap CMS configuration with GitHub backend and collection definitions
- `decap-proxy/wrangler.toml`: Cloudflare Worker deployment configuration
- `decap-proxy/package.json`: Worker dependencies and scripts
- `.github/workflows/deploy.yml`: GitHub Actions workflow for automated site deployment

## Content Structure

- `docs/`: Markdown content files for the website
- `docs/assets/images/`: Media files uploaded through Decap CMS
- `docs/admin/`: Decap CMS admin interface files
- `site/`: Generated static site output (built by MkDocs)

## Authentication Flow

The Decap CMS uses the Cloudflare Worker as a GitHub OAuth proxy. The worker handles:
1. GitHub OAuth authentication
2. Token exchange for API access
3. CORS handling for the admin interface

Users access the CMS at `/admin/` which authenticates through the deployed worker at the configured `base_url`.

## Deployment Workflow

The site uses GitHub Actions for automated deployment:

1. **Trigger**: Any push to the `main` branch triggers the deployment workflow
2. **Build Process**: GitHub Actions installs MkDocs, Material theme, and required plugins
3. **Deployment**: Uses `mkdocs gh-deploy` to build and push to GitHub Pages
4. **Dependencies Installed**: mkdocs, mkdocs-material, mkdocs-awesome-pages-plugin, mkdocs-redirects, pymdown-extensions

**Key Points**:
- Changes to `docs/` content, CSS, or `mkdocs.yml` automatically trigger rebuilds
- The `site/` directory in the repo is not used for production (GitHub Pages serves from gh-pages branch)
- Build takes ~2-3 minutes after pushing changes
- No manual intervention needed for deployment

## CSS and Styling Notes

**Important for CSS changes**:
- Material theme has strong CSS precedence - use `!important` declarations for critical styles
- Set `font: false` in `mkdocs.yml` to disable theme font overrides
- Custom CSS is loaded via `extra_css: - stylesheets/extra.css` in mkdocs.yml
- Global CSS variable overrides may be needed for Material theme variables like `--md-text-font`

**Troubleshooting CSS issues**:
- If changes don't appear: check browser cache (hard refresh) and verify CSS precedence
- Material theme CSS loads after custom CSS, so use `!important` for font families and critical styles