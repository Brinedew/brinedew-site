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
4. **Defer:** A block that cannot be verified or placed yet. Leave it unprocessed by marking only the sections you did integrate with `--sections`. No block is ephemeral: do not call any block scratch or close it as skipped. If a block was closed by mistake, reopen it with `unmark`.

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
     Then nest the `> [!info]-` cropped screenshot callout (bare `![[<image.png>]]` with **no `|description` alias** + verbatim OCR text, zero pipeline/tool text) **directly inside its `[^key]:` footnote definition** (indented 4 spaces under the citation in `## References`). **Multiple passage-specific excerpts from the same paper are encouraged:** do not pigeonhole one paper into a single footnote or a single OCR crop when distinct sentences draw on different passages, tables, or figures—create passage-specific footnote keys (such as `[^harrison1987-record]` and `[^harrison1987-b6]`, repeating the citation/DOI and page/section locator) so clicking each superscript jumps directly to the screenshot relevant to that sentence (`lint-wiki.mjs` deduplicates by DOI/PMID/base key when checking distinct-source floors). **Three failure modes to avoid:** (1) **mid-page OCR screenshot inserts** in the middle of body prose, (2) **separating OCR screenshots from their footnote references** as floating callouts above or beside `## References`, and (3) **adding a `|description` caption alias under the screenshot**—use a bare `![[filename.png]]` followed only by the verbatim OCR text.
2. **Never fabricate or infer missing bibliographic metadata:** If a daily note mentions `"Koch & Ideker (Nat Aging 2025)"` or `"Milsom et al. (2026 preprint)"` without a verified DOI/PMID and full text, do **not** invent a paper title or add it as a footnote. Either verify the exact paper first, or omit the unverified claim and log it as a deferred lead in `intake_ledger.json`.
3. **Check for contradictions with the target article:** Read the entire target wiki article before editing so you never introduce a claim that contradicts an earlier section of the same page.

## Step 3: Graph Factoring & Voice Translation

Raw daily notes often carry chat residue (`"You are completely right"`, `"The short answer:"`, `"In your framing..."`), unverified secondary citations, or hardcoded-hex inline SVGs. Before touching any wiki file, translate the material to match `content/wiki/Wiki Assessment.md` and `CLAUDE.md`:

- **Single canonical home (`WP:SUMMARY`):** Place detailed mechanisms, equations, or comparison tables on **one** canonical page. Cross-link or transclude (`![[Page#Heading]]`) from neighbor pages; add `*Main article: [[target]]*` or `*Further information: [[target]]*` hatnotes only when the target page actually holds a deeper treatment.
- **Strip chat residue & meta-scaffolding:** Remove all second-person Q&A framing, `"The short answer:"` headers, and bolted-on `"Wiki adjudication:"` / `"Editorial synthesis"` banners. State the biological or mathematical tension and its resolution directly inside the narrative.
- **Anti-patterns to reject on sight (the "anxious fact-checker" LLM voice, 2026-11-25 audit):**
  - _Metronomic staccato kickers ("Not X. It is Y."):_ Never end every paragraph with a clipped negative disclaimer (_"Calling one case generative and another crab mentality labels the cases. It does not test them."_, _"The data support a smaller claim."_, _"It does not settle whether..."_). Use varied sentence rhythm with causal subordination (_because_, _while_, _yet_) and let the mechanism or data carry the point.
  - _Shadow-boxing invisible daily-note strawmen:_ Never argue against a loose claim from the raw daily note that a wiki reader never saw (e.g., lecturing a reader of `Pension financing models` that _"asset ratios say nothing about the biology of aging"_, or repeating _"the future condition is not a proximate cause"_ five times across `Predictive plasticity`). State a conceptual distinction once, cleanly, where it belongs.
  - _Cookie-cutter `## Boundary` / `## Where the claim stops` footers & leaked pipeline text:_ Do not stamp every article with a scolding disclaimer section at the bottom, and **never** leak editorial intake status into reader prose (_"Four examples from the source note are not covered here… they stay as leads"_, _"X, Y, and Z are not treated here"_). Weave real scope limits into the section where they arise; track deferred leads only in `intake_ledger.json`.
  - _"X and colleagues found that…" book-report chains:_ Lead paragraphs with the physical mechanism, experimental perturbation, or conceptual puzzle—not a parade of researcher names. Keep `Author (Year)` in `[^footnotes]` unless the author's name carries conceptual priority (e.g., Waddington, Wilkins, Peto, Godfrey-Smith) or you are narrating a chronological discovery sequence (as in `telomeres.md` or Wikipedia's _Enzyme_).
- **Encyclopedic FA voice across macro, meso, and micro scales (not executive-briefing / AI study-guide prose, 2026-11-26 audits of biological FAs _Evolution_, _Enzyme_, _Virus_, _Archaea_, _Immune system_, _DNA_ and full non-biological FAs _General relativity_, _Supernova_, _Apollo 8_, _Great Fire of London_, _Song dynasty_, and _Afroyim v. Rusk_):** Hitting stylometric numbers alone is insufficient if the prose still reads like a Substack outline or textbook cheatsheet. Match real Wikipedia FA craft:
  - _Macro (lead scope, narrative arc, and fair disputes):_ Substantial articles open with a 3–4 paragraph standalone lead previewing every major section (definition, history/origin, mechanism, evidence/debates, consequences). Place historical background, structural preconditions, or observational taxonomy _before_ abstract models rather than jumping straight into a disembodied framework or burying history at the bottom. When scholars or models disagree, present each side's concrete numbers and reasoning fairly before showing where they diverge.
  - _Meso (section bridges, concrete texture, no `"therefore [moral]"` closers):_ Open multi-subsection `##` sections with a 2–3 sentence orientation bridge. Write continuous 4–7 sentence paragraphs (80–180 words) chained by given-to-new topic flow; **never** cap paragraphs with aphoristic bumper-sticker slogans (_"Rigid PAYG hits fiscal deadlock first."_) or didactic `"Therefore X..."` wrap-up morals—end on the last concrete fact, measurement, or qualification. Anchor abstractions with physical scales, dates, sample sizes, and mechanisms. Reserve bullet lists for `## Terminology` glossaries and formal classifications; avoid `"N patterns"` throat-clearing and premature lead-adjacent summary tables.
  - _Micro (no mid-body bold clutter, ordinary verbs, calm modesty):_ Reserve `**bold**` for the article title/aliases in the first sentence (and table/glossary headers)—sprinkling bolded terms throughout body paragraphs reads like an AI study guide; use plain text, `[[wikilinks]]`, or _italics_ on first use instead. Prefer plain verbs (_is, occurs, rises, falls, remains, depends on, differs, led to_) over essayist shorthand (_hits deadlock_, _wipes out_, _flips sign_, _exposes sharp divergence_), stitch sentences with shared nouns instead of repetitive `"therefore"` / `"consequently"` crutches, and state scientific uncertainty calmly in half a clause (_"remains unclear"_, _"is still debated"_) rather than lecturing as an epistemic cop.
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
2. **Wiki lint, stylometry & formatting check:**
   - Run `pnpm run lint:wiki <edited wiki files>` (the single unified wiki linter: structural/evidence checks, Vale lexical rules, Wikipedia-FA-calibrated stylometry, spaCy Biber/dependency syntax, and crash-blossom ambiguity detection). Fix every finding before marking the daily note processed.
   - Run `pnpm run check:format:changed` (note: `content/wiki/` is ignored by Prettier to preserve Obsidian wikilinks, but any scripts or config files touched must pass Prettier).
3. **Record in the intake ledger:**
   - Mark the daily note as processed so future sessions don't re-triage unchanged text:
   ```powershell
   python .agents/skills/daily-note-wiki-editor/scripts/triage_daily_notes.py mark --date YYYY-MM-DD --targets "wiki/Page1.md,wiki/Page2.md" --notes "Brief summary of what was integrated or skipped"
   ```
   - When a note holds several unrelated blocks, mark only the sections you processed. Add `--sections` with the `[n]` indices shown by `inspect` (or full section hashes), for example `--sections "2,3,4,5"`. Unlisted sections stay unprocessed and the note shows as `PARTIALLY_PROCESSED` in `scan` until they are handled. Omit `--sections` only when every block was integrated.
   - If a section was marked and needs to be triaged, reopen it with `unmark --date YYYY-MM-DD --sections "n"` and a `--notes` reason. Nothing in a daily note is ephemeral, so `unmark` is the way to undo a premature close.
   - If the owner later appends new sections to that same daily note, `scan` will detect the hash change and flag only the new/modified sections.
