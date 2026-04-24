# Iconoplasm Extension

This folder is the canonical unpacked Chrome extension root for Iconoplasm.

Chesterton's fence: this folder is the runtime client, not the authoring workstation. If the published catalog, alias export, or Website Ops payload looks wrong, start in `d:\Coding\Datasets\iconoplasm` first. That sibling repo is the local control plane that publishes the catalog facts this extension consumes.

Reason for the move:

- keep the extension code easy to find from the website repo
- keep the tooltip/frontpage design work close together
- avoid losing track of the relevant files across two unrelated locations
- keep a single source of truth for local Chrome testing and future store packaging

## Packaging the extension safely

Do not zip this whole folder by hand.

That will drag in `store-assets/`, screenshots, promo files, and any local Playwright install under `store-assets/node_modules/`, which are dev-only and should not ship.

Use the repo-level package command instead:

- `npm run package:iconoplasm-extension`
- `npm run package:iconoplasm-firefox`

What it does:

- copies only runtime files (`manifest.json`, JS/CSS/HTML, fonts, generated assets, icons)
- excludes `store-assets/`, docs, and other non-runtime files
- scans the staged payload for obvious secret patterns before zipping
- writes the clean package to `iconoplasm-extension/dist/`

Current output:

- Chromium/manual staged runtime payload: `iconoplasm-extension/dist/package/`
- Chromium/manual zip: `iconoplasm-extension/dist/iconoplasm-extension-v<version>.zip`
- Firefox staged runtime payload: `iconoplasm-extension/dist/firefox-package/`
- Firefox/AMO upload zip: `iconoplasm-extension/dist/iconoplasm-firefox-v<version>.zip`

For AMO's first upload screen, select:

- `iconoplasm-extension/dist/iconoplasm-firefox-v<version>.zip`

If AMO asks for a source code package during review, create it with:

- `npm run package:iconoplasm-firefox-source`

That writes:

- `iconoplasm-extension/dist/iconoplasm-firefox-source-v<version>.zip`

## Firefox publishing

This repo now owns the Firefox publish path too.

Canonical path:

- GitHub Actions workflow: `.github/workflows/publish-iconoplasm-firefox.yml`

What it does:

- installs website dependencies
- builds the clean Firefox extension payload with `npm run package:iconoplasm-firefox`
- runs `web-ext lint` against the staged runtime folder
- submits the extension to AMO for signing/review
- uploads the signed Firefox artifact back to the workflow run

Required GitHub repository secrets:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Notes:

- `manifest.json` now carries the Gecko ID `iconoplasm@brinedew.bio`, which Firefox signing requires
- the workflow is manual on purpose so a website push does not accidentally submit a store build
- before this workflow existed, there was no Firefox store automation in this repo at all

AMO-specific listing copy lives in:

- `iconoplasm-extension/store-assets/AMO-LISTING-COPY.md`
