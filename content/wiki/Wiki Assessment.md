---
title: Wiki Assessment
tags:
  - meta
date: 2026-11-15
draft: true
class: NA
aliases:
  - Content assessment
  - Quality scale
---
# Wiki Assessment

**Wiki assessment** defines the quality grades (`class`) and editorial priority levels (`vital_level`) tracked across `content/wiki/` in `Content Status Base.base`. Modeled on Wikipedia's content assessment scale and adapted for a cross-disciplinary longevity and clonal-governance wiki, the rubric separates two regimes: **criteria-gated classes (`Stub` through `B`)**, which can be checked mechanically against explicit thresholds including scope hygiene, and **court-gated classes (`GA`, `A`, `FA`)**, which require an adversarial three-role LLM Court evaluating graph integration, terminological precision, primary-paper forensic quality, unsmoothed conflict mapping, and dual-audience exposition.

## Assessment Philosophy: Checklists up to `B`, Substantive Judgment Above `B`

Mechanical rules catch under-built stubs, missing sourcing, and surface duplication, while deciding whether a page deserves a higher grade requires editorial and scientific judgment that checklists cannot automate:

1. **Criteria-gated tiers (`Stub`, `Start`, `C`, `B`)** verify topical focus, `MOS:LEAD` structure, level-indexed baseline terminology, primary citations, scope hygiene (earned hatnotes, summary style, non-duplication), readable sequential prose, and the archetype-matched visual/interactive bar. Passing every gate promotes an article up through `B` without convening a Court.
2. **Court-gated tiers (`GA`, `A`, `FA`)** never promote automatically from word counts, citation counts, chart counts, or isolated prose polish. An article can read smoothly on its own while still weakening the wiki—by cloning neighbor explanations, credential-laundering fragile or manipulated studies behind primary PDF quotes, hiding cross-level fitness flips under vague terms like *"aging"*, smoothing real empirical conflicts into fake *"both sides + bolted-on adjudication"* symmetry, adding needless defensive hatnotes or meta-scaffolding, packing controls into CYA semicolon-chained academese and inline `Author (Year)` clutter, or locking out either field biologists or non-biologist quantitative readers. Passing `B` eligibility only nominates an article to a graph-, source-, and taste-aware **LLM Court**.

---

## Quality Scale (`class`)

| Class | `class_rank` | Promotion Gate | Defining Standard |
| :--- | :--- | :--- | :--- |
| **FA** | 1 | **LLM Court** (unanimous graph + epistemic + craft bar) | Flagship showcase node: crisp LessWrong-grade sequential prose where math grows brick-by-brick, molecular steps are chewed to bedrock, and jargon names built concepts rather than skipping setup; exhaustive forensically audited primary provenance with clean cropped excerpts; unsmoothed source partitioning; decisive lens-backed synthesis integrated into the narrative; signature figures/interactives; and zero graph duplication, meta-scaffolding, or drift. |
| **A** | 2 | **LLM Court** (canonical synthesis & forensic rigor) | Authoritative synthesis for its canonical slice: primary full-text verification and cropped excerpts on pivotal claims, forensic paper-quality auditing across competing studies, systematic negative/null coverage, level-indexed terms, clear reasoned stands integrated without bolted-on verdicts, tight math/chart/prose alignment, and verified consistency across linked pages. |
| **GA** | 3 | **LLM Court** (net-positive epistemic & graph pass) | Clear, `draft: false`-ready article that strengthens its neighborhood: key claims grounded in forensically sound primary full text with clean cropped excerpts, level-indexed terminology, honest conflict mapping without fence-sitting, crisp non-CYA prose with footnotes holding bibliographic clutter, setup-first jargon accessible to both field biologists and quantitative non-biologists, disciplined summary delegation/transclusion, and clean Quartz rendering. |
| **B** | 4 | Criteria checklist | Scoped mechanism and dispute coverage (delegating covered subtopics via summary style and hatnotes), audited full-text citations (`[^key]` + DOIs) with cropped primary-source excerpts on pivotal claims/definitions, model predictions separated from data, mutual graph links, and **high-effort visual/interactive representation**. |
| **C** | 5 | Criteria checklist | Focused encyclopedic primer (zero chat/tutorial voice), 1-2 para lead, clean `##` structure, >= 5 verified full-text/review sources (`[^key]`, cropped primary excerpts encouraged on core definitions), >= 1 grounded visual or analytical artifact, explicit scope links to neighbors, and wiki/Glossary integration. |
| **Start** | 6 | Criteria checklist | Usable outline or partial primer missing major branches, balanced sourcing, structure, or visuals. |
| **Stub** | 7 | Criteria checklist | Placeholder, definition, or sparse notes (< ~150 words) lacking developed sections. |
| **FL** | 8 | Criteria checklist | Featured-standard structured list/index ([[Labs]], [[Tier List cell lines]]). |
| **List** | 9 | Criteria checklist | Standard curated list or glossary table ([[Glossary]]). |
| **NA** | 10 | Project/hub page | Non-encyclopedic hub, meta documentation, or rubric page (such as this page and `wiki/index.md`). |

---

## Explicit Thresholds for Criteria-Gated Classes (`Stub` to `B`)

Every criterion in a row must hold; falling short on one dimension keeps the article at the lower grade.

### 1. `Stub` -> `Start`

- Correct frontmatter (`title`, `tags: [content/wiki]`, `date`, `draft`, `vital_level`, `class`, `aliases`).
- At least a minimal coherent summary or outline of the subject (~150+ words of real domain content, not empty headings).

### 2. `Start` -> `C`

- **Focused scope and voice:** The body treats the titled topic rather than an unrelated digression or a clone of an existing page's scope. Zero second-person chat residue (`"Your intuition..."`, `"You asked..."`), informal hype, or tutorial coaching.
- **Structure and lead:** 1-2 paragraph encyclopedic lead (`MOS:LEAD`: bolded title in first sentence, definition, significance, and clean links to genuinely adjacent concepts without defensive disclaimers), followed by proper `##` / `###` Markdown sections and complete punctuation.
- **Baseline sourcing:** At least **5 inline footnote citations** (`[^key]`) pointing to primary papers or authoritative reviews with DOIs or stable identifiers.
- **Grounded visual or analytical aid:** At least **1 captioned diagram/figure** in `content/Attachments/` (or Excalidraw SVG) **or** a dense structured comparison table (linked/transcluded via `![[...]]` if canonical elsewhere). ASCII-box diagrams do not count toward this gate.
- **Wiki integration:** Outbound `[[wikilinks]]` to related concepts/proteins, valid `aliases`, and listed in `wiki/index.md` (and `wiki/Glossary.md` when defining a core term).

### 3. `C` -> `B`

- **Scoped depth, clean prose craft & summary style (`WP:SUMMARY`):** Covers canonical mechanisms, major model organisms/taxa, quantitative or boundary conditions, failure modes, and principal empirical or theoretical controversies *belonging to this article's canonical slice*. Where a subsection already has its own substantive dedicated wiki entry, summarize the takeaway cleanly with a `*Main article: [[target]]*` or `*Further information: [[target]]*` hatnote rather than cloning a full treatment; never add `*Main article:*` hatnotes to thin stubs or top-of-page disambiguation against concepts nobody confuses. Express complex setups in crisp sequential sentences with bibliographic `Author (Year)` tags moved to `[^footnotes]` rather than semicolon-chained academese.
- **Proportional `MOS:LEAD`, unified voice & level-indexed terminology:** 2-3 cohesive paragraphs summarizing definition, mechanisms, empirical status, and open debates in one integrated authoritative voice (zero meta-scaffolding headers like *"Editorial synthesis"* or fake *"both-sides + bolted-on adjudication"* endings). Mechanistic claims follow `[[Glossary]]` and `[[Non-technical language in longevity]]` (indexing the specific biological level rather than substituting bare *"aging"* or *"damage"* for distinct actuarial hazards, frailty, mutation loads, or cellular arrests).
- **Primary-source audit & excerpt preference:** Every concrete claim, parameter, effect size, and date carries an inline `[^key]` citation verified against the full primary text (never abstract-only summaries or model memory). Follow the **Primary Sourcing Ladder** below: include `>= 2` clean `> [!info]-` primary excerpt callouts (cropped PNG from an OCR-parsed PDF page *or* the publisher's full-text HTML body, plus verbatim quote and page/section/DOI) grounding core definitions, pivotal experimental claims, or direct attributions without leaking internal tooling notes to readers. Model predictions are explicitly distinguished from in vivo measurements; negative/null studies, assay artifacts, and methodological limits are noted directly.
- **High-Effort Visual and Interactive Representation:** Meets the domain-matched bar specified below (decorative padding or missing an obvious interactive intuition blocks `B`).
- **Mutual graph integration and build sanity:** Reciprocal links and harmonized summaries across parent/sibling pages (no verbatim copy-pasted sibling tables or charts where `![[Page#Section]]` / `![[Page#^block]]` transclusion applies), zero broken embeds or malformed callouts, and valid Vega-Lite/CSP syntax.

---

## Wiki Factoring, Prose Craft & Voice Discipline

A wiki improves through structured division of labor and readable craft, not isolated textbooks stuffed with defensive boilerplate:

1. **Single canonical home & earned hatnotes:** Every specific experiment, mathematical model, species table, or trial scorecard belongs in detail on **one** primary page; use `![[Page#Heading]]` / `![[Page#^block]]` transclusion when canonical tables or definitions repeat verbatim. Use hatnotes (`*For X, see [[Y]]*`, `*Main article: [[Z]]*`) **only** when a reader genuinely risks landing on the wrong concept or when the target page actually contains the deeper treatment—never write defensive top banners telling readers how the topic differs from unrelated concepts nobody confuses it with, and never point `*Main article:*` at thin protein stubs.
2. **Summary style & mutual dependency:** Hub pages delegate depth downward; specialized pages link upward for evolutionary/physiological framing rather than re-teaching it from scratch. Putting a `*Main article:*` hatnote above an equally long duplicated section fails this rule.
3. **LessWrong sequential clarity over CYA academese:** Never cram an experimental assay, cell count, feeder ratio, fold-change, genetic deletion, and rescue control into one 60-word semicolon-chained cover-your-ass sentence. Unpack complex findings into crisp sequential English sentences—setup, observation, perturbation/control, and boundary—so neither biologists nor quantitative generalists have to parse sentence trees three times.
4. **Footnotes hold bibliographic clutter:** Move journal titles, author lists (`"Smith et al."`), and publication years out of body prose into `[^footnotes]` by default. Name researchers inline only when attribution itself carries conceptual content (comparing competing models by their named formulations, tracing priority, or flagging a specific lab's PubPeer/replication record).
5. **Integrated authority (zero meta-scaffolding, zero fake both-sides):** Never write internal-rubric headings or meta-callouts (*"Editorial synthesis"*, *"Evidence audit"*, *"Wiki adjudication:"*), and never mimic false objectivity by summarizing two opposing views neutrally only to tack on an *"adjudication"* paragraph at the bottom. Weigh conflicting assays, forensic flaws, and evolutionary selection pressures inside the main narrative itself so every section speaks with one clear, honest voice.

---

## Primary Sourcing, OCR & Cropped Excerpt Preference

Grounding claims in primary full text (via OCR-parsed PDFs or publisher full-text HTML) paired with cropped source screenshots serves two essential functions: it **guards against LLM hallucination and paraphrase drift** (forcing authors and reviewers to confront the original source text before stating an effect size or attribution), and it **raises reader trust** by letting anyone expand a reference callout and inspect the photographed passage inline.

| Provenance Tier | Standard in Article | Editorial Rule |
| :--- | :--- | :--- |
| **1. Preferred primary evidence (Cropped excerpt: PDF OCR or full-text HTML)** | Clean `> [!info]-` callout with cropped image from the original paper + verbatim quote + page or section/DOI link | Required bar for pivotal mechanisms, parameters, effect sizes, model assumptions, and attributed quotes. Use **OCR-parsed PDFs** as your local verification base for archival works, scans, preprints, and PDF-only papers; use a **publisher full-text HTML crop** whenever it reads cleaner (such as an open-access paper whose quote splits across PDF columns or page breaks). Both count equally when cropped from the paper body. |
| **2. Audited full-text citation** | Verified `[^key]` full-text PDF or HTML article with DOI/PMID/PMC (no callout image) | Fine for routine background or corroboration when non-contested claims rest on it; insufficient alone for central controversies or key experimental numbers at `GA` and above. |
| **3. Disqualified** | Abstract-only citations/crops, unverified recalled numbers, bare author-year mentions, or secondary blogs standing in for primary studies | Never qualifies as primary evidence at `C` or above; triggers audit failure if pivotal claims depend on it. |

**Keep technical plumbing out of reader prose:** Articles must never display pipeline messages (`"OCR packaging was unavailable"`), raw parser locators, tool names, or editor excuses. Anyone checking a note can see directly from the cropped passage image and citation whether it came from a primary paper body versus an abstract or missing source; if a paywalled or unparseable paper still needs full-text acquisition, track it in the work queue or Court review notes rather than on the page itself.

*Provenance vs. reliability:* A cropped primary excerpt proves what a paper *wrote*, not that its experiment was well controlled, unbiased, or real. Whether cited studies survive visual, statistical, and methodological scrutiny is audited adversarially in [The LLM Court](#the-llm-court-ga-a-fa-promotions).

*Scope note:* Because primary excerpt callouts verify textual provenance across **every** article archetype (models, mechanisms, biographies, genes, clinical reviews), they do not count as a substitute for biological schematics, primary experimental plates, or quantitative plots under the visual/interactive standard below.

---

## High-Effort Visual and Interactive Representation Criterion

Visuals and interactive components sit in a **single combined criterion** so an article is judged on the highest-leverage non-text medium for *its subject*, rather than forcing parameter sliders onto biographies or static text onto dynamical models.

| Article Archetype | Required High-Effort Standard for `B` and Above | Examples |
| :--- | :--- | :--- |
| **Quantitative models, demographics & dynamical processes** | **>= 1 interactive `vega-lite` chart or live simulation** (parameter sliders via `params` / CSV data in `content/Attachments/`, following `CLAUDE.md` theme rules) **plus** mechanistic or structural figure(s) linking model variables to biology (`>= 2` visual/interactive units). | [[Mortality rate models]], [[petos-paradox]], [[disposable-soma-theory]], [[Clonal governance]], [[Compensatory proliferation]] |
| **Developmental, anatomical & cellular mechanisms** | **>= 2 high-craft captioned figures** combining mechanistic/anatomical schematics with primary-source experimental plates, lineage/anatomy diagrams, or comparative visuals (`>= 4` figures when the argument rests primarily on classic experimental evidence). | [[Mosaic vs regulative development spectrum]], [[Indeterminate growth]], [[weismann-barrier]] |
| **Biographies & History of Science** | **>= 2 substantive visual/archival artifacts**: verified portrait, archival lab media, historical monograph plates, or annotated intellectual-lineage/career timelines (plus interactive plots only if modeling a formal theory authored by the subject). | [[george-c-williams]], [[History of biogerontology]] |
| **Genes, proteins & clinical/experimental topics** | **>= 2 domain-appropriate artifacts**: annotated domain/pathway architecture diagram plus empirical quantitative plots (survival, dose-response, or trial comparisons via `vega-lite` or publication figures). | [[senolytics]], [[Types of tumor suppressor genes]] |

**Automatic disqualifiers for this criterion:**
- Decorative stock visuals, uncaptioned screenshots, or ASCII-art flowcharts substituting for real SVG/PNG/Vega-Lite figures.
- Vega-Lite specs using hardcoded hex colors instead of theme mark styles (`observed`, `model`, `alt`, `guide`, `label`) or expressions requiring `unsafe-eval`.
- Mechanical "slider padding" that lets users tweak trivial scaling constants without exposing a biological tradeoff, bifurcation, or empirical fit.

---

## The LLM Court (`GA`, `A`, `FA` Promotions)

Mechanical checks stop at `B`. **An article can be grammatically smooth, visually stocked, and admirable in isolation while still weakening the wiki—through graph duplication, credential-laundered bad papers, level-blurred terminology, smoothed-over conflicts, timid fence-sitting, or one-sided disciplinary jargon.** The Court exists to exercise the architectural, forensic, and expository judgment that checklists cannot automate: deciding whether promoting this article in its current shape creates a **net improvement to the entire wiki**.

### Mandatory Graph, Source & Lens Dossier

A Court session never evaluates an article on a desert island or takes citations on trust. Before arguments begin, the nomination packet MUST supply all three roles with:
1. The candidate article, its desktop/mobile/theme checks, its embedded excerpt images, and **direct access to cited primary sources—including Methods, figure plates, supplementary tables/spreadsheets, and known PubPeer, correction, retraction, or independent replication records** where reachable—so claims are audited against both primary text and underlying experimental integrity.
2. Every direct outgoing `[[wikilink]]` neighbor and existing backlink in `content/wiki/`.
3. Parent conceptual hubs, child sub-articles, and any topically overlapping pages covering shared pathways, experiments, models, or species tables.
4. The wiki's conceptual and lexical baselines (`[[Glossary]]`, `[[Non-technical language in longevity]]`, `[[Clonal governance]]`, `[[De-Darwinization]]`, `[[Empirical constraints on longevity models]]`) so all three roles apply the same level-indexing and evolutionary-constraints standard.

Any Court review that inspects only the candidate prose without its graph neighborhood, underlying primary sources, and methodological audit context is procedurally invalid.

### Court Roles

Each promotion review above `B` runs three isolated contexts (Advocate, Alex-style Devil's Advocate, and Judge; the drafting agent cannot hold any Court role). **Never improvise bespoke per-article Court prompts:** coordinator-authored prompts drift across articles and leak editorial framing. Always invoke the standardized `.agents/skills/wiki-court/` workflow (`run_workflow` on `scripts/run_court.py` with `Args: {"article": "<Article Name>"}` as the sole required variable), which deterministically scans outbound/inbound wikilinks, unlinked wiki terms, attachments, and headless browser renders before instantiating fixed canonical templates:

1. **Advocate LLM (Argues for Net Wiki Value Across Graph, Evidence, Taste & Craft):** Builds the positive architectural, epistemic, and pedagogical case that promoting the candidate to `GA`, `A`, or `FA` **makes the wiki as a whole stronger**: defends why this page owns a clear canonical slice, shows how summary style, earned hatnotes, and `![[...]]` transclusions divide labor cleanly with neighbors, demonstrates that pivotal claims rest on forensically sound primary sources (honestly partitioning dissent and taking clear lens-backed positions seamlessly inside the narrative), verifies level-indexed precision, and shows that the prose reads in clear sequential LessWrong-grade English with footnotes holding bibliographic clutter and both math and molecular mechanisms built brick-by-brick.
2. **Devil's Advocate LLM (Alex-Grade Adversarial Taste, Black-Swan Hunter & Forensic Prosecutor):** Reads section-by-section from top to bottom as a skeptical, hard-to-please LessWrong generalist paired with a forensic experimental auditor—assuming the draft has structural, logical, or craft defects until every section proves otherwise. **Never treat a checklist as the ceiling:** actively hunt **unanticipated "black swan" flaws** that hurt reading quality, intellectual honesty, or wiki cohesion just because nobody pre-named them here (for example: needless top disambiguation disclaimers against unrelated topics readers never confuse; `*Main article:*` hatnotes pointing to empty stubs; cover-your-ass semicolon-packed academese sentences; inline `Author (Year)` or paper-title clutter better parked in footnotes; meta-scaffolding headers or callouts like *"Editorial synthesis"* or *"Evidence audit"*; fake *"Camp A says X / Camp B says Y"* balance followed by a bolted-on *"Wiki adjudication:"* footer; missing causal intuition for *"why did evolution build this circuit instead of something simpler?"*; or awkward section ordering). In addition to open-ended critical taste, never let these **minimum tripwires** pass:
   - **Graph redundancy, missing factoring, and canonical drift:** Rewritten neighbor explanations, species tables, equations, or trial summaries that belong in `![[target#section]]` transclusions or `*Main article: [[target]]*` delegation; thin micro-forks that belong in a parent page; broken mutual dependency; needless defensive hatnotes; or conflicting claims/parameters across linked pages.
   - **Hallucination-by-paraphrase, weak provenance & pipeline leakage:** Overstated causation, broader taxonomic claims, or misread numbers vs. the primary text or cropped excerpt; pivotal claims resting on abstracts or secondary blogs; or tooling excuses (`"OCR packaging unavailable"`), raw parser locators, CLI names, and editor TODOs leaking into reader-facing prose.
   - **Nontechnical / level-unindexed umbrella language:** Technical or causal explanations leaning on multi-level folk words (*"aging"*, *"senescence"*, *"damage"*, *"immortality"*, *"rejuvenation"*, *"health"*) instead of indexing the exact level (`mortality creep`, `frailty`, `somatic mutation load`, `replicative arrest`, `lineage-identity reset` per `[[Non-technical language in longevity]]` and `[[Glossary]]`)—especially where umbrella wording masks Level 2 -> Level 3 fitness sign flips or mistakes active tumor suppression for passive wear.
   - **Uncritical reliance on compromised, *p*-hacked, or fraudulent sources:** Central claims or effect sizes propped up by unreplicated, forensically suspect, or methodologically broken papers audited against the **Source-Quality & Forensic Checklist** below (PubPeer/retraction flags, Elisabeth Bik and Sholto David image/reagent anomalies, Data Colada statistical/spreadsheet red flags, *p*-hacking, and biased longevity study designs). A cropped PDF screenshot only proves what the paper printed, not that its blots, stats, or controls deserve credence.
   - **Smoothing out the source landscape:** Flattening real heterogeneity into `"all studies support X"` (hiding single-lab clustering, failed replications, or taxon limits) **or** lazy `"evidence is mixed / studies contradict"` symmetry without partitioning *why* studies diverge by assay, organismal model, endpoint, sample size, or methodological rigor.
   - **Timid fence-sitting or bolted-on "both sides + adjudication" structure:** Presenting *"both perspectives have merit"* / *"further research is needed"* hedging—or summarizing two sides neutrally only to tack a separate *"Wiki adjudication:"* paragraph onto the bottom—when empirical constraints or [[Clonal governance|clonal-governance]] / [[De-Darwinization|de-Darwinization]] selection logic already resolve the asymmetry cleanly inside the main text.
   - **Obscurantist register skew (too math-brained, too biologist-brained, or CYA sentence grammar):** Unmotivated formulas dropped without showing why naive models fail; compressed wet-lab jargon dropped before building the conceptual puzzle it names; or 50-word semicolon-chained omnibus sentences and inline `Author (Year)` clutter instead of crisp sequential English sentences that teach both field biologists and smart generalists cleanly.
3. **Judge LLM (Weighs Net Wiki Delta, Forensic Soundness & Editorial Taste):** Reads the full article, graph/source/lens dossier, Advocate brief, and Devil's Advocate brief (treating unanticipated black-swan taste defects discovered by Devil's Advocate on equal footing with named tripwires), then issues one of two binary verdicts:
   - **Promote (`GA`, `A`, or `FA`):** Only if the page improves the whole wiki (sharp canonical ownership, clean mutual dependency, zero harmful duplication or useless hatnotes), reads effortlessly in sequential LessWrong-grade prose with clean footnote attribution and unified voice, keeps terminology level-indexed, clears all pivotal supporting sources of unacknowledged forensic/design defects, maps source conflicts cleanly without bolted-on verdicts, teaches both field biologists and quantitative generalists thoroughly, and hits the target tier's visual/rendering bar.
   - **Remand (with Concrete Refactor Order):** Blocks promotion whenever any material defect—whether listed in the tripwires or uncovered fresh by adversarial taste—remains in graph factoring, hatnote hygiene, sentence clarity, unified voice, primary provenance, paper quality, terminological indexing, landscape partitioning, or dual-audience setup. Prescribes exact repairs.

### Source-Quality & Forensic Audit (Bik, Data Colada & Sholto David Standard)

Court reviewers must actively interrogate influential, surprising, single-lab, or commercially conflicted primary papers rather than treating peer review or journal prestige as proof of validity:

| Audit Axis | Concrete Red Flags Checked (Methods, Figures & Supplements) | Editorial Consequence |
| :--- | :--- | :--- |
| **Post-publication & replication record** | Active **PubPeer** threads on main figures, Expressions of Concern, major errata, retractions, single-lab/patent-holder isolation, or failed independent multi-site / RCT tests (e.g., NIA Interventions Testing Program failures vs. small single-group mouse claims). | Flag conflict explicitly; failed pre-registered multi-site tests or Phase 2 RCTs outweigh small positive claims. |
| **Image & assay forensics** *(Elisabeth Bik / Sholto David)* | Duplicated, rotated, cropped, horizontally mirrored, or splice-masked Western blot bands (`"tadpoles"`, blank cut-out rectangles, reused loading controls); overlapping or clone-stamped microscopy, IHC, histology, colony, wound-scratch, or Transwell fields; identical or artificially gridded FACS dot clouds; bar quantifications contradicting `"representative"` blots; paper-mill telltales (*"tortured phrases"*, templated charts, mismatched primers, misidentified cell lines). | Forensically compromised figures cannot support mechanistic or efficacy claims; note integrity concerns explicitly or drop the source. |
| **Statistical & raw-data forensics** *(Data Colada / Brown–Heathers / Carlisle)* | Mathematically impossible means/SDs for integer $N$ (`GRIM` / `GRIMMER` / `SPRITE`); suspiciously uniform SD/SEM error bars or razor-thin variance across disparate conditions; `SD` vs. `SEM` conflation; impossibly balanced randomized baselines (Carlisle checks); flat/left-skewed *p*-curves clustering around `p = 0.04` in tiny $N$; *p*-hacking signatures (covariate shopping, optional stopping, dropped arms/outliers, switched trial endpoints); spreadsheet duplicate rows, broken sort order, or number-bunching. | Treat unverified `p`-hacked or mathematically impossible results as non-evidential; expose design flexibility directly. |
| **Longevity & oncology design traps** | Survival counted only from mid-life dosing rather than from birth; stressed/short-lived vehicle controls inflating relative extension; progeroid mutant rescue presented as general aging delay; promiscuous markers (*SA-β-gal*, high *p16*) read as senescence without ruling out macrophages, endothelial cells, or lysosomal hypertrophy; phenomenological curve extrapolations far outside age data (`[[critical-point-model-of-ageing]]`). | Separate proxy/protocol artifacts from validated lifespan/fitness claims on both prose and plots. |

### Target Standards Evaluated by the Court

- **`GA` (Good Article):** Clear, authoritative encyclopedic prose built in crisp sequential English sentences for a dual audience—readable both by field biologists (mathematical models motivated brick-by-brick from empirical/naive failures) and by smart non-biologists such as programmers and rationalists (molecular cascades and wet-lab assays unpacked step-by-step so technical jargon closes built gaps rather than name-dropping PhD shorthand, with zero CYA semicolon stacking and with bibliographic clutter moved to `[^footnotes]`). Leaves its graph neighborhood cleaner than before: level-indexed terminology (`[[Non-technical language in longevity]]`); pivotal claims grounded in verified primary full text with clean `> [!info]-` cropped excerpts (zero leaked tooling notes) from forensically sound studies; honest partitioning of conflict vs. consensus; reasoned positions grounded in evidence and our [[Clonal governance|clonal-governance]] lens woven directly into the main text (no fake `"both sides"` + bolted-on verdict footers, no meta-scaffolding); earned hatnotes only where genuine reader confusion or fuller target articles exist; domain-apt visuals/interactives; verified mobile/desktop and light/dark Quartz rendering; `draft: false`-ready stability.
- **`A` (Canonical Synthesis & Cross-Graph Alignment):** Authoritative within its defined canonical boundaries (spanning scales only where the phenomenon itself crosses scales, delegating sub-mechanisms cleanly to substantive child pages); exhaustive full-text primary verification and cropped excerpts paired with methodological and forensic quality weighting across competing datasets, controls, and assays; systematic negative/null coverage across taxa; crisp partitioning of what each assay/model settles vs. leaves open, with non-evasive adjudication integrated natively into the exposition wherever evolutionary constraints or replication hierarchy resolve a dispute; seamless bidirectional exposition across equations and molecular machinery with strict symbolic/lexical alignment between prose, formulas, and charts; and verified numeric/conceptual consistency across parent and sibling pages.
- **`FA` (Featured Article):** Flagship showcase node in the wiki graph. Prose at the wiki's highest plain-spoken LessWrong-grade craft: sequential sentences without CYA academese, every mathematical formulation growing organically from why naive models break, every biological pathway and experimental control chewed cleanly to bedrock without cutting technical depth, and jargon landing purely as precision naming over well-built foundations; unimpeachable primary-source forensics and provenance with clean reader-inspectable excerpt callouts; signature bespoke figures and/or interactive models that teach faster than prose alone; decisive, falsifiable synthesis anchored seamlessly in the wiki's evolutionary framework; and exemplary graph factoring (zero duplicated bulk, meta-scaffolding, useless hatnotes, or drift).

---

## Vital Level (`vital_level`)

| `vital_level` | Priority Tier | Role in `Content Status Base` |
| :--- | :--- | :--- |
| **1** | Core pillar | Foundational thesis concepts ([[cellular-senescence]], [[Clonal governance]], [[petos-paradox]], [[tumor-suppressor-theory-of-aging]]). |
| **2** | High priority | Central mechanisms, classic experiments, or core models ([[apoptosis]], [[Cell competition]], [[adaptive-oncogenesis]]). |
| **3** | Supporting concept | Specific processes, sub-phenomena, or cross-cutting hubs ([[Compensatory proliferation]]). |
| **4** | Specialist detail | Specific proteins, signaling archetypes, or narrower subtopics ([[yap-yap1]], [[bioelectricity]]). |
| **5** | Peripheral | Background notes or stub placeholders. |

Articles with `vital_level <= 2` and `class` below `GA` (`class_rank >= 4`, excluding `NA`) automatically surface in the **Priority Gaps** view of `Content Status Base.base`.
