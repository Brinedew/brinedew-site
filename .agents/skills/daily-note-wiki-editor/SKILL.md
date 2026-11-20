---
name: daily-note-wiki-editor
description: >-
  Distill, triage, and integrate Obsidian daily notes (content/YYYY-MM-DD.md)
  into the Brinedew wiki (content/wiki/). Use when asked to process daily notes,
  enrich the wiki from recent notes, triage daily research dumps, or act as the
  Obsidian wiki editor.
---

# Daily Note -> Wiki Editorial Workflow

Daily notes live at the vault root (`D:\Coding\Website\content\YYYY-MM-DD.md`) and often contain raw Q&A dumps, sanity checks, literature syntheses, tables, and inline SVG diagrams.

**Never store editorial logs, intake queues, or processing state inside `content/` or `content/wiki/`.** Everything in `content/` (even `draft: true`) is compiled by Quartz and exposed on `brinedew.bio` behind a soft CSS curtain and under the `#draft` tag. Operational state belongs strictly in `.agents/skills/daily-note-wiki-editor/state/intake_ledger.json`.

---

## Step 1: Deterministic Intake & Triage

Run the intake scanner from `D:\Coding\Website`:

```powershell
python .agents/skills/daily-note-wiki-editor/scripts/triage_daily_notes.py scan
```

To inspect a specific daily note's sections, detected tables/SVGs, and candidate `content/wiki/` matches:

```powershell
python .agents/skills/daily-note-wiki-editor/scripts/triage_daily_notes.py inspect --date YYYY-MM-DD
```

For each substantive block in an unprocessed (or newly appended) daily note, classify its destination into one of four buckets:

1. **Enrich existing wiki page(s):** A claim, mechanism, experiment, table, or critique belongs inside an existing article's canonical slice.
2. **Spawn a new wiki page:** The block covers a distinct mechanism, model, experiment, or taxonomy with no existing canonical home in `content/wiki/` and enough substance to clear at least `Start` or `C` class (`>= 150` words of domain content, clear scope).
3. **Glossary / Index / Cross-link only:** Defines a term or alias belonging in `content/wiki/Glossary.md` without warranting a standalone page.
4. **Skip (ephemeral scratch):** Purely conversational filler or superseded first drafts within the same note (e.g., when a later section in the same daily note corrects an earlier sleight-of-hand, only integrate the corrected formulation).

---

## Step 2: Primary-Source Verification Gate (Zero LLM-to-Wiki Laundering)

**Daily notes are leads and hypotheses, never primary sources.** Most daily notes contain raw LLM outputs that frequently mischaracterize what a paper argues (for example, claiming López-Otín et al. treat the Hallmarks of Aging as flat co-equal boxes when the 2013 paper explicitly sorts them into Primary, Antagonistic, and Integrative tiers) or cite papers with guessed titles, years, or effect sizes.

Before ANY claim, number, or citation from a daily note enters `content/wiki/`:

1. **Use `occurock` for primary-source verification AND reader-facing cropped screenshots:**
   - Run `occurock find <query> --json` or `occurock search <query> --json` to locate papers in the local Zotero/PDF library (if a PDF isn't parsed yet, run `occurock parse <source> --json`; check backend status with `occurock health --json`).
   - Read the actual passage with `occurock read doc:<citekey>/page:<number> --json`.
   - For pivotal claims, definitions, or experimental numbers, generate a cropped PNG screenshot directly into `content/Attachments/` with:
     ```powershell
     occurock evidence <citekey> "<passage>" --output-dir content/Attachments --json
     ```
     Then embed it in a clean reader-facing `> [!info]-` callout (`![[<image.png>|caption]]` + verbatim quote + page/section/DOI, zero pipeline/tool text) **at the end of the article (under `## References`)** so readers can inspect the original paper without breaking reading flow. **Failure mode to avoid: mid-page OCR screenshot inserts**—never drop `> [!info]-` OCR screenshot callouts in the middle of body prose or right under a lead/section heading.
2. **Never fabricate or infer missing bibliographic metadata:** If a daily note mentions `"Koch & Ideker (Nat Aging 2025)"` or `"Milsom et al. (2026 preprint)"` without a verified DOI/PMID and full text, do **not** invent a paper title or add it as a footnote. Either verify the exact paper first, or omit the unverified claim and log it as a deferred lead in `intake_ledger.json`.
3. **Check for contradictions with the target article:** Read the entire target wiki article before editing so you never introduce a claim that contradicts an earlier section of the same page.

## Step 3: Graph Factoring & Voice Translation

Raw daily notes often carry chat residue (`"You are completely right"`, `"The short answer:"`, `"In your framing..."`), unverified secondary citations, or hardcoded-hex inline SVGs. Before touching any wiki file, translate the material to match `content/wiki/Wiki Assessment.md` and `CLAUDE.md`:

- **Single canonical home (`WP:SUMMARY`):** Place detailed mechanisms, equations, or comparison tables on **one** canonical page. Cross-link or transclude (`![[Page#Heading]]`) from neighbor pages; add `*Main article: [[target]]*` or `*Further information: [[target]]*` hatnotes only when the target page actually holds a deeper treatment.
- **Strip chat residue & meta-scaffolding:** Remove all second-person Q&A framing, `"The short answer:"` headers, and bolted-on `"Wiki adjudication:"` / `"Editorial synthesis"` banners. State the biological or mathematical tension and its resolution directly inside the narrative.
- **Dual-audience sequential prose:**
  - _For field biologists:_ Motivate equations and formal vectors brick-by-brick from why simpler descriptions fail.
  - _For quantitative non-biologists (LessWrong/programmer generalists):_ Unpack molecular cascades and wet-lab assays step-by-step so acronyms close a conceptual gap already built. Avoid 60-word semicolon-chained cover-your-ass sentences.
- **Footnotes hold bibliographic clutter:** Move `Author (Year)` lists, journal titles, and DOIs out of body sentences into `[^key]` footnotes unless the researcher's name carries conceptual priority in the sentence.
- **Level-indexed terminology:** Follow `content/wiki/Non-technical language in longevity.md` and `content/wiki/Glossary.md`. Never use bare `"aging"` or `"damage"` where the mechanism means `mortality creep`, `somatic point-mutation burden`, `bulky DNA lesions`, `cell-autonomous Darwinian fitness`, or `replicative arrest`.
- **Primary-source verification:** Verify citations against primary papers (using `occurock` PDF OCR or publisher full-text HTML with `> [!info]-` cropped passage callouts when targeting `B` or above). Never promote unverified LLM-recalled numbers or abstract-only claims as audited primary evidence.
- **Visuals, SVGs & Vega-Lite charts:**
  - Do not dump raw ` ```svg ` blocks with hardcoded light-mode hex fills (`#fafbfc`, `#0f172a`) directly into wiki markdown—they clash with dark mode and Quartz styling. Convert quantitative data into theme-aware ` ```vega-lite ` blocks (using mark styles `observed`, `model`, `alt`, `guide`, `label` and CSVs in `content/Attachments/`) or save properly styled SVG/Excalidraw figures in `content/Attachments/`.

---

## Step 3: Draft & Integrate in `content/wiki/`

1. **For new articles:**
   - Create `content/wiki/<Title or slug>.md` following `content/Templates/Wiki Template QuickAdd.md` frontmatter (`title`, `tags: [content/wiki]`, `date`, `draft: true`, `vital_level`, `class`, `aliases`).
   - Write a 1–3 paragraph `MOS:LEAD` (bolded title in first sentence, definition, significance, adjacent `[[wikilinks]]`).
2. **For existing articles:**
   - Weave the new evidence, table, or subsection into the article's logical hierarchy—never append a dated `"Update from daily note"` section at the bottom.
   - Check and update the article's `class` in frontmatter if the new additions push it across a criteria-gated threshold (`Stub -> Start -> C -> B` per `content/wiki/Wiki Assessment.md`).
3. **Graph wiring:**
   - Add new articles and core terms to `content/wiki/index.md` and `content/wiki/Glossary.md`.
   - Ensure reciprocal `[[wikilinks]]` from neighbor articles so no page is an orphan.

---

## Step 4: Verification, Quality Gate & Ledger Update

1. **Promotion above `B` (`GA`, `A`, `FA`):**
   - Checklists stop at `B`. If an enriched article is ready for `GA`, `A`, or `FA`, invoke the `wiki-court` skill (`D:\Coding\Website\.agents\skills\wiki-court\SKILL.md`).
2. **Formatting & build check:**
   - Run `pnpm run check:format:changed` (note: `content/wiki/` is ignored by Prettier to preserve Obsidian wikilinks, but any scripts or config files touched must pass Prettier).
3. **Record in the intake ledger:**
   - Mark the daily note as processed so future sessions don't re-triage unchanged text:
   ```powershell
   python .agents/skills/daily-note-wiki-editor/scripts/triage_daily_notes.py mark --date YYYY-MM-DD --targets "wiki/Page1.md,wiki/Page2.md" --notes "Brief summary of what was integrated or skipped"
   ```
   - If the owner later appends new sections to that same daily note, `scan` will detect the hash change and flag only the new/modified sections.
