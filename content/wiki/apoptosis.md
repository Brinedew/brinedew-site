---
title: Apoptosis
tags:
- content/wiki
date: 2026-08-26
draft: true
vital_level: 2
class: C
aliases:
- programmed cell death
---
# Apoptosis

Apoptosis is a regulated, non-inflammatory form of programmed cell death in which a cell dismantles itself through ordered biochemical steps: cell shrinkage, chromatin condensation, DNA fragmentation, membrane blebbing, and packaging into membrane-bound apoptotic bodies cleared cleanly by phagocytes.

## Two entry pathways, one executioner cascade

Both apoptosis routes convert stress or death-receptor cues into proteolysis by **initiator caspases** (caspase-8, caspase-10, and caspase-9), which cleave and activate downstream **executioner caspases** ([caspase-3](caspase-3-casp3-p42574.md) and caspase-7):

- **Intrinsic (mitochondrial) pathway.** Intracellular stress — irreparable DNA damage, oncogene hyperactivation, hypoxia, or growth-factor withdrawal — shifts the **BCL-2 family arithmetic** at the mitochondrial outer membrane toward pore formation (MOMP), releasing cytochrome *c* into the cytosol. Cytochrome *c* binds [APAF1](apaf1.md) to assemble the heptameric **apoptosome**, activating initiator **caspase-9**, which in turn cleaves **caspase-3** and **caspase-7**.
- **Extrinsic (death receptor) pathway.** Immune or neighboring ligands such as FASL or [TNF](tnf-tnf-p01375.md) cluster transmembrane death receptors (such as [FAS](fas-cd95-p25445.md) or TNFR1) on the target cell, assembling the death-inducing signaling complex (DISC) to activate initiator **caspase-8** (and **caspase-10**). In "Type I" cells, active caspase-8 directly activates executioner **caspase-3**; in "Type II" cells, caspase-8 amplifies the death signal by cleaving BID to tBID, engaging the mitochondrial pathway.

## BCL-2 family arithmetic

Cell commitment along the intrinsic pathway is governed by stoichiometric titration across three functional protein sub-classes sharing BCL-2 homology (BH) motifs:

1. **Anti-apoptotic guardians ([BCL-2](bcl-2.md), [BCL-XL](bcl-xl-bcl2l1.md), [MCL-1](mcl-1.md)).** Anchored on mitochondria, they maintain viability by binding and sequestering both pore-forming executioners and pro-apoptotic activators.
2. **BH3-only activators (BIM, PUMA, tBID).** Directly bind and induce conformational activation of **BAX** and **BAK**.
3. **BH3-only sensitizers (BAD, BMF, NOXA).** Lack direct BAX/BAK-activating ability; instead, they occupy the hydrophobic binding groove of BCL-2/BCL-XL/MCL-1, displacing sequestered activators or freeing BAX/BAK directly.
4. **Pore-forming effectors ([BAX](bax.md) and [BAK](bak-bak1.md)).** Once freed and activated, BAX and BAK oligomerize inside the outer mitochondrial membrane to execute MOMP.

Because [XIAP](xiap-p98170.md) continuously restrains active caspases until neutralized by released mitochondrial Smac/DIABLO or cleaved past threshold, apoptosis exhibits an all-or-nothing bistable snap once MOMP passes the commitment point.

## Apoptosis vs. necrosis vs. necroptosis

Programmed cell suicide is not uniform, and tumors frequently evolve resistance specifically by disconnecting one limb of the death switch:

| Death mode | Biochemical trigger | Membrane fate | Tissue consequence |
| --- | --- | --- | --- |
| **Apoptosis** | Initiator/executioner caspases (8/9 -> 3/7) | Blebbing into intact vesicles; externalized phosphatidylserine | Non-inflammatory; silently phagocytosed |
| **Necrosis** | Acute trauma, bioenergetic collapse, overwhelming ischemia | Unregulated osmotic swelling and rupture | Pro-inflammatory spilling of intracellular DAMPs |
| **Necroptosis** | Death receptors (e.g., TNFR1) *with caspase-8 absent or inhibited* | **RIPK1–RIPK3** necrosome phosphorylates **MLKL**, forming plasma-membrane pores | Regulated, programmed lytic burst triggering innate inflammation |

Importantly, **caspase-8** acts as a molecular brake between apoptosis and necroptosis: active caspase-8 cleaves and inactivates RIPK1 and RIPK3 to enforce immunologically silent apoptosis. When pathogens or cancer clones block caspase-8 to dodge apoptosis, death-receptor engagement flips the switch into inflammatory **RIPK1–RIPK3–MLKL** necroptosis instead—acting as a backup anti-defector alarm.

## Role in tumor suppression and aging

Apoptosis is a front-line tumor-suppressive barrier: [p53](p53-tp53.md) transcriptionally induces PUMA and NOXA in response to irreparable damage or oncogenic conflict, eliminating nascent mutant lineages before clone expansion ([multicellular cooperation](multicellular-cooperation.md)). In aging tissues and in oncogenesis, escaping apoptosis (by upregulating BCL-2, mutating *TP53*, or dampening MOMP sensitivity) converts would-be eliminated supercompetitor cells into persisting clones or into apoptosis-resistant [senescent cells](cellular-senescence.md).
