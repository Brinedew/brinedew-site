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