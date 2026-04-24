# AMO listing copy

## upload file

Upload this Firefox package on the AMO "Upload Version" screen if the GUI/GitHub publish flow is not being used:

- `D:\Coding\Website\iconoplasm-extension\dist\iconoplasm-firefox-v0.4.1.zip`

If AMO asks for source code, upload this file:

- `D:\Coding\Website\iconoplasm-extension\dist\iconoplasm-firefox-source-v0.4.1.zip`

Store release guard:

- normal Firefox publish starts from `D:\Coding\Iconoplasm` -> Website Ops -> Store publish
- the publish button is labeled `Yes, I'm a human, publish Firefox`
- the workflow requires the phrase `YES, I AM A HUMAN, PUBLISH ICONOPLASM`
- do not let LLMs, scripts, scheduled jobs, or website deploy automation submit store releases

## summary (under 250 chars)

Highlight human gene symbols on any page with color-coded markers, mnemonic portraits, and quick hover cards for biology reading and research.

## description

Iconoplasm makes human gene symbols easier to spot, remember, and revisit while you browse.

### What it does

- Finds gene symbols like `TP53`, `BRCA1`, and `PTEN` on pages you visit.
- Highlights them with a stable gene-specific color.
- Opens a hover card with the gene name, portrait, and mnemonic details.

### Why it helps

- Makes dense biology pages easier to scan.
- Gives repeated genes a visual identity you can learn over time.
- Keeps you from bouncing between the page and a dozen lookup tabs.

### Good fits

- PubMed
- UniProt
- Wikipedia
- Ensembl
- journal articles
- lab notes and internal documentation

### Customization

- highlight style: underline, pill, pill outline, or rough ellipse
- tooltip theme: light or dark
- card style: simple, lab label, or image-only
- local blocklist for ambiguous symbols like `SET`, `REST`, and `CAT`

### Privacy

- Page text is processed locally in the browser.
- Only gene-symbol lookup requests are sent to Iconoplasm services.
- No analytics or ad tracking.
- Privacy policy: https://iconoplasm.brinedew.bio/apps/iconoplasm/privacy

### Optional account sync

Discord sign-in is optional. It syncs discoveries between the extension and the Iconoplasm site.

## suggested tags

- genes
- bioinformatics
- biology
- research
- medicine

## suggested categories

- Search Tools
- Other

## screenshot set

AMO-friendly 1280x800 screenshots can be generated with:

- `node iconoplasm-extension/store-assets/generate-amo-screenshots.mjs`

Generated files:

- `iconoplasm-extension/store-assets/amo/amo-screenshot-1-hovercard.png`
- `iconoplasm-extension/store-assets/amo/amo-screenshot-2-hovercard-alt.png`
- `iconoplasm-extension/store-assets/amo/amo-screenshot-3-popup.png`
- `iconoplasm-extension/store-assets/amo/amo-screenshot-4-blocklist.png`
- `iconoplasm-extension/store-assets/amo/amo-screenshot-5-account.png`

## platform note

Desktop Firefox only for now. Do not mark Android support.

## support

- Support site: https://brinedew.bio/posts/Iconoplasm-FAQ.html
- Privacy policy: https://iconoplasm.brinedew.bio/apps/iconoplasm/privacy
- Homepage: https://iconoplasm.brinedew.bio/

## notes for reviewers

- Generated files are produced by `npm run sync:iconoplasm-shared`.
- A matching source archive is attached for review.
- The extension injects a minimal site bridge only on `iconoplasm.brinedew.bio` and `staging.brinedew.bio`; the main highlighting runtime explicitly excludes those hosts.
