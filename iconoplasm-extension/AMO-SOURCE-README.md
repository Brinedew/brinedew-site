# Iconoplasm AMO source package

This archive is the source submission for the Firefox/AMO review of Iconoplasm.

## what this package contains

- the extension runtime source in `iconoplasm-extension/`
- the shared card source in `shared/iconoplasm-card/`
- the build scripts used to generate packaged output
- a minimal `package.json`, lockfile, and pnpm workspace configuration containing only the extension build toolchain

## why source code is attached

AMO requires a matching source package when the shipped extension contains generated output or bundled third-party files.

Iconoplasm does both:

- `scripts/sync-iconoplasm-shared.mjs` copies and bundles shared card assets into the extension
- `roughjs` is copied into `iconoplasm-extension/generated/rough.js`
- the pinned PDF.js 6.2.108 viewer is copied by `scripts/sync-iconoplasm-pdfjs.mjs`
- the two-file PDF.js canvas patch, its pristine inputs, and the resulting runtime are included under `iconoplasm-extension/vendor/` for reviewer inspection

## reviewer build instructions

Expected environment used by the project:

- OS: Windows 11 during authoring, but the build is plain Node and does not depend on a browser
- Node: 22+
- pnpm: the version pinned in `package.json`

AMO's default reviewer environment uses Ubuntu + Node 24, which should also work.

From the repo root of this source package:

1. `corepack enable`
2. `pnpm install --frozen-lockfile`
3. `pnpm run sync:iconoplasm-extension`
4. `pnpm run package:iconoplasm-firefox`

That produces the Firefox review payload at:

- `iconoplasm-extension/dist/firefox-package/`

and the upload zip at:

- `iconoplasm-extension/dist/iconoplasm-firefox-v<version>.zip`

The unsigned Firefox package should match the extension version uploaded to AMO for this release.

Notes about the build:

- `scripts/sync-iconoplasm-shared.mjs --extension-only` regenerates only the shared assets copied into the extension runtime; it does not require or modify site source.
- `pnpm run package:iconoplasm-firefox` stages a Firefox-specific manifest with the Firefox response-filter ownership driver and the same PDF reader used by Chromium.
- The Firefox driver uses `webRequest.filterResponseData` only for top-level HTTP(S) responses whose declared content type is `application/pdf`; attachments and partial responses remain native.
- Turning PDF highlighting off removes interception for future documents. An already-open owned document gives the captured bytes to Firefox's native PDF viewer as a PDF blob; it does not replay the original GET or POST.
- Local `file:` PDF ownership is not claimed by this driver. Store certification must keep that limitation explicit until a browser-supported local-file adapter is implemented.
- The signed XPI is produced by AMO after upload; the local build reproduces the unsigned package submitted for review.

## reviewer notes

- No obfuscation is used.
- Generated files carry comments pointing back to their canonical source files.
- The extension includes a site-only bridge on `iconoplasm.brinedew.bio` and `staging.brinedew.bio` so the homepage can detect whether the extension is installed without injecting the full page-highlighting runtime onto its own site.
- Remote code execution is not used. The extension reads page text locally and requests gene metadata from the Iconoplasm API.
- The PDF.js patch is not obfuscated. `iconoplasm-extension/vendor/pdfjs-patch/README.md` identifies the exact upstream version, changed files, and reproducible patch.
