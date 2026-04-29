# Iconoplasm Extension

This folder is the canonical unpacked Chrome extension root for Iconoplasm.

Chesterton's fence: this folder is the runtime client, not the authoring workstation. If the published catalog, alias export, or Website Ops payload looks wrong, start in `D:\Coding\Iconoplasm` first. `D:\Coding\Datasets\iconoplasm` is the data/state root that the workstation reads from and writes to.

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

## Store publishing

The local Iconoplasm GUI owns the human release trigger. GitHub Actions workflows are the execution targets after a person confirms the publish from Website Ops.

Canonical path:

- GUI surface: `D:\Coding\Iconoplasm` -> Website Ops -> Store publish
- GitHub Actions workflow: `.github/workflows/publish-iconoplasm-firefox.yml`
- GitHub Actions workflow: `.github/workflows/publish-iconoplasm-edge.yml`

What the GUI-confirmed Firefox + Edge release does:

- bumps `iconoplasm-extension/manifest.json` to the next requested version
- commits only the manifest version bump
- pushes the version bump to `main`
- dispatches the Firefox workflow against that committed version
- dispatches the Edge workflow against that committed version
- builds the clean Firefox extension payload with `npm run package:iconoplasm-firefox`
- builds the clean Chromium/Edge payload with `npm run package:iconoplasm-extension`
- submits Firefox to AMO for signing/review
- submits Edge to Microsoft Edge Add-ons for package validation and review
- uploads store package artifacts back to the workflow runs

Publish guard:

- the workflow is `workflow_dispatch` only
- the workflow requires the exact phrase `YES, I AM A HUMAN, PUBLISH ICONOPLASM`
- the supported trigger is the Iconoplasm GUI button labeled for the next version and `Firefox + Edge`
- do not trigger store publish from unattended CLI, LLM, scheduled job, website deploy automation, push, or cron

Required GitHub repository secrets:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`
- `EDGE_ADDONS_CLIENT_ID`
- `EDGE_ADDONS_API_KEY`

Notes:

- `manifest.json` now carries the Gecko ID `iconoplasm@brinedew.bio`, which Firefox signing requires
- Edge Product ID is `b8547df3-4156-4b56-b7dc-3752347b6794`
- the workflows are manual on purpose so a website push does not accidentally submit a store build
- before this workflow existed, there was no Firefox store automation in this repo at all
- before the Edge product was created in Partner Center, the Edge API could not publish Iconoplasm because Microsoft only exposes update APIs for existing products

Chrome Web Store publishing remains human-dashboard only. Package with `npm run package:iconoplasm-extension`, then use the Chrome Web Store dashboard as a person; there is no automated Chrome publish runner here.

AMO-specific listing copy lives in:

- `iconoplasm-extension/store-assets/AMO-LISTING-COPY.md`
