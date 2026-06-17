# Iconoplasm — Design System

> *"19,000+ gene portraits. Every human gene gets a unique color and portrait. Hover any symbol on any page for instant context."*

Iconoplasm is a **wet-lab gene blot archive where each human protein-coding gene is a character.** It gives every gene a stable unique color, an illustrated portrait, and a mnemonic backstory — then surfaces that identity wherever you read about biology on the web.

The whole visual world imitates **real printed laboratory materials**: cream specimen paper, typewritten data fields, teal fountain-pen annotations, and rust-ink stamps. Cards behave like physical printed sheets — **fixed geometry that the content is poured into**, never a fluid web box that grows with its text.

---

## Products / surfaces

There are two surfaces, both built from one shared card system:

1. **The browser extension** (`iconoplasm-extension/`) — a Chrome/Firefox/Edge/Safari WebExtension. It scans any page for gene symbols (`TP53`, `BRCA1`, `PTEN`…), highlights them in their assigned gene color, and shows a rich **hover card** on hover. A toolbar **popup** controls highlight style, hover-card style, a disambiguation blocklist, and optional Discord account sync.
2. **The archive website** — `iconoplasm.brinedew.bio` — the canonical catalog of all ~19,023 gene "specimens" as full **vintage lab-label cards** (portrait + typewritten molecular fields + handwritten trait annotations + MISFIT↔FIT voting).

The extension's hover card has three styles that mirror the site: **Simple** (compact inline tooltip), **Vintage lab label** (the full printed specimen sheet), and **Blot only** (portrait + symbol overlay).

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

**Type.** Four voices, strict jobs (see colors_and_type.css): League Spartan 800 = gene symbol; IBM Plex Mono = pre-printed labels; Special Elite = typewritten values; Caveat = handwritten teal notes. Never mix their roles.

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

- **No icon font, no icon set (Lucide/Heroicons/etc.), no SVG icon sprite.** The codebase ships none, and none should be added.
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
