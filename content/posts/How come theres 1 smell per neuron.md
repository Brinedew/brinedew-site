---
title: How come theres 1 smell per neuron
tags:
  - content/post
date: 2025-12-31
draft: true
---
# How come theres 1 smell per neuron

The “one OR per olfactory sensory neuron” constraint is not enforced by a single magic repressor. It is a control-system design: make “turning any OR on” _slow, rare, and stochastic_, then make “once a functional OR protein exists” trigger a _fast, global stop signal_ that shuts the door behind the winner. Reviews often summarize this as “slow chromatin-mediated activation + fast negative feedback.” ([annualreviews.org](https://www.annualreviews.org/doi/pdf/10.1146/annurev-cellbio-100814-125308 "Monoallelic Expression of Olfactory Receptors | Annual Reviews"))

I’ll build it from the zygote forward, and I’ll be explicit about what each named protein is doing.

Start state from the zygote: why ORs do not accidentally turn on everywhere  
In the zygote and early embryo, chromatin is relatively permissive overall, but differentiation quickly installs lineage-inappropriate silencing. Olfactory receptor genes are a classic case of “cell-fate controlled genes”: in most lineages they are packaged into heterochromatin (repressive, compact chromatin) so the basal transcription probability is ~zero.

(missing: but why isn't the OR lock-in happening in zygote?)

Two mechanistic layers matter here:

1. Repressive marks and binders: H3K9me3 is a canonical heterochromatin histone mark; HP1 proteins bind it and help compact/cluster chromatin. A 2025 paper frames OR choice in exactly those terms: H3K9me3 restricts access of regulatory proteins, and OR clusters converge into specialized nuclear bodies as H3K9me3 and HP1 are incorporated. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/40909544/ "HP1β and H3K9me3 Regulate Olfactory Receptor Choice and Transcriptional Identity - PubMed"))
    
2. Nuclear architecture: in mature OSNs, OR loci are physically condensed into a few foci that include OR genes from multiple chromosomes; this is tied to a broader reorganization where heterochromatin relocates from the nuclear periphery toward the nuclear interior. The lamin B receptor (LBR) is an anchoring factor that normally helps keep heterochromatin at the periphery; its downregulation is associated with the OSN-specific nuclear reorganization and changes in HP1β association and accessibility. ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4882762/ "Monoallelic Expression of Olfactory Receptors - PMC"))
    

Key point for your “zygote chromatin landscape” framing: the zygote does not “decide” which OR to express. The embryo builds a situation where _all_ ORs are strongly off by default in essentially every cell, and then the OSN lineage later evolves a specialized escape hatch that is allowed to succeed exactly once.

The escape hatch: how one allele manages to turn on at all  
If all ORs are entombed in heterochromatin, you need an active process to occasionally let one allele “escape.”

A central player here is LSD1 (also called KDM1A), a flavin-dependent histone demethylase. Biochemically, LSD1 removes methyl groups from specific lysines on histone H3, but the functional outcome depends on its binding partners: in one complex context it supports activation; in another it supports repression.

In OSN development, LSD1 is transiently expressed and is required for initiation of OR transcription; then it must be downregulated to stabilize a single choice. That dual role is stated very directly in the “epigenetic trap” paper: LSD1 is necessary to initiate OR transcription, but its persistence is incompatible with stable maintenance, so it has to be shut down after a productive choice. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/23870122/ "An epigenetic trap stabilizes singular olfactory receptor expression - PubMed"))

So you can think of immature OSNs as being in a temporary “sampling” regime:

- LSD1 present: the genome is still mostly repressed, but there is a low rate of de-repression events.
    
- Any given OR allele has a tiny probability per unit time to become transcriptionally competent.
    

Important nuance: single-cell data increasingly support a transient “multigenic, low-level” phase (several ORs detectable at low expression) followed by elimination to one dominant OR during maturation. A 2025 Nature Communications paper explicitly describes that trajectory and positions a specific repressor (TRIM66) as enabling the transition from polygenic to monogenic expression. ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))

The enhancer topology: why the winner can become strong, and the losers stay weak  
Chromatin de-repression alone does not give you robust, lifelong expression. You need a way to amplify one choice.

This is where the intergenic enhancers (“Greek Islands”) and 3D genome organization come in.

Two core findings from the last decade:

- Many candidate OR enhancers exist with distinctive epigenetic signatures and extensive interchromosomal interactions associated with OR transcription. Disrupting these interactions produces weak and multigenic OR expression, consistent with a “rare coincidence” model: many enhancers converging on one chosen OR allele yields singular, robust transcription. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25417106/ "Enhancer interaction networks as a means for singular olfactory receptor expression - PubMed"))
    
- Hi-C in sorted OSNs shows OR clusters across ~18 chromosomes making specific interchromosomal contacts that increase with differentiation. These contacts are orchestrated by Greek Islands, which form a multi-chromosomal “super-enhancer” hub that associates with the _single_ active OR gene; LHX2 (a homeobox transcription factor) and LDB1 (an adaptor that promotes long-range contacts) regulate assembly/maintenance of these compartments and hubs. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/30626972/ "LHX2- and LDB1-mediated trans interactions regulate olfactory receptor choice - PubMed"))
    

A useful mental model is: “access to the enhancer hub is a limiting resource.” Many OR alleles may flicker toward competence, but the one that successfully engages the hub gets boosted into a stable high-expression state.

The fast feedback: how one OR protein shuts down further choices  
Now the key enforcement step: once _any_ OR protein is produced, the cell needs to detect that and globally prevent additional OR activation.

The elegant trick OSNs use is to repurpose ER stress / unfolded protein response (UPR) signaling as a sensor of “a receptor protein is being made.”

Mechanism, step by step:

1. OR proteins are GPCRs and are difficult to fold/traffic; early in development they tend to accumulate in the ER.
    
2. That activates the PERK branch of the UPR: PERK phosphorylates eIF2α.
    
3. Phospho-eIF2α suppresses global translation but allows selective translation of specific stress-responsive mRNAs, including ATF5.
    
4. ATF5 then drives transcriptional changes, including induction of Adcy3 (adenylyl cyclase 3).  
    This causal chain is stated explicitly in the Cell paper: OR expression induces PERK-mediated eIF2α phosphorylation → selective translation of ATF5 → ATF5 induces Adcy3; Adcy3 then relieves the UPR and makes OR choice permanent. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/24120133/ "Co-opting the unfolded protein response to elicit olfactory receptor feedback - PubMed"))
    

How Adcy3 “locks in” the choice:

- Adcy3 is described as a sensor/transmitter of OR-elicited feedback that mediates downregulation of LSD1, thereby preventing further demethylation/desilencing of additional OR alleles. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/23870122/ "An epigenetic trap stabilizes singular olfactory receptor expression - PubMed"))
    
- A 2025 paper extends this by identifying TRIM66 as an ATF5-linked epigenetic repressor that can bind/assemble/repress OR enhancers and silence extra OR genes; loss of TRIM66 leads to persistent low-level multi-OR expression in mature OSNs (a partial rule violation). ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))
    

So the enforcement logic is:

- LSD1 creates a window where _new_ ORs could in principle be activated.
    
- The first productive OR protein triggers UPR → ATF5 → Adcy3 (and downstream repressors like TRIM66), which shuts that window (by depleting LSD1 and actively silencing “extra” OR activity).
    

Toy model 1: slow stochastic activation + fast feedback  
Imagine 1000 OR alleles in an immature OSN.

- While LSD1 is present, each allele has a tiny probability per hour to become competent: say the cell, in aggregate, experiences ~1 “serious activation attempt” every 5 days (this “slow” timescale is the kind of regime people invoke to make the math work; the TRIM66 paper also discusses slow activation plus rapid feedback as the conceptual requirement). ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))
    
- Once a functional OR is made, feedback shuts down LSD1 within ~1 hour (order-of-magnitude “fast feedback” framing). ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))
    

If activation attempts are a Poisson process with mean one per 5 days, the chance of _another_ activation attempt occurring inside a 1-hour window is roughly:  
(1 attempt / 120 hours) × (1 hour) ≈ 0.0083, i.e. <1%.

That is before adding real biology that reduces effective co-activation:

- Many “attempts” are weak (low transcription without hub engagement).
    
- Some OR proteins fail folding/exit, delaying the “productive” trigger.
    
- Enhancer hub access is likely limiting, so high transcription is winner-take-all rather than additive.
    

Toy model 2: hub competition makes “two strong ORs” hard  
Assume there exists a multi-enhancer hub that can strongly activate only one promoter at a time.

- Allele A and allele B both transiently de-repress at low level.
    
- If allele A contacts the hub first, its transcription increases, its OR protein accumulates faster, and it triggers UPR→ATF5→Adcy3 sooner.
    
- That feedback removes LSD1 and recruits repression (including enhancer repression via TRIM66), pushing allele B back below detection.
    

In this model, “brief coexpression” is not paradoxical: you can get multiple low-level transcripts transiently, but the system is designed so that only one becomes stably high and self-protecting. ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))

Explaining counterfactuals you should be worried about

1. “Why doesn’t the cell just express two ORs and get broader sensing?”  
    Because OR identity is not only about ligand binding. OR choice is coupled to neuronal identity and wiring: the single OR helps specify axonal targeting patterns in the olfactory bulb, so multiple stable ORs would scramble the mapping (you would effectively create neurons with ambiguous projection rules). This coupling is part of why feedback is so aggressively exclusivist in the first place. ([annualreviews.org](https://www.annualreviews.org/doi/pdf/10.1146/annurev-cellbio-100814-125308 "Monoallelic Expression of Olfactory Receptors | Annual Reviews"))
    
2. “What if the first chosen OR is a pseudogene or a ‘bad’ OR?”  
    Then the feedback may fail to “complete,” and the cell remains unstable and continues sampling/switching (or dies). A very direct piece of evidence comes from the RTP1/2 story: developing OSNs show unstable OR expression until they choose an OR that exits the ER or undergo cell death, linking protein trafficking success to stabilizing gene choice. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/28262096/ "Olfactory receptor accessory proteins play crucial roles in receptor function and gene choice - PubMed"))  
    This fits neatly with the UPR-based sensor: if the receptor never reaches the right trafficking/signaling state, you do not get a clean ATF5→Adcy3 “resolution,” and the trap does not lock.
    
3. “What prevents the other allele of the same OR gene from turning on later?”  
    The feedback is not allele-specific; it is nucleus-wide. Once LSD1 is depleted and enhancer repression ramps up, the probability that the second allele escapes goes way down. The monoallelic outcome then follows from timing + global shutdown: only one allele gets to be “first past the post.”
    
4. “If OR clusters are heterochromatic in other nearby cell types, why don’t those cells also show OR foci and weird leakage?”  
    Because heterochromatin marks are not the full story; OSNs undergo a distinctive nuclear reorganization and trans-enhancer networking. The Monahan & Lomvardas review points out that sustentacular cells can carry constitutive heterochromatin marks on OR genes yet lack the OR-specific trans interaction network and foci behavior seen in OSNs. ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4882762/ "Monoallelic Expression of Olfactory Receptors - PMC"))
    

What is still genuinely not fully settled  
There are multiple partially compatible models for the “singularity” bottleneck:

- “Rare enhancer coincidence” / hub assembly as the limiting event. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25417106/ "Enhancer interaction networks as a means for singular olfactory receptor expression - PubMed"))
    
- “Epigenetic trap” dominated by LSD1 timing plus fast feedback. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/23870122/ "An epigenetic trap stabilizes singular olfactory receptor expression - PubMed"))
    
- “Active repression of extras” during the polygenic→monogenic transition (TRIM66 is one proposed missing link). ([Nature](https://www.nature.com/articles/s41467-025-66051-w "An epigenetic repressor TRIM66 dictates monogenic olfactory receptor expression, neural activity, and olfactory behavior | Nature Communications"))
    

They are not mutually exclusive; in control-systems terms, biology often uses redundant constraints because the cost of violating “one receptor per neuron” is high.

Leftover task: rewrite this as an explicit state machine with 1000 gene states (zygote → OSN progenitor → immature OSN sampling → productive OR → locked mature OSN) with the exact transitions labeled by “LSD1 high/low,” “hub engaged/disengaged,” “PERK on/off,” “ATF5 translated/not,” and “TRIM66 engaged/not.” That format tends to make the counterfactuals mechanically obvious.

Citations:
1.
2.
3.