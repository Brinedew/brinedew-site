# what i was working on - January 24, 2025

User wanted to finish the One-Hit Cancer article by copying the remaining wiki sections verbatim into the PDAC example and fix the broken 4-hit ccRCC section that had wrong hit counting.

## what actually works now

**Fixed the One-Hit Cancer article structure:**
- Added a proper 4-hit example using Malignant Pleural Mesothelioma instead of the broken ccRCC
- Copied all 4 requested wiki sections verbatim into the PDAC 5-hit example
- Used sections that weren't already covered in other cancer examples

**Wiki sections now integrated into PDAC:**
- Section 2 (cell cycle checkpoint evasion) - copied into Hit 2-3: CDKN2A loss
- Section 4 (replicative senescence evasion) - copied before Hit 1: KRAS activation  
- Section 5 (apoptosis evasion) - copied into Hit 4: TP53 dominant-negative
- Section 9 (invasion and metastasis) - copied into Hit 5: SMAD4 loss

**New 4-hit Mesothelioma example covers unused wiki sections:**
- Section 3 (contact inhibition evasion) - NF2/Hippo pathway
- Section 8 (angiogenesis induction) - YAP/TAZ → VEGF
- Section 11 (epigenetic reprogramming) - BAP1 chromatin control
- Section 10 (genomic instability) - BAP1 DNA repair

Files changed:
- `/mnt/d/Coding/Website/docs/posts/One-Hit-Cancer.md` - massive expansion of PDAC section (lines 65-292), replaced ccRCC with mesothelioma section (lines 380-433)

## what's broken

**ccRCC section removed but still mentioned:** I removed the ccRCC 4-hit section because research showed it's actually 2-3 hits (VHL biallelic + 14q deletion), not 4. The article flow works fine without it, but there might be references to "4-hit ccRCC" elsewhere that need cleaning up.

**Hit counting verification incomplete:** I started checking whether VHL loss in ccRCC should count as 1 or 2 hits based on papers, found it's definitely 2 hits (3p deletion + point mutation), but didn't finish reviewing all the other examples for similar errors.

## where things stand

**Article now has coherent progression:**
- 1-hit: ASPS (transcriptional master switch)
- 2-hit: Burkitt lymphoma (MYC + cell cycle brakes)
- 3-hit: Retinoblastoma 
- 4-hit: Mesothelioma (NF2 + BAP1 biallelic losses)
- 5-hit: PDAC (comprehensive wiki integration)

**The PDAC section is now pedagogically complete** - it has all the detailed wiki explanations LessWrong readers need, covering growth control, cell cycle checkpoints, immortality, apoptosis resistance, and metastasis with full molecular mechanisms.

**Mesothelioma section is scientifically accurate** - research shows BAP1+NF2 double knockouts produce mesothelioma in ~20% of mice, supporting the 4-hit model (2 hits each for biallelic tumor suppressor losses).

## what to do next

**Priority 1: Finish hit counting verification** - Go through the remaining cancer examples (Burkitt, Retinoblastoma, AML) and verify that the hit counting follows epidemiological principles. Make sure biallelic tumor suppressor losses are counted as 2 hits when they require 2 independent events, and 1 hit when they can happen through single events like dominant-negative mutations.

**Priority 2: Test the article flow** - The massive wiki integration might have made some sections too dense. Consider using the gemini analysis template from CLAUDE.md to check if the progression still builds logically or if some sections need streamlining.

**Priority 3: Check for orphaned references** - Search for any mentions of ccRCC or "clear cell" that might need updating since that section was removed.

## stuff to remember

**User preferred verbatim copying**: They explicitly wanted exact copy-paste from wiki sections, not editing or summarizing. The approach worked well - the detailed explanations provide the foundation LessWrong readers need.

**Hit counting is strict epidemiological definition**: A "hit" must be an independent stochastic event with constant probability over time. Biallelic tumor suppressor loss ≠ automatically 2 hits - depends on whether it requires 2 independent events or can happen as single event (like large deletions).

**Mesothelioma tissue vulnerability**: The key insight is that mesothelial cells' primary defense is contact inhibition (they form thin barrier sheets), making NF2/Hippo pathway loss immediately devastating. This demonstrates how tissue-specific vulnerabilities reduce required hit count.

**Wiki section coverage strategy worked**: By mapping which sections were already used vs unused, we created a logical progression that covers all the major defense mechanisms across different cancer examples without redundancy.