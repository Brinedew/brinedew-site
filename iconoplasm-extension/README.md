# Iconoplasm Extension

This folder is the canonical unpacked Chrome extension root for Iconoplasm.

Generated catalog facts and portraits are authored by the Iconoplasm workstation. The small publication-alias overlay is website-owned. Edit `workers/iconoplasm-publication-aliases.js` for a curated page label; use Website Ops only for generated catalog or portrait state.

The complete ownership, runtime, performance, maintenance, and rollback contract is in `../docs/ICONOPLASM_PUBLICATION_ALIASES.md`.

## Packaging the extension safely

Do not zip this whole folder by hand.

That will drag in `store-assets/`, screenshots, promo files, and any local Playwright install under `store-assets/node_modules/`, which are dev-only and should not ship.

Use the repo-level package command instead:

- `pnpm run package:iconoplasm-extension`
- `pnpm run package:iconoplasm-firefox`
- `pnpm run package:iconoplasm-safari`

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
- Safari web-extension staged payload: `iconoplasm-extension/dist/safari-package/`
- Safari web-extension zip: `iconoplasm-extension/dist/iconoplasm-safari-webext-v<version>.zip`

For AMO's first upload screen, select:

- `iconoplasm-extension/dist/iconoplasm-firefox-v<version>.zip`

If AMO asks for a source code package during review, create it with:

- `pnpm run package:iconoplasm-firefox-source`

That writes:

- `iconoplasm-extension/dist/iconoplasm-firefox-source-v<version>.zip`

## Store publishing

Detailed store status handoff lives in the private tracker and local Iconoplasm workstation code. Keep this public repo documentation limited to packaging and release mechanics; do not paste private dashboard notes, review status details, or secret values here.

The local Iconoplasm GUI owns the human release trigger. GitHub Actions workflows are the execution targets after a person confirms the publish from Website Ops.

Canonical path:

- GUI surface: `D:\Coding\Iconoplasm` -> Website Ops -> Store publish
- GitHub Actions workflow: `.github/workflows/publish-iconoplasm-firefox.yml`
- GitHub Actions workflow: `.github/workflows/publish-iconoplasm-edge.yml`

What the GUI-confirmed Firefox + Edge release does:

- bumps `iconoplasm-extension/manifest.json` to the next requested version
- prepends `content/wiki/Iconoplasm Patch Notes.md`
- rebuilds the public Chrome developer package and updates its release metadata
- commits the manifest, patch notes, release metadata, and public package
- pushes the release commit to `main`
- dispatches the Firefox workflow against that committed version
- dispatches the Edge workflow against that committed version
- builds the clean Firefox extension payload with `pnpm run package:iconoplasm-firefox`
- builds the clean Chromium/Edge payload with `pnpm run package:iconoplasm-extension`
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

Chrome Web Store publishing remains human-dashboard only. Package with `pnpm run package:iconoplasm-extension`, then use the Chrome Web Store dashboard as a person; there is no automated Chrome publish runner here.

Safari publishing is not another browser ZIP upload. `pnpm run package:iconoplasm-safari` creates the Safari-targeted WebExtension payload that Apple tooling can consume, but App Store distribution still needs Xcode/App Store Connect to wrap, sign, and submit it as a native macOS/iOS app.

Mobile publishing is a separate release track, not a rename of the desktop cards:

- Firefox Android is the first viable mobile target. AMO has a Firefox Android catalog, but Iconoplasm is currently marked and described as desktop-only, so the next store step is Android compatibility testing plus AMO listing support for Android.
- Safari on iPhone and iPad needs a Safari Web Extension wrapper inside an iOS app and App Store Connect review. The current WebExtension zip is not enough.
- Samsung Internet for Android has its own extension program and needs separate compatibility and submission work.
- Edge Android advertises mobile extensions, but Iconoplasm still needs a real install-path verification before the site should promise a live mobile Edge install.
- Chrome Android does not have the normal Chrome Web Store extension install path. Do not show Chrome Android users desktop sideload instructions.

AMO-specific listing copy lives in:

- `iconoplasm-extension/store-assets/AMO-LISTING-COPY.md`
