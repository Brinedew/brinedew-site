# Iconoplasm PDF.js renderer adapter

Iconoplasm patches the PDF.js display layer because the public text layer and
operation APIs do not retain the glyph-paint identity required for exact
foreground substitution. The shipped runtime is based on the immutable
upstream tag and commit below:

- PDF.js tag: `v6.2.108`
- upstream commit: `0365cbde028bd92e58f2dab1bb70cd30ac7acfd7`
- upstream repository: `https://github.com/mozilla/pdf.js.git`

`pdfjs-v6.2.108-iconoplasm.patch` is the complete maintained delta. It adds one
optional `textRenderAdapter` render parameter and keeps the normal PDF.js paint
path unchanged when the adapter is absent. The adapter has two fail-closed
modes:

- `survey` records authoritative glyph paint transforms without rasterizing
  supported glyphs into the survey canvas.
- `paint` applies an immutable, ordinal-keyed foreground/background plan while
  calling PDF.js's original `fillText` paint path for every accepted glyph.

To reproduce `vendor/pdfjs-runtime`:

1. Check out the exact upstream commit above into `vendor/pdfjs-src`. Do not
   use a one-commit shallow checkout: PDF.js derives its patch version from the
   number of commits after the `pdfjs.config` base commit. Before building,
   `git rev-list --count eddd70a2ca1054ad2e0792972c3f2774b89f0cd2..HEAD`
   must print `108`.
2. Apply `vendor/pdfjs-patch/pdfjs-v6.2.108-iconoplasm.patch` with
   `git apply`.
3. Install the PDF.js build dependencies with pnpm.
4. Run `pnpm run build:iconoplasm-pdfjs` from the Website repository root.

The build captures `pdf.mjs` and `pdf.worker.mjs`; the extension sync then
combines those files with the matching `pdfjs-dist@6.2.108` viewer assets and
license. Unsupported glyph branches are never approximated: they remain
byte-for-byte on the canonical PDF.js render.
