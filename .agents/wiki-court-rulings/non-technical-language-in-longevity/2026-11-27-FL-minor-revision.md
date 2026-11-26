## Judicial Opinion: `Non-technical language in longevity` (`List` → `FL`)

**Ruling: `MINOR_REVISION` (Conditional Accept — Local Judge Verification Only).**

Following the earlier `FL` promotion of the 9-row version (`2026-11-27-FL-promote.md`), this page was substantially expanded to 16 rows and given a new "only two orthogonal coordinates" framing. That expansion strengthens the lookup table's coverage of contested longevity buzzwords (`Frailty`, `Healthspan`, `Biological age / aging clock`, `Inflammaging`, `Anti-aging / geroprotector`, `Fitness`), preserves clean graph factoring (17/17 resolved outbound wikilinks, zero duplication of `[[de-darwinization]]` or `[[Mortality rate models]]`), and maintains 35 real, non-hallucinated DOIs.

However, the new edits introduced **five concrete, bounded scientific, mathematical, schema, and forensic defects**—including an observational-vs-Mendelian-randomization smudge that directly contradicts `[[telomeres|Telomeres]]`, a calculus bait-and-switch in Thought Experiment 1, a false reductionist claim about tissue physiology, and a 50× understatement of CTVT's genome-wide mutation burden. Because `Wiki Assessment.md` designates this page as the canonical lexical baseline enforced across the entire wiki, those errors cannot be waved away as harmless. At the same time, the page's architecture, scope boundaries, and 16-row table design are already sound; a full remand to external counsels is unnecessary. Once the five surgical items in the closed contract below are fixed and verified locally, the article clears `FL`.

---

### 1. Local Repo & Render Verification

Direct inspection of `Non-technical language in longevity.md`, its linked neighbors (`Glossary.md`, `telomeres.md`, `Mortality rate models.md`, `cellular-senescence.md`, `de-darwinization.md`, `Clonal governance.md`), prior rulings, and the headless Quartz screenshots (`top_light.png`, `top_dark.png`, `mobile.png`) established:

- **Local contradiction on `Codd et al. (2021)` (Alex upheld):** Line 53 splices _"with shorter leukocyte telomeres associated with lower overall life expectancy"_ onto the back of a Mendelian randomization sentence citing `[^haycock2017][^codd2021]`. In Codd et al. (2021), that ~2.5-year life-expectancy gap is a **purely observational** Cox regression result confounded by smoking, SES, and inflammation (where observational short LTL predicts _higher_ cancer mortality, the opposite of MR). Worse, our own linked neighbor `[[telomeres|Telomeres]]` (lines 21, 108) explicitly states that _"across general populations genetically shorter telomeres do not shorten life"_ (`Rode 2015`, `Kuo 2019`).
- **Calculus & perturbation conflation in Thought Experiment 1 (Alex upheld):** Line 37 transitions from Allele _A_ ($\mu_A(t) = 0.1\,\mu(t)$ for $t < 50$) to _"Even the model-free life-table aging rate, $\mu'(t)/\mu(t)$, jumps sharply whenever age-independent Makeham extrinsic mortality falls..."_ For Allele _A_'s multiplicative pre-50 cut, the factor of $0.1$ cancels identically in $\mu'_A(t)/\mu_A(t) = \mu'(t)/\mu(t)$ for $t < 50$ (with a non-differentiable step discontinuity at $t = 50$). The LAR surge occurs under a **distinct, smooth perturbation**: lowering the additive age-independent Makeham constant $c$ in $\mu(t) = c + a e^{bt}$ while holding $a e^{bt}$ fixed. Presenting it as _"Even..."_ stitches two mathematically incompatible perturbations together.
- **Coordinate schema violations & false tissue-reduction rule (Alex upheld):** Lines 23–26 promise _"only two orthogonal coordinates"_—`(Level ∈ {1..4}, Mode ∈ {Individual, Cohort})`—and claim that _"tissue physiology on a Level 3 organism is a cohort aggregate of Level 2 cells and their extracellular matrix."_ That reduction is biologically false: a cohort aggregate (like a life table) is permutation-invariant over exchangeable agents, whereas tissue/organ physiology depends on spatial topology, vascular/neural wiring, and abiotic extracellular scaffolds. The conversion table then violates its own declared 2-tuple schema in four rows (`Damage`: `(Level 1 / molecular state)` vs. `(Level 3 policing of Level 2 cells)`; `Fitness`: `evolutionary` / `somatic`; `Cellular immortality`: `lineage`; `Biological age`: cross-level regression arrow). Line 21's _"vital signs ... cannot be projected onto ... a demographic cohort"_ also slightly blurs cross-level non-projectability with cohort aggregation.
- **Bounded forensic, citation, and jargon slips (Alex & Advocate upheld):**
  - Line 52 (`[^baez2019]`): _"tens of thousands of mutations"_ grabs the CTVT exome count (~37,800 SNVs) without saying _"exonic"_, understating genome-wide somatic burden (~2 million SNVs) by ~50×.
  - Line 53 (`[^barthel2017]`): the ~5% _ATRX/DAXX_ bucket is specifically among _TERT_-negative tumors.
  - Line 83 (`[^hall2016]`): `Hall et al. (2016)` showed p16+/SA-β-gal+ macrophages accumulate in aging mice; `Hall et al. (2017)` demonstrated reversible physiological induction in non-senescent macrophages.
  - Lines 108 & 122: two exact bibliographic title typos caught in audit (`[^parras2023]` prints _"dysfunction"_ instead of _"failure"_; `[^hernando2019]` inserts an extra _"aged"_ before _"mouse muscle stem cells"_).
  - Lines 53, 80, 83: `TCGA`, `SASP`, and `SA-β-gal` appear unexpanded on a page titled _Non-technical language in longevity_ aimed at dual-audience readers (`CLAUDE.md`).
- **Quartz render (`render_report.json`, `top_light.png`, `top_dark.png`, `mobile.png`):** Layout, light/dark contrast, and `390px` mobile flow are clean with zero horizontal overflow and zero console/HTTP errors. _(Observation: in `top_light.png` and `top_dark.png`, `$n = 1 \dots 4$` on line 25 and `$n$` on line 26 rendered inside code-styled boxes with literal `\dots`—using plain `n = 1–4` in line 25 avoids raw LaTeX in a bold lead item.)_

---

### 2. Where Alex Overreaches (Rejected — Do NOT Change)

- **Do NOT delete Section 4 (`De-Darwinization and anti-cheater suppression`).** Local inspection of `de-darwinization.md` confirms it does not contain this 4-row table; three prior Court rulings upheld it as a compact, non-duplicative key defining Levels 1–4 and capping the hierarchy against "Level 5 supercolony" fallacies.
- **Do NOT require embedded figures or Vega-Lite plots.** `Wiki Assessment.md` explicitly defines `FL` as a scannable reference artifact (`table, ranked list, matrix, or diagram rather than padded prose`) exempt from narrative/visual quotas, and the interactive Gompertz–Makeham and Gamma-Gompertz frailty plots already live on `[[Mortality rate models]]`.
- **Do NOT bloat the 16-row table into a general geroscience dictionary.** Single-level terms like `senolytics` and `autophagy` already belong in `[[Glossary]]` and their dedicated pages (`[[senolytics]]`, `[[cellular-senescence]]`, which already covers `Grosse et al. 2020` and senolytic trial outcomes). Keeping explicit inclusion criteria focused on multi-level umbrella words and cross-level homonyms is good architectural discipline.
- **Do NOT wikilink `Maynard Smith` in `## References` or `c-Myc` alone inside the Yamanaka quartet.** Both were settled cleanly in prior rulings.

---

### Essential Revisions (Binding Contract)

All five items below must be resolved before local verification (`mode="verify"`) and `FL` promotion:

1. **Repair the coordinate framing and tissue-reduction claim (lines 21, 23–26, and `Coordinate` column):**
   - Replace the overclaim _"only two orthogonal coordinates"_ and the false claim that tissue physiology _"reduces directly to a cohort aggregate of Level 2 cells"_ with an accurate statement: level-indexing tracks **selection level ($n = 1\text{–}4$, plus abiotic molecular/extracellular state)** and **observation mode (individual agent, diachronic lineage, or synchronic cohort aggregate)**, noting that tissue/organ physiology depends on structured spatial architecture and extracellular matrix rather than an exchangeable cell cohort.
   - Align the `Coordinate` column cells in `Damage`, `Fitness`, `Cellular immortality`, and `Biological age / aging clock` so none violate the declared schema (e.g., explicitly label cross-level policing and cross-level statistical mappings rather than pretending they are simple `(Level, Mode)` tuples).
   - Tighten line 21's `vital signs` wording so it states they exist as properties of an individual organism rather than a single cell or a population (avoiding the false implication that blood pressure cannot be averaged across a cohort).
2. **Fix the mathematical transition in Thought Experiment 1 (lines 37 and 46):**
   - Clearly separate Allele _A_'s multiplicative pre-50 hazard cut (where the $0.1$ factor cancels identically in $\mu'(t)/\mu(t)$ for $t < 50$ and creates a step jump at $t = 50$) from its **smooth Gompertz–Makeham counterpart** ($\mu(t) = c + a e^{bt}$), where lowering additive age-independent Makeham mortality $c$ alone raises the life-table aging rate $\mu'(t)/\mu(t)$ by shrinking the denominator without changing the Gompertz slope $b$. Keep individual hazard and cohort LAR cleanly distinguished in line 46.
3. **Fix the `Codd et al. (2021)` observational-vs-MR smudge (line 53):**
   - Either drop the confounded observational life-expectancy clause or explicitly demarcate it as an observational association (contrasted with Mendelian randomization showing a cancer-vs-vascular/pulmonary trade-off with null/minimal genetic effect on overall lifespan, matching `[[telomeres|Telomeres]]`).
4. **Fix the four bounded factual and bibliographic precision slips:**
   - **Line 52 (`[^baez2019]`):** specify _"tens of thousands of exonic mutations (~2 million genome-wide)"_ rather than bare _"tens of thousands of mutations"_.
   - **Line 53 (`[^barthel2017]`):** specify that the ~5% _ATRX/DAXX_ alterations are among _TERT_-negative tumors.
   - **Line 83 (`[^hall2016]`):** pair with `Hall et al. (2017)` (_Aging_ 9:1867–1884) or phrase precisely so `[^hall2016]` is cited specifically for p16+/SA-β-gal+ macrophage accumulation in aging mice.
   - **Lines 108 & 122 (`## References`):** correct `[^parras2023]` title to _"hepatic and intestinal failure"_ and remove the extraneous _"aged"_ from `[^hernando2019]` (_"...in mouse muscle stem cells"_).
5. **Expand opaque acronyms on first use (lines 53, 80, 83):**
   - Gloss `TCGA` (_The Cancer Genome Atlas_), `SASP` (_senescence-associated secretory phenotype_, or link `[[cellular-senescence|SASP]]`), and `SA-β-gal` (_senescence-associated β-galactosidase_) on first appearance.

---

### Non-Binding Suggestions (Optional Polish)

- Use plain `n = 1–4` in line 25's bold lead item to avoid raw `\dots` rendering in the local Quartz preview.
- In `Biological age / aging clock` (line 79), optionally note post-2020 causality-audit findings (`Ying et al. 2024`) confirming that major chronological, mortality, and pace clocks do not enrich for causal CpGs.
- Optionally trim line 53's 255-word bullet by delegating the detailed TCGA percentages to `[[telomeres|Telomeres]]` and tightening the `Senescence` row's 4th-column cell for faster scanning.

VERDICT: MINOR_REVISION
