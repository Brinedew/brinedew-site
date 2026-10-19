# Iconoplasm glossary: pictures and cards

One word, one thing. When code, a doc, an issue or the UI uses one of these
words for something else, it is a bug: rename it. When you need a new word,
add it here first. The owner set the first two (2026-10-19): "a portrait plus
text overlay equals blot".

## The two pictures

**Portrait.** A generated character image of a gene, with no text on it. It is
identified by its `asset_sha256` and stored as three renditions
(`portraits/v1/<sha2>/<sha>/{thumb,medium,full}.webp`). Everything a person
generates, edits, copies, votes on, rejects or publishes is a portrait.

- A gene's **candidate portraits** are every portrait in its pool: the
  pictures readers vote on, shown in the candidate strip.
- A gene's **current portrait** is the one candidate its stable gene object
  names as the winner (`genes/v3/<SYMBOL>.json`, field `portrait`). Votes, a
  caretaker's supervote or an administrator's pin change it. Older code and
  docs call it the "canonical portrait", "published portrait" or "winner";
  all three mean the current portrait.

**Blot.** A portrait with the gene's full name and symbol painted into the
same image file. The text is in the pixels, not laid over them by HTML. A
gene's **blot** is its current portrait's blot: one 768x1024 WebP at
`blots/v2/<initial>/<SYMBOL>-<fingerprint>.webp`, served at
`/blot/<SYMBOL>.webp` and in the public API as `images.gene_blot`. It is the
picture other sites, chatbots, share previews and search engines use.

- Its address follows from the stable gene object alone:
  `workers/lib/iconoplasm-blot.js`.
- `scripts/draw-iconoplasm-blots.mjs` is the only drawer. It runs in GitHub
  Actions after every catalogue publication and paints whatever is missing.
  Bunny storage is the record of which blots exist (B-1131).
- A blot changes when the current portrait, the full name or the symbol
  changes. Votes that don't change the winner leave it alone.

A portrait never has text on it. A blot always does. Nothing else is a blot.

## Things made from them

**Print copy.** A gene's blot painted in the reader's browser at the
portrait's full resolution, as a PNG, when they press the print button. No
server makes or stores it.

**Blot painter.** `shared/iconoplasm-card/blot-painter.js`, the one piece of
code that paints a blot: the drawing script uses it at 768x1024 and the print
button at full resolution.

**Card.** A gene's accession sheet: its current portrait combined with the
specimen label ("ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03"). The
label carries the family and family trait, the category and alignment options
circled with rough.js loops, handwritten notes (age, mass, sex, alignment), the
style row and the footer "seal after review / do not expose to open air". It
is live HTML drawn by `shared/iconoplasm-card/lit-archival-card.js` and
`shared-card-runtime.js` (code: the `lit-archival` variant, old name
`lab-label`; `neo-drab` is a darker skin of the same sheet). The gene page,
the gallery on phones and the extension's "Vintage lab label" hover show it.
A card is neither a portrait nor a blot, and no image file of a card exists.

These look like a gene but are not cards:

- An **image tile** (code: the `image-only` variant; the desktop gallery's
  default, and the extension's "Blot only" hover) is the portrait with the
  name and symbol laid over it in HTML. It looks like the gene's blot because
  the blot painter copies its layout.
- The **simple tooltip** (code: `simple`, old name `classic`; the extension's
  "Simple" hover) is a compact inline tooltip.

Older code says "card" for two other things. The CSS class `icono-card` sits on
every gallery tile, image tiles included, and many runtime names
(`buildGeneCard`, "published card payload", a variable called `card`) hold
the stable gene object. In prose, issues and new code, "card" means only the
accession sheet.

A style's **blot count** in the style picker is the number of genes whose
current portrait was made in that style, which is the number of their blots.

**Caretaker film.** The caretaker sidebar's imitation Western-blot
autoradiograph (B-996): a protein ladder, one band at the gene's molecular
weight, the current portrait printed into the film and the symbol in wax
marker (`quartz/static/iconoplasm/caretaker-film.js`). It is drawn live in
the page from data the page already holds. It is not a blot in the sense
above, which is why it has its own name.

## Records

**Stable gene object.** `genes/v3/<SYMBOL>.json` in Bunny storage: the one
published record of a gene (its text, its candidate portraits with their
vote totals, its current portrait). Every public surface reads it.

**Catalogue object.** `catalog/v3/index.json`: the one published list of
genes, each with its symbol, full name and current portrait.

## Words to avoid

| Don't write                                           | Write                                        |
| ----------------------------------------------------- | -------------------------------------------- |
| "candidate blot", "blot" for any picture without text | candidate portrait, portrait                 |
| "canonical blot"                                      | the gene's blot                              |
| "blot print" (B-996)                                  | caretaker film                               |
| "AI blots"                                            | AI portraits                                 |
| "materialized blot", "blot backlog"                   | (gone: the drawer paints what storage lacks) |
| "card" or "card image" for the blot or any image file | blot, portrait                               |
| "card" for an image tile or the simple tooltip        | image tile, simple tooltip                   |
| "card" for `genes/v3/<SYMBOL>.json`                   | stable gene object                           |
| "blot-only card"                                      | image tile                                   |
