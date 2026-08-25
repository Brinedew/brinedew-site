# Firefox AMO PDF architecture fence

Last verified: 2026-08-25

## Product requirement

Firefox PDF highlighting is part of Iconoplasm. Clearing an AMO review gate by
removing the reader, degrading it to approximate text-layer boxes, uploading a
PDF to a remote service, or silently retaining the native viewer without
Iconoplasm is not an acceptable release outcome.

The shared reader keeps the original PDF glyph paint untouched and places
Iconoplasm-owned underline, outline-pill, or rough-ellipse decorations from the
official PDF.js selectable text layer. A stored filled-pill preference resolves
to outline-pill only inside PDFs; the preference itself and ordinary webpage
rendering do not change. Matching fails closed at PDF.js text-run boundaries.

## What current approved Firefox extensions actually ship

The following AMO versions were public when inspected. Their signed XPI hashes
were verified against the AMO API before extraction.

| Extension                                         | Public version | Shipped architecture                                                                                                                                                                              | Relevant official-byte check                                                                                                                  |
| ------------------------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Highlights: PDF & Web Highlighter + Notes     |        13.0.38 | Routes a PDF URL into an extension-owned `viewer.html`, bundles PDF.js 2.13.216, and adds product UI/export/annotation behavior in viewer-level code.                                             | `pdf/build/pdf.js` is byte-identical to `pdfjs-dist@2.13.216`. Its worker is reformatted and is not a safe checksum precedent for Iconoplasm. |
| Snippet - Web & PDF Highlighter / Kindle Importer |          6.0.5 | On an explicit extension action, replaces the current PDF tab with an extension-owned PDF.js viewer carrying the original URL in `?file=`.                                                        | Both `pdfjs/build/pdf.js` and `pdfjs/build/pdf.worker.js` are byte-identical to `pdfjs-dist@2.4.456`.                                         |
| Glasp Web Highlighter: PDF & Web Highlight        |          2.1.2 | Uses a custom local viewer around PDF.js public APIs. It renders the canonical page canvas, builds the public PDF.js text layer, and paints highlight rectangles in a separate first-party layer. | Its `pdf.worker.min.mjs` is byte-identical to `pdfjs-dist@5.4.296`.                                                                           |
| PDF Highlighter                                   |          1.3.2 | Transfers PDF bytes to `app.pdfhighlighter.io`; the renderer is a remote web application, not the extension package.                                                                              | Rejected for Iconoplasm: it breaks the local-reader/privacy boundary and re-fetches remote documents without origin credentials.              |

Yawas 7.4.7 was also inspected, but its packaged PDF option is commented out
and it contains no PDF viewer. Its AMO wording is not evidence for an active PDF
architecture.

Sources:

- [AMO search for PDF highlighting](https://addons.mozilla.org/en-US/firefox/search/?q=PDF%20highlight)
- [Web Highlights listing](https://addons.mozilla.org/en-US/firefox/addon/web-highlights-pdf-web-highlig/)
- [Snippet listing](https://addons.mozilla.org/en-US/firefox/addon/snippet-for-firefox/)
- [Glasp listing](https://addons.mozilla.org/en-US/firefox/addon/glasp-web-highlighter/)
- [Mozilla third-party library guidance](https://extensionworkshop.com/documentation/publish/third-party-library-usage/)
- [Mozilla add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)

## What this proves for Iconoplasm

AMO permits the architecture Iconoplasm needs at the document level:

1. Own the PDF tab with a local extension viewer.
2. Feed the original document to that viewer.
3. Use an official PDF.js release for parsing and canonical page rendering.
4. Keep product behavior in reviewable first-party viewer/annotation code.

Iconoplasm already has the harder Firefox ownership and captured-byte handoff
working. Do not replace it with URL replay, a proxy, a remote viewer, or native
viewer injection.

The approved examples establish the store-safe boundary used here: official
PDF.js owns parsing, canvas rendering, and its selectable text layer; extension
code owns product decorations. Iconoplasm does not create a second visible text
run and does not use guessed canvas offsets. Browser `Range` rectangles from the
official selectable text layer are the decoration and hover geometry.

## Rejected upstream option

An upstream PDF.js paint hook is not part of the release plan. No issue, pull
request, reviewer conversation, fork maintenance, or external coordination is
required. The PDF-only filled-pill fallback removes the only treatment that
required recoloring PDF glyph foregrounds.

If a future product requirement restores filled PDF pills, the fence is:

- The extension package consumes an untouched official PDF.js release.
- PDF.js exposes a product-neutral, optional text-paint adapter at the existing
  `PDFPageProxy.render` / `CanvasGraphics.showText` boundary.
- With no adapter, an empty plan, or an identity plan, output remains pixel
  identical to stock PDF.js.
- The adapter observes stable paint-order glyph records and may supply a bounded
  paint plan; it contains no gene, Iconoplasm, card, or extension logic.
- Iconoplasm's matcher, color policy, hover geometry, and fail-closed support
  envelope remain first-party viewer code.
- Firefox store packaging switches only after that seam exists in an official
  PDF.js release and the bundled release files match the official distribution.

Current PDF.js 6.2.108 exposes `recordOperations` and `operationsFilter`, but
those APIs operate at PDF-operation granularity. They do not expose the
per-glyph semantic-to-paint identity required by Iconoplasm. Replaying a whole
`showText` operation for a substring already produced the rejected whole-line
and wrong-run failures. Do not revive it.

## Release rule

All browser packages must use the same PDF presentation rule and must copy the
official pinned PDF.js files byte-for-byte. Do not add a Firefox-only renderer,
reintroduce foreground recoloring, or mutate the stored user preference. The
remaining Firefox publication step is the ordinary signed-AMO submission after
the shared package, source archive, checksum, and ownership matrix pass.
