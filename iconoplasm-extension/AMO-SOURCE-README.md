# Iconoplasm AMO source package

This archive is the source submission for the Firefox/AMO review of Iconoplasm.

> **PDF.js integrity:** the package copies the pinned, unmodified `pdfjs-dist`
> API, worker, viewer, and assets. Iconoplasm highlights live in a separate
> first-party decoration layer. The decision and approved-extension evidence are
> recorded in `FIREFOX-AMO-PDF-ARCHITECTURE.md`.

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
- the pinned, unmodified PDF.js 6.2.108 API, worker, viewer, and assets are copied from `pdfjs-dist` by `scripts/sync-iconoplasm-pdfjs.mjs`
- Iconoplasm-owned PDF decorations are implemented in `pdf-reader.mjs`, `pdf-reader-core.js`, and `pdf-reader.css`; they do not replace or recolor PDF glyphs

## reviewer build instructions

Expected environment used by the project:

- OS: Windows 11 during authoring, but the build is plain Node and does not depend on a browser
- Node: 22+
- pnpm: the version pinned in `package.json`

AMO's default reviewer environment, checked on 2026-08-25, is Ubuntu 24.04.4 LTS
on ARM64 with Node 24.14.0. The build uses the repository-pinned pnpm version
through Corepack and includes the frozen lockfile. Its platform-specific build
dependencies publish ARM64 packages; no Windows-only build step is used.

From the repo root of this source package:

1. `corepack enable`
2. `pnpm install --frozen-lockfile`
3. `pnpm run sync:iconoplasm-extension`
4. `pnpm run package:iconoplasm-firefox`

That reproduces the Firefox review payload at:

- `iconoplasm-extension/dist/validation/firefox/package/`

and a deterministic validation zip at:

- `iconoplasm-extension/dist/validation/firefox/iconoplasm-firefox-validation.zip`

The files in this unsigned validation package should match the payload uploaded
to AMO for this release. Its unversioned filename is intentional: only the
human-authorized publisher workflow creates a versioned store-upload ZIP.

Notes about the build:

- `scripts/sync-iconoplasm-shared.mjs --extension-only` regenerates only the shared assets copied into the extension runtime; it does not require or modify site source.
- `pnpm run package:iconoplasm-firefox` stages a Firefox-specific manifest with the Firefox response-filter ownership driver and the same PDF reader used by Chromium.
- The Firefox driver uses `webRequest.filterResponseData` only for top-level HTTP(S) responses whose declared content type is `application/pdf`; attachments and partial responses remain native.
- Turning PDF highlighting off removes interception for future documents. An already-open owned document gives the captured bytes to Firefox's native PDF viewer as a PDF blob; it does not replay the original GET or POST.
- Local `file:` PDF navigation uses `webNavigation` to open the same packaged reader. Firefox does not expose arbitrary local-path reads to extensions, so the reader asks the user to choose or drop that file once through the browser's File API. Bytes remain local, and turning PDF highlighting off returns to the original Firefox file URL.
- The signed XPI is produced by AMO after upload; the local build reproduces the unsigned package submitted for review.

## reviewer notes

- No obfuscation is used.
- Generated files carry comments pointing back to their canonical source files.
- The extension includes a site-only bridge on `iconoplasm.brinedew.bio` and `staging.brinedew.bio` so the homepage can detect whether the extension is installed without injecting the full page-highlighting runtime onto its own site.
- Remote code execution is not used. The extension reads page text locally and requests gene metadata from the Iconoplasm API.
- A filled-pill preference is resolved to the empty-pill outline only while a PDF is displayed. The stored preference is not changed, so ordinary webpages continue to use the filled pill.
