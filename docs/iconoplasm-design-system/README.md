# Iconoplasm — Design System

## Before designing

On 2026-10-04 (B-996, the caretaker sidebar) an agent made two mockups the owner rejected. The first was a timid reskin inside this document's rules. The second pasted the owner's reference posters on literally and decorated them with hand-drawn SVG stars. Neither changed the UX. Earlier strikes of the same kind came on 2026-09-25 and 2026-09-26. Work in this order:

1. Read this document, the [Caretakers Handbook](../../content/wiki/Iconoplasm%20-%20Caretakers%20Handbook.md) and the live page: fonts, motifs, and the words already on screen.
2. Measure real usage on the nightly D1 copy (`node scripts/d1-local.mjs <db> "<sql>"`): who uses the feature, the volumes and extremes, the churn, and which other channel (Discord, for example) already delivers the same thing. Write down the user's actual job and at least ten edge cases taken from those extremes, agree the need and don't-need lists with the owner, and record them on the issue as acceptance cases that every mockup must show. On B-996 the inbox was designed for "1 unread" from one screenshot; the data said 36 unread across 6 genes, 18-image batches, 162 requests in a day, and a caretaker switching genes four times in one night.
3. List about ten mistakes in the current foundation, including the rules below, and decide which to break. The rules below were written by earlier agents. They are evidence, not law, and following them to the letter produces a reskin.
4. Copy the interaction from one comparable product (a collection game for a collection game). Change the interaction, not just the paint.
5. Translate the owner's references into Iconoplasm's own metaphor; never paste them on. The card already speaks of emulsion numbers, glass plates and print copies, so generating an image is developing a plate.
6. Make textures and ornaments at print fidelity, never crude flat shapes such as SVG stars or checker rectangles. In 2026 professional packs are mostly free, so check the licence, not the price. Opus 5.5 practitioners also generate the material in code: grain, off-registration, halftone, shader paper.
7. Write a brief, not a wish: a mood with exclusions, named type families, one memorable thing, explicit bans and named libraries. Then make several variants and choose between them; never show a single attempt.
8. Mock it up in Paper. Before showing it, answer three questions: Did the UX change? Does it fit the theme? Does it look like a professional asset pack, or homemade from basic vector shapes?
9. Never conclude the current design is "roughly right". The owner opened the issue because it isn't; find what's wrong, functionally and emotionally, before drawing.
10. Compare every mockup with the live version and every variant already rejected. A restyled copy of the same layout isn't a new design.
11. Paper's free plan allows 100 MCP calls a week. Don't spend them on capability tests or throwaway variants, and test any assumption about a tool before announcing a switch away from it.


### Judge the type in every screenshot

On 2026-10-05 (B-1022) an agent sent the owner before-and-after pictures of the homepage install panel after a CSS refactor and checked only that "after" matched what the app's CSS asked for. Both pictures showed five instructions set centred, in Special Elite at 19 px, about 25 characters to a line, with the step numbers floating far from their text. The owner: "atrocious … my eyes are popping out." Every screenshot you show is a design claim, even when the change wasn't meant to be visual. Before sending one, check:

1. **Voice.** Is each text in the voice its job calls for (see Type below)? Running text is never Special Elite.
2. **Alignment.** Text that wraps is left-aligned. Centre a single short line (a title, a tagline, a button label) at most.
3. **Line length.** Reading text runs 45–90 characters a line ([Butterick](https://practicaltypography.com/line-length.html)). If a card is too narrow for that, say so instead of shrinking the type.
4. **One reading size.** Code chips sit at about 0.9–0.95× the words around them, as [Chrome's](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) and [GitHub's](https://docs.github.com/en/get-started/start-your-journey/hello-world) docs set them, never a different scale.
5. **Numbers.** List markers hang and align with the text they number.
6. **Where a rule comes from.** If something looks wrong, find the rule that produced it before fixing it: the install panel was centred by a blog rule in `quartz/static/custom.css` written for a different card.

### The design landscape moves faster than agent training

An agent's training data ends months before the work happens. On 2026-10-04 an agent assumed pro asset packs were paid and that buying one was the owner's call; both assumptions were stale. Before designing, run a dated search on the current practice and asset market, and trust only sources you opened. Checked 2026-10-04:

- [Muzli, 2026-09-28](https://muz.li/blog/claude-opus-5-5-for-designers/): Opus 5.5 draws assets in code at print fidelity ("two-colour risograph prints … down to the slightly-off registration and paper grain"), with WebGL shaders, GSAP and Lenis, and screenshots its own work to critique it. Its brief pattern bans a cream background as a default look.
- [Thomas Wiegold, 2026-08-21](https://thomas-wiegold.com/blog/best-llm-frontend-design/): generate variants and pick on taste; the judgment moved from drawing to choosing.
- [Speckyboy, 2026](https://speckyboy.com/free-high-resolution-texture-packs/) and [Creative Market free goods](https://creativemarket.com/free-goods): professional texture packs are widely free.

---


> *"19,000+ gene portraits. Every human gene gets a unique color and portrait. Hover any symbol on any page for instant context."*

Iconoplasm is a **wet-lab gene blot archive where each human protein-coding gene is a character.** It gives every gene a stable unique color, an illustrated portrait, and a mnemonic backstory — then surfaces that identity wherever you read about biology on the web.

The whole visual world imitates **real printed laboratory materials**: cream specimen paper, typewritten data fields, teal fountain-pen annotations, and rust-ink stamps. Cards behave like physical printed sheets — **fixed geometry that the content is poured into**, never a fluid web box that grows with its text.

---

## Products / surfaces

There are two surfaces, both built from one shared card system:

1. **The browser extension** (`iconoplasm-extension/`) — a Chrome/Firefox/Edge/Safari WebExtension. It scans any page for gene symbols (`TP53`, `BRCA1`, `PTEN`…), highlights them in their assigned gene color, and shows a rich **hover card** on hover. A toolbar **popup** controls highlight style, hover-card style, a disambiguation blocklist, and optional Discord account sync.
2. **The archive website** — `iconoplasm.brinedew.bio` — the canonical catalog of all ~19,023 gene "specimens" as full **vintage lab-label cards** (portrait + typewritten molecular fields + handwritten trait annotations + MISFIT↔FIT voting).

The extension's hover card has three styles that mirror the site: **Simple** (compact inline tooltip), **Vintage lab label** (the full printed specimen sheet), and **Blot only** (portrait + symbol overlay).

### The Diagram Studio is a tool, with tool chrome

`/studio` is a pathway diagram editor in the anatomy of draw.io and BioRender: a title row, menus, a toolbar, a shape library, a Format panel, page tabs and a status bar (B-1045). The owner rejected the first studio redesigns as "advertisement posters" and approved the editor mockup "recolored and retextured for our aesthetic" (2026-10-07). An editor has dozens of controls on screen at once, so its chrome follows two rules of its own:

- **Type:** IBM Plex Sans for every label, menu, button and value, at 12 px with sentence-case labels and tabular numerals. IBM Plex Mono only for codes (a hex colour, a PMID). League Spartan 800 only for gene symbols. No Special Elite or Caveat anywhere in the editor: the owner called the typewriter-and-mono version "atrocious font choices" that "make my eyes bleed" (2026-10-07).
- **Icons:** Lucide line icons (ISC licence, inlined in `diagram-studio-icons.js`) for toolbar and menu commands, because a toolbar of 40 commands can't be told apart by Unicode glyphs. The rest of Iconoplasm stays icon-light (see Iconography).
- **First-run tour:** driver.js (MIT licence, bundled in `generated/tour-runtime.js` and loaded only when a tour starts) dims the page and lights one control at a time. Its popover wears the same chrome: Plex Sans, cream panel, teal for the forward button (B-1050).

Colour and material stay Iconoplasm's: cream paper chrome with the ambientCG grain, a greyboard desk, the teal pen as the only accent, the rust stamp for inhibition, and a dark-roast twin in dark mode. The exported figure is always the cream (or white) sheet. Relationship glyphs and names are KEGG's pathway notation.

---

## Sources used to build this system

All read-only, provided via the mounted codebase. Not assumed accessible to the reader — recorded for provenance:

- **Codebase:** `iconoplasm-extension/` — the canonical unpacked WebExtension root.
  - `popup.html` / `popup.css` — toolbar popup UI (warm paper system).
  - `content.css` — in-page gene highlighting + the "Simple" horizontal tooltip.
  - `generated/shared-card-label.css` (3332 lines) — the shared **vintage lab label** card. Its own source of truth is a Figma/Paper artboard *"Vintage Lab Label Study / Type vs Pen."*
  - `manifest.json` — fonts, web-accessible resources, gene-color content vars.
  - `highlight-runtime.js` — highlight render modes + `--iconoplasm-gene-color` plumbing; placeholder color `#6B6B78`.
  - `blocklist-defaults.js` — 74 default-blocked ambiguous symbols (e.g. `SET`, `REST`, `CAT`).
  - `store-assets/STORE-LISTING-COPY.md`, `AMO-LISTING-COPY.md` — marketing copy & tone.
  - `store-assets/*.png` — reference screenshots (copied to `_ref/`).
- **Live site referenced in code:** `https://iconoplasm.brinedew.bio/`
- **Brand domain:** `brinedew.bio` (parent studio). Firefox add-on ID `iconoplasm@brinedew.bio`.

Fonts shipped with the extension and copied into `fonts/`: **IBM Plex Mono** (Regular/Medium), **League Spartan** (800), **Special Elite** (Regular), **Caveat** (400). All real, no substitutions needed.

---

## CONTENT FUNDAMENTALS

**Voice.** Plain, confident, faintly archival/clinical — like a museum specimen label written by a meticulous lab tech with a dry sense of humor. The gene is treated as a *catalogued character*: it has a portrait, a "first noted" year, a personality, a family. Never markety, never hype-y.

**Person.** Second person for instructions ("Hover any symbol", "Track your discoveries as you browse"). Third person, factual, for the gene itself ("Gives repeated genes a visual identity").

**Casing.**
- The product name is set **ICONOPLASM** in all-caps League Spartan in chrome; **Iconoplasm** title-case in prose.
- Pre-printed field labels are **UPPERCASE, letter-spaced** mono (`FULL NAME`, `FIRST NOTED`, `CATEGORY`, `EMULSION NO.`, `PFAM CLANS`).
- Kickers are short uppercase mono tags ("GENE MNEMONICS", "ARCHIVE", "19,000+ GENE PORTRAITS").
- Typed molecular values are uppercase typewriter (`TRANSMEMBRANE`, `INSULIN`).
- Handwritten notes are natural case, lowercase-leaning (`61 y.o.`, `female`, `12 kg`).
- Handwriting may overflow its field. A note that runs about one line past its slot, or spills across a ruled boundary, is the lab-notebook look working as intended, not a layout bug. Don't shorten a note, shrink its type or clip it to make it fit; only text that runs well past a line or hides another field needs a fix.

**Mechanics.** Tight, scannable. Short feature bullets. Numbers are exact and a little clinical ("recorded out of 19,023", "v0.4.7", "6,706 bp"). Gene symbols always in their literal monospace form.

**Emoji:** none, ever. **Icons:** almost none — the brand uses *type and the printed grid* as its iconography (see ICONOGRAPHY). 

**Tone examples (verbatim from the codebase):**
- "Highlights gene symbols on any page with hover cards, portraits, and gene colors. Track your discoveries as you browse."
- "Iconoplasm gives every human protein-coding gene a unique color identity, then highlights gene symbols automatically as you read the web."
- "Makes dense biology pages easier to scan." / "Gives repeated genes a visual identity you can learn over time." / "Keeps you from bouncing between the page and a dozen lookup tabs."
- Field play (insulin card): `FULL NAME insulin` · `FIRST NOTED 1959` *(61 y.o.)* · `MASS ~~kDa~~ 12 kg` · `CATEGORY TRANSMEMBRANE / SOLUBLE` *(female)* — the humor lives in the **handwritten human-trait annotations layered over clinical molecular fields.**

---

## VISUAL FOUNDATIONS

**The core idea: a printed specimen sheet, not a web card.** Geometry is fixed (the lab card has a locked `1220 × 634` aspect ratio and a hard 5-row grid). Text is sized in `cqw` so it scales *with the sheet*, never reflowing the sheet. Corners on the printed card are **square (radius 0)**. Soft chrome around it (popup, archive shell) is gently rounded (10–14px).

**Color.** A warm, low-chroma **paper-and-ink** palette: cream paper (`#f4ede5`), dark-roast ink (`#20120b`), with exactly **one accent** — a muted **teal "pen"** (`#1b7269`) used for handwritten annotations and primary actions. A **rust-red stamp** (`#a24834`) appears sparingly for stamped/QC marks. Beyond that, the only saturated color on any card is the **per-gene color** (server-assigned, unique per gene) used for highlights and the portrait base tint. Optional dark skins exist: **neo-drab** (olive `#171a14` paper + sodium-yellow `#d7b642`) and a near-black **promo stage** (`#161616`).

**Type.** Four voices, strict jobs (see colors_and_type.css): League Spartan 800 = gene symbol; IBM Plex Mono = pre-printed form text; Special Elite = typewritten values; Caveat = handwritten teal notes. Never mix their roles.

The metaphor decides which voice a text takes. On real lab paperwork, everything printed on the form is in the form's own face, and the typewriter only fills in the blanks (checked 2026-10-05 on the University of Iowa State Hygienic Lab's [Clinical Specimen Test Request Form Instructions](https://shl.uiowa.edu/sites/shl.uiowa.edu/files/2025-04/ClinicalTRFInstructs.pdf): instructions in the printed face, left-aligned, section labels as bold caps, no typewriter text at all). So:

- **IBM Plex Mono** is the pre-printed form: field labels, titles, instructions, notes, empty states, sign-in prompts, buttons and tabs. It's also the app's default (`#iconoplasm-root`), so any text that sets no face of its own is printed text.
- **Special Elite** is what was typed into the form: a gene's full name, family, serial and metric values, clan names, and text a person typed in (a suggestion, the character text). Its designer calls it ["a little bit of inked up grunge"](https://fonts.google.com/specimen/Special+Elite/about): a texture for values, never a face for instructions. The one-line hero tagline is the only exception.

**Backgrounds / texture.** Subtle, never flashy. A faint **fractal-noise SVG grain** overlays the simple-tooltip surface. The lab sheet uses hairline **ruled column lines** and gentle vertical paper gradients. Portraits are full illustrated character art (warm, painterly, varied palettes) sitting in a bordered "specimen viewport." **No gradients-as-decoration, no glossy web affordances.**

**Imagery vibe.** Gene portraits are rich, characterful illustrations — each gene rendered as a *person/creature* (e.g. RHO as an armored knight in a dark hall; insulin as a green frog-witch on a barrel). Painterly, often moody/cinematic, full color. Blot-only cards crop them 384×512 (3:4) and add a bottom protection gradient with the symbol + lowercase name overlaid.

**Animation.** Restrained. The tooltip fades + rises subtly (`opacity` + `translateY(8px)→0` + `scale(.96)→1`, ~260ms, `cubic-bezier(0.16,1,0.3,1)`). The comment in `content.css` is explicit: **"Animation: fade only, no movement"** for highlights. No bounces. Mobile dossier opens with a measured `cubic-bezier(0.22,1,0.36,1)` height transition.

**Hover states.** Gene highlights drop to `opacity: 0.85` on hover. Buttons lighten their fill and warm their border toward the teal accent. Cards do **not** lift on hover (shadow stays put — "grounded like the site cards, not floating like a modal").

**Press / focus.** Focus rings are a 3px teal halo (`color-mix(accent 14–16%, transparent)`). Segmented controls slide an active pill with a soft inset shadow.

**Borders.** Everything structural is a **1px hairline** in warm-ink tints (`--rule` / `--rule-strong`). The lab card is a grid of these hairlines — it reads as ruled paper. Buttons/inputs use `--ui-border`.

**Shadows / elevation.** Soft and low. Cards: `0 10px 24px rgba(53,38,27,0.10)`. The simple tooltip adds a `0 0 0 1px` hairline ring + layered soft shadows so it sits *on* the page rather than floating. No big lift shadows.

**Transparency / blur.** Used sparingly — `color-mix(... transparent)` for hairlines and muted text; no heavy glassmorphism/backdrop-blur.

**Highlight styles (4).** underline (paint-only, never changes inline metrics), filled **color pill**, **pill outline**, and a hand-drawn **rough ellipse** (via rough.js) — the loop scribble that is also the logo motif.

**Layout rules.** Fixed printed geometry for cards. Popup is a fixed `min-width: 368px` column. The site archive is a centered single column of bricks with an "ARCHIVE n / recorded out of 19,023" progress header.

**Corner radii.** Printed card `0`; simple tooltip `4px`; inputs/segments `10px`; popup sections `14px`; pills `~0.18em`/`999px`.

**What a card looks like.** Cream paper, square corners, 1px hairline border, low soft shadow, ruled internal grid, portrait rail on the left, typewritten fields on the right, teal handwriting spilling across field boundaries.

---

## ICONOGRAPHY

Iconoplasm is **deliberately icon-light.** Its iconography *is* the printed lab grid and the typographic system. Specifics:

- **No icon font and no icon sprite on reading surfaces** (cards, archive, extension). The one exception is the Diagram Studio's editor chrome, which uses inlined Lucide icons for its toolbar and menus (see "The Diagram Studio is a tool, with tool chrome").
- **The logo / app icon** (`assets/icon-512.png` and the 16–256 sizes) is the one real mark: a single continuous hand-drawn brown loop on cream forming a winking blot-creature — one round eye (`o`), a dash mouth (`-`), and a little tail. It encodes the whole brand: a **gene as a character**, drawn in the same **rough hand-drawn loop** used by the "rough ellipse" highlight. Use it as the brand mark in chrome.
- **Unicode as UI glyphs:** the few interface affordances use plain characters — `×` for dismiss/sign-out, `‹ ›` for prev/next, `@` and arrows in catalog text. No decorative iconography.
- **rough.js** (`generated/rough.js`) generates hand-drawn ellipse strokes for the "rough ellipse" highlight and the circled annotations on cards (e.g. the hand-drawn loop around `SOLUBLE`). This is the closest thing to a generative "icon" in the system.
- **Emoji:** never used.
- **Portraits, not icons:** where another product would use an icon, Iconoplasm uses the gene's **portrait** — a full character illustration. These are the brand's real "imagery." (Portraits are served per-gene from the site; this kit uses tasteful placeholders where a real portrait would load.)

Assets copied into `assets/`: the full logo icon set (`icon-16/32/48/128/512.png`). Reference screenshots live in `_ref/`.

---

## File index / manifest

Root:
- `README.md` — this file.
- `colors_and_type.css` — fonts, color tokens, type scale, semantic type classes. **Import this first.**
- `SKILL.md` — Agent-Skills-compatible entry point.
- `fonts/` — IBM Plex Mono, League Spartan, Special Elite, Caveat (woff2).
- `assets/` — Iconoplasm logo / app-icon set.
- `_ref/` — reference screenshots from the extension store listing (provenance only).
- `preview/` — Design-System-tab cards (colors, type, components, brand). Each is a small standalone HTML specimen.

UI kits (`ui_kits/`):
- `ui_kits/extension/` — the browser extension: toolbar **popup** + in-page **gene highlighting** + all three **hover-card** styles (Simple / Vintage lab label / Blot only). `index.html` is an interactive demo on a faux article page.
- `ui_kits/archive/` — the **archive website**: the catalog of full lab-label specimen cards with the ARCHIVE progress header and MISFIT↔FIT voting. `index.html` is a browsable feed.

---

## Caveats

- **Per-gene colors & portraits are server-side.** Real cards fetch a unique color + illustrated portrait per gene from `iconoplasm.brinedew.bio`. This kit hard-codes a handful of representative gene colors and uses placeholder portrait art / gradients where real portraits would load.
- The mobile lab-card "dossier drawer" behavior is intricate; this kit recreates the **desktop** printed sheet faithfully and notes the mobile pattern rather than reproducing its full swipe physics.
