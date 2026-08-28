# Iconoplasm Extension

This folder is the canonical unpacked Chrome extension root for Iconoplasm.

Generated catalog facts and portraits are authored by the Iconoplasm
workstation. Administrators maintain the small publication-alias desired policy
in `/admin#extension`; the Website stages bounded immutable policy history and
publishes one atomic alias/blocklist recognition pair in the existing catalog
manifest. `workers/iconoplasm-publication-aliases.js` is the first-deploy
bootstrap seed, not the routine editing surface. Use Website Ops only for
generated catalog or portrait state.

The complete ownership, runtime, performance, maintenance, and rollback contract is in `../docs/ICONOPLASM_PUBLICATION_ALIASES.md`.

## PDF Reader

The extension includes one local PDF.js reader. It never uploads PDF bytes or extracted text.

- Chrome 151 and newer expose one **PDF highlighting** setting. Off leaves Chrome's native PDF viewer completely in control. On atomically enables the Iconoplasm PDF reader and its gene highlights; there is no independent routing mode or manual-reader option.
- Firefox uses a separate response-ownership driver but opens the same reader and renderer. Off leaves future HTTP(S) PDFs native; switching Off in an owned document gives the already-captured bytes to Firefox's native viewer through a PDF blob, without replaying the origin request.
- Safari and browsers without a conforming response-ownership primitive keep their built-in PDF viewer and hide the unavailable setting. The project does not emulate ownership with a refetch, proxy, or overlay.
- PDF.js `6.2.108` is pinned, copied locally by `scripts/sync-iconoplasm-pdfjs.mjs`, and shipped with its upstream license. No CDN or remote executable code is used.
- The PDF canvas is never recolored or replaced. Iconoplasm uses the official selectable text layer for first-party decoration geometry. A filled-pill preference becomes an outline pill only inside PDFs; the stored preference and normal webpage treatment remain filled.
- Extracted PDF text is not proof of visible paint. `pdf-text-visibility.mjs` carries explicit Form XObject bounding-box clips, text paint modes, alpha and optional-content visibility onto the official text-layer ranges. It verifies complete per-font character streams before associating operators; mismatched fonts fail closed with a diagnostic. This prevents clipped duplicate figure text from outlining ordinary prose. It is not a general arbitrary-path/soft-mask/overpainting visibility oracle. Never replace it with nearest-label deduplication, guessed offsets, a second render, or modified PDF.js. Zoom, search-split spans and optional-content changes must preserve the association.
- `pdf-ownership-certification.json` is the release truth for each browser adapter. Packaging can produce an engineering candidate; a store workflow may publish only a target whose adapter is certified there.
- Firefox's HTTP(S) adapter is implemented, unit-tested, and certified against GET, one-shot GET, POST, partial-range fallback, and rendered native handoff using a real paper. Firefox local `file:` PDF navigations route into the same private reader; Firefox requires one explicit file-picker or drag/drop handoff because extensions cannot read an arbitrary local path. The reader copies the exact known path during the click so the user can press Ctrl+V and Open instead of navigating from Firefox's default picker folder. Safari remains gated because it has no response-body ownership primitive.
- Only rendered pages within one viewport of the visible region are matched. Image-only PDFs report that no searchable text was found; OCR is not silently attempted.

## Packaging the extension safely

Do not zip this whole folder by hand.

That will drag in `store-assets/`, screenshots, promo files, and any local Playwright install under `store-assets/node_modules/`, which are dev-only and should not ship.

Use the repo-level package commands instead:

- `pnpm run package:iconoplasm-extension`
- `pnpm run package:iconoplasm-firefox`
- `pnpm run package:iconoplasm-edge`
- `pnpm run package:iconoplasm-safari`
- `pnpm run package:iconoplasm-firefox-source`

These commands create engineering validation builds. They deliberately do not
produce a versioned store-release artifact and must not be uploaded to a browser
store.

What it does:

- copies only runtime files (`manifest.json`, JS/CSS/HTML, fonts, generated assets, icons)
- regenerates the pinned local PDF.js runtime before staging
- excludes `store-assets/`, docs, and other non-runtime files
- scans the staged payload for obvious secret patterns before zipping
- writes replaceable validation output under `iconoplasm-extension/dist/validation/`
- labels the installed package `Iconoplasm DEV <fingerprint>`; its numeric base
  version is not proof that it matches a released ZIP
- accepts `--out-dir=<directory>` for isolated tests and build outputs

Validation output:

- Chromium stage: `iconoplasm-extension/dist/validation/generic/package/`
- Chromium zip: `iconoplasm-extension/dist/validation/generic/iconoplasm-extension-validation.zip`
- Firefox stage: `iconoplasm-extension/dist/validation/firefox/package/`
- Firefox zip: `iconoplasm-extension/dist/validation/firefox/iconoplasm-firefox-validation.zip`
- Edge stage: `iconoplasm-extension/dist/validation/edge/package/`
- Edge zip: `iconoplasm-extension/dist/validation/edge/iconoplasm-edge-validation.zip`
- Safari WebExtension stage: `iconoplasm-extension/dist/validation/safari/package/`
- Safari WebExtension zip: `iconoplasm-extension/dist/validation/safari/iconoplasm-safari-webext-validation.zip`
- Firefox reviewer-source stage: `iconoplasm-extension/dist/validation/firefox-source/package/`
- Firefox reviewer-source zip: `iconoplasm-extension/dist/validation/firefox-source/iconoplasm-firefox-source-validation.zip`

Only the human-confirmed GUI release and its GitHub workflows may pass
`--release --expected-version=<version>`. Release builds use
`iconoplasm-extension/dist/release-work/<target>/` for staging and emit the
versioned store ZIP to `iconoplasm-extension/dist/`. The explicit expected
version must match both `manifest.json` and `publisher-release.json`.

For AMO, use the exact Firefox package and reviewer-source ZIP in the immutable
`iconoplasm-v<version>` GitHub release. Its manifest binds all packages to one
source commit and verifies their hashes. Do not rebuild a store upload from
ordinary source. See [release integrity](../docs/ICONOPLASM_RELEASE_INTEGRITY.md).

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
- pins a release tag and dispatches both store workflows from that exact commit
- waits for exact-commit CI, including public-package source parity
- prepares and seals one immutable release containing the exact tested bundles
- downloads and hash-verifies those bundles in both store jobs without rebuilding
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

Chrome Web Store publishing remains human-dashboard only. Upload the exact
versioned Chrome developer package committed by the GUI release transaction at
`quartz/static/iconoplasm/downloads/iconoplasm-extension-v<version>.zip`; do not
rebuild it with the default validation command. There is no automated Chrome
publish runner here.

Safari publishing is not another browser ZIP upload.
`pnpm run package:iconoplasm-safari` creates validation output only. App Store
distribution still needs a human-authorized release build plus Xcode/App Store
Connect to wrap, sign, and submit it as a native macOS/iOS app.

Mobile publishing is a separate release track, not a rename of the desktop cards:

- Firefox Android is the first viable mobile target. AMO has a Firefox Android catalog, but Iconoplasm is currently marked and described as desktop-only, so the next store step is Android compatibility testing plus AMO listing support for Android.
- Safari on iPhone and iPad needs a Safari Web Extension wrapper inside an iOS app and App Store Connect review. The current WebExtension zip is not enough.
- Samsung Internet for Android has its own extension program and needs separate compatibility and submission work.
- Edge Android advertises mobile extensions, but Iconoplasm still needs a real install-path verification before the site should promise a live mobile Edge install.
- Chrome Android does not have the normal Chrome Web Store extension install path. Do not show Chrome Android users desktop sideload instructions.

AMO-specific listing copy lives in:

- `iconoplasm-extension/store-assets/AMO-LISTING-COPY.md`
