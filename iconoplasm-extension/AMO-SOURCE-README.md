# Iconoplasm AMO source package

This archive is the source submission for the Firefox/AMO review of Iconoplasm.

## what this package contains

- the extension runtime source in `iconoplasm-extension/`
- the shared card source in `shared/iconoplasm-card/`
- the build scripts used to generate packaged output
- `package.json` and `package-lock.json` so the reviewer can reproduce the build

## why source code is attached

AMO requires a matching source package when the shipped extension contains generated output or bundled third-party files.

Iconoplasm does both:

- `scripts/sync-iconoplasm-shared.mjs` copies and bundles shared card assets into the extension
- `roughjs` is copied into `iconoplasm-extension/generated/rough.js`

## reviewer build instructions

Expected environment used by the project:

- OS: Windows 11 during authoring, but the build is plain Node and does not depend on a browser
- Node: 22+
- npm: 10.9.2+

AMO's default reviewer environment uses Ubuntu + Node 24, which should also work.

From the repo root of this source package:

1. `npm ci`
2. `npm run sync:iconoplasm-shared`
3. `npm run package:iconoplasm-firefox`

That produces the Firefox review payload at:

- `iconoplasm-extension/dist/firefox-package/`

and the upload zip at:

- `iconoplasm-extension/dist/iconoplasm-firefox-v<version>.zip`

The unsigned Firefox package should match the extension version uploaded to AMO for this release.

Notes about the build:

- `scripts/sync-iconoplasm-shared.mjs` regenerates the shared assets copied into the extension runtime.
- `npm run package:iconoplasm-firefox` stages a Firefox-specific manifest and strips files that are not part of the AMO upload bundle.
- The signed XPI is produced by AMO after upload; the local build reproduces the unsigned package submitted for review.

## reviewer notes

- No obfuscation is used.
- Generated files carry comments pointing back to their canonical source files.
- The extension includes a site-only bridge on `iconoplasm.brinedew.bio` and `staging.brinedew.bio` so the homepage can detect whether the extension is installed without injecting the full page-highlighting runtime onto its own site.
- Remote code execution is not used. The extension reads page text locally and requests gene metadata from the Iconoplasm API.
