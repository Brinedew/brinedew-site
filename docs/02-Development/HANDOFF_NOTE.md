# what i was working on - January 22, 2025

User wanted me to reorganize the oncogene classification wiki page into a progression from 1-hit to 5-hit cancers, showing how different tissues need different numbers of mutations because they have different defense architectures. The old format was just a grab-bag of mechanisms that Alex (the fictional harsh reviewer) ripped apart for being poorly organized.

## what actually works now

Completely rewrote `/mnt/d/Coding/Website/docs/posts/One-Hit-Cancer.md` with a clear progression:

**5-Hit Cancer: Pancreatic Ductal Adenocarcinoma (PDAC)**
- Hit 1: KRAS (growth signal independence) 
- Hit 2: CDKN2A loss (cell cycle checkpoints)
- Hit 3: TP53 disruption (DNA damage detection)
- Hit 4: SMAD4 inactivation (TGF-β resistance) 
- Hit 5: TERT activation (telomere maintenance)

**4-Hit Cancer: Clear Cell Renal Carcinoma (ccRCC)**
- Hit 1: VHL loss (oxygen sensing disruption)
- Hit 2: HIF2α stabilization (angiogenesis induction)  
- Hit 3: Metabolic enzyme dysregulation (lipid accumulation)
- Hit 4: 14q chromosomal deletion (tumor suppressor loss)

**3-Hit Cancer: Acute Myeloid Leukemia (AML)**
- Hit 1: DNMT3A mutation (epigenetic reprogramming)
- Hit 2: NPM1 insertion (nucleolar disruption)
- Hit 3: FLT3-ITD (growth signal independence)

**2-Hit Cancer: Retinoblastoma**
- Hit 1: First RB1 allele loss (partial brake failure)
- Hit 2: Second RB1 allele loss (complete brake failure)

**1-Hit Cancer: Chromothripsis Events**
- Hit 1: Chromosome shattering (simultaneous TP53 + oncogene changes)

Fixed the major problems Alex complained about:
- Line 5-9: Replaced overwrought TED-talk intro with direct explanation
- Moved framework explanation to the top instead of burying it
- Fixed the species mixing problem in lines 249-307 (was mixing mammalian and Drosophila mechanisms)
- Replaced concept → example structure throughout instead of just listing acronyms
- Each cancer uses completely different biological mechanisms (no overlap)

## what's broken

Still need to find a proper 3-hit cancer that doesn't reuse mechanisms from other vignettes. Current AML still uses growth signal independence (FLT3-ITD) which duplicates mechanism from PDAC (KRAS) and the metabolic mechanism from DNMT3A overlaps conceptually with ccRCC metabolic changes.

The 3-hit cancer needs to use three completely different mechanisms:
- Not growth factor receptors (already used KRAS, BRAF, FLT3-ITD)  
- Not cell cycle checkpoints (already used TP53, RB1, CDKN2A)
- Not TGF-β pathway (already used SMAD4, TGFBR2)
- Not immune evasion, DNA repair, telomeres, or chromatin

Research showed follicular lymphoma, splicing-factor MDS, and other options all eventually use TP53 or similar mechanisms we've already covered.

## where things stand

File `/mnt/d/Coding/Website/docs/posts/One-Hit-Cancer.md` is ready except for the 3-hit section. The document flows logically from complex (5-hit epithelial) to simple (1-hit catastrophic), with each section explaining WHY that tissue needs that many hits based on its coordination architecture.

The original wiki file `/mnt/d/Coding/Website/docs/wiki/proteins/oncogenes/oncogene-classification.md` has been improved:
- Fixed mammalian/Drosophila species confusion in cell competition section  
- Removed corporate speak throughout
- Enhanced intro with historical discovery context

## what to do next

Find a 3-hit cancer that uses three genuinely different mechanisms. Need to search more specifically for cancers that avoid all the pathways we've already used. Possible directions:
- Protein folding/ER stress pathways
- Calcium signaling disruption
- Cytoskeletal/mechanical force sensing
- circadian rhythm disruption
- Alternative splicing machinery (beyond what we covered in MDS)

Check papers on rare sarcomas, specific leukemia subtypes, or brain tumors - they might have unique pathway combinations.

Alternative: restructure to skip 3-hit entirely and go directly from 4-hit to 2-hit. The key insight about tissue architecture determining required hits still works.

## stuff to remember

Alex's review approach worked really well - he wanted mechanistic explanations that build understanding before introducing jargon, not just lists of protein names. The concept → example structure (explain what growth factor receptors DO, then mention EGFR/HER2) was much more effective than acronym soup.

The historical context about 6-7 hits from 1950s epidemiology was crucial for the intro - shows this isn't just made-up categorization but reflects real patterns discovered mathematically before we could sequence cancer genomes.

The clear cell renal carcinoma (ccRCC) example works perfectly as 4-hit because it uses the VHL/HIF oxygen-sensing pathway which is completely orthogonal to all the other mechanisms. This demonstrates how different tissues can have fundamentally different vulnerabilities.

The "Why don't previous mechanisms stop this?" questions between sections are key - they force explanation of why blood cells bypass epithelial controls, why retinal cells bypass blood cell controls, etc.