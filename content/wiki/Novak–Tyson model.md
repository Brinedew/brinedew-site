---
title: Novak–Tyson model
tags:
  - content/wiki
date: 2026-06-21
draft: true
vital_level: 4
class: C
aliases:
  - Novák–Tyson model
  - Quantitative threshold model of the cell cycle
---
# Novak–Tyson model

The **Novak–Tyson model** is a mathematical and dynamical-systems framework that describes the biochemical control network of the eukaryotic cell cycle—specifically how continuous protein synthesis drives abrupt, irreversible transitions into and out of DNA replication (S-phase) and mitosis (M-phase).[^novaktyson1993] Formulated by Béla Novák and John J. Tyson in 1993 for *Xenopus laevis* egg extracts and embryos (building on Andrew Murray and Marc Kirschner's 1989 demonstration that cyclin synthesis and destruction suffice to drive embryonic cleavage cycles),[^murray1989][^novaktyson1993] the model was subsequently extended to fission yeast (*Schizosaccharomyces pombe*), budding yeast (*Saccharomyces cerevisiae*), and mammalian somatic cells.[^tysonnovak2001]

## Bistability and hysteresis at mitotic entry

At the core of the model is a bistable biochemical switch centered on M-phase promoting factor (MPF), the complex of a B-type cyclin and a cyclin-dependent kinase (CDK1/Cdc2).[^novaktyson1993] Rather than acting as a passive linear ramp that follows cyclin concentration proportionally, MPF is embedded in two reinforcing double-feedback loops:

1. **Positive feedback via Cdc25:** Active MPF phosphorylates and activates the phosphatase Cdc25, which removes inhibitory phosphate groups (Tyr15/Thr14) from CDK1.
2. **Double-negative feedback via Wee1/Myt1:** Active MPF phosphorylates and inhibits the kinase Wee1, preventing Wee1 from re-depositing those inhibitory phosphates on CDK1.

Because MPF both activates its activator and inhibits its inhibitor—coupled through [[Goldbeter–Koshland module|ultrasensitive covalent modification cycles]]—the steady-state activity curve folds into an S-shaped hysteresis loop (a saddle-node bifurcation).[^novaktyson1993][^pomerening2003] A cell in interphase remains locked on the low-activity branch until total cyclin exceeds an upper activation threshold ($\theta_{\text{up}}$), at which point MPF fires regeneratively onto the high-activity mitotic branch. Once on the upper branch, MPF remains active even if cyclin concentration drops moderately, resetting to interphase only when MPF activates the anaphase-promoting complex/cyclosome (APC/C) to degrade cyclin below a much lower inactivation threshold ($\theta_{\text{down}} < \theta_{\text{up}}$).[^tysonnovak2001] This hysteresis separation prevents a dividing cell from slipping backward out of mitosis mid-segregation.

## The quantitative threshold model and minimal single-module tests

A direct prediction of the Novak–Tyson framework is that temporal ordering of the cell cycle does not strictly require separate CDKs for each phase: a **single oscillating cyclin–CDK activity wave**, rising from zero after mitotic exit, can trigger S-phase first and M-phase second if S-phase substrates have a lower phosphorylation threshold than M-phase substrates.[^stern1996]

In 2010, Damien Coudreuse and Paul Nurse tested this prediction in fission yeast (*S. pombe*) by deleting all four mitotic/S-phase cyclins (*cdc13*, *cig1*, *cig2*, *puc1*) and the sole cell-cycle CDK (*cdc2*), replacing them with a **single engineered chimeric protein** fusing the B-type cyclin Cdc13 directly to Cdc2.[^coudreuse2010] This single fusion module drove the entire mitotic cell cycle—and even meiosis—in the correct order: low fusion-protein activity initiated DNA replication, while higher accumulation triggered mitosis.[^coudreuse2010] Similarly, on the kinase side in mammals, David Santamaría and colleagues deleted all four interphase CDKs in mice (*Cdk2*, *Cdk3*, *Cdk4*, *Cdk6*) and showed that **CDK1 alone** can bind interphase and mitotic cyclins, phosphorylate [[rb-rb1|pRb]], and drive organogenesis through mid-gestation (~E13.5–E15.5).[^santamaria2007]

| System / perturbation | Active cell-cycle CDKs | Active cell-cycle cyclins | Outcome and boundary conditions |
| :--- | :--- | :--- | :--- |
| ***Xenopus* early embryo extract**[^murray1989] | CDK1 | Cyclin B synthesis & destruction | Drives rapid S–M cleavage cycles without G1/G2 gap phases |
| ***S. pombe* minimal chimera**[^coudreuse2010] | Single Cdc13–Cdc2 fusion | 1 (fused Cdc13) | Complete, ordered S-phase and M-phase progression via quantitative activity thresholds; still requires APC/C proteolysis and PP2A phosphatase opposition |
| **Wild-type yeasts** (*S. pombe* / *S. cerevisiae*) | 1 core CDK (Cdc2 / Cdc28) + transcriptional CDKs | 4 (*S. pombe*) to 9 (*S. cerevisiae*) cell-cycle cyclins | Hydrophobic-patch substrate docking and phase-specific cyclins couple division to cell size, budding polarity, nutrient sensing, and mating pheromones |
| **Mouse interphase-CDK knockout** (*Cdk2⁻/⁻ Cdk3⁻/⁻ Cdk4⁻/⁻ Cdk6⁻/⁻*)[^santamaria2007] | CDK1 only | Multiple (Cyclins D, E, A, B required) | Fibroblasts cycle and embryos develop to ~E13.5, then die from hematopoietic failure; deleting individual mammalian cyclins (*Ccna2*, *Ccnb1*) remains embryonically lethal |
| **Eumetazoan somatic tissues**[^cao2014] | CDK1, CDK2, **CDK4, CDK6** (+ ~16 transcriptional/neuronal CDKs) | Cyclins D, E, A, B (+ ~20 non-canonical cyclins) | Layered **Cyclin D–CDK4/6–INK4–Rb** G1 restriction switch parks somatic cells in [[Quiescence depth\|G₀ quiescence]] until extrinsic tissue-repair signals grant permission |

Two biochemical constraints qualify the "one cyclin and one CDK" simplification:

1. **The oscillator requires an opposing phosphatase and proteolytic reset:** A single cyclin–CDK pair cannot oscillate alone. Quantitative ordering requires opposing phosphatases (particularly PP2A-B55, which dephosphorylates mitotic substrates and sets the high M-phase threshold), CDK-activating kinase (CAK), and the APC/C ubiquitin ligase to destroy the cyclin at mitotic exit.[^coudreuse2010]
2. **Qualitative substrate docking and the eumetazoan G1 gate:** Multiple cyclins and CDKs did not evolve solely in animals; the Last Eukaryotic Common Ancestor (LECA), unicellular yeasts, and plants (*Arabidopsis thaliana* encodes >49 cyclins) already expanded cyclin families to provide hydrophobic-patch substrate specificity and environmental integration, while most human CDKs (such as CDK7, CDK8, CDK9, CDK12, and CDK13) regulate RNA Polymerase II transcription rather than cell division.[^cao2014] What complex animals (**Eumetazoa**) specifically layered onto the core Novak–Tyson mitotic engine is the **Cyclin D–CDK4/6–[[p16ink4a-cdkn2a|INK4]]–[[rb-rb1|Rb]]** G1 restriction module—shifting the cellular default from nutrient-driven proliferation to somatic [[Quiescence depth|quiescence]] and tumor suppression (see [[Conflict between development and tumor suppression#the-eumetazoan-g1-restriction-gate|Conflict between development and tumor suppression]]).[^cao2014]

## See also

- [[Goldbeter–Koshland module]]
- [[Huang-Ferrell model]]
- [[Hopf bifurcation]]
- [[Bathtub Dynamics]]
- [[Types of cell senescence and quiescence|Senescence and quiescence control loops]]
- [[Quiescence depth]]
- [[Conflict between development and tumor suppression]]
- [[Taxonomy of non mechanistic models in biology|Taxonomy of non-mechanistic and causal models]]

## References

[^novaktyson1993]: Novák B, Tyson JJ (1993). "Numerical analysis of a comprehensive model of M-phase control in *Xenopus* oocyte extracts and intact embryos". *Journal of Cell Science*. 106 (4): 1153–1168. [doi:10.1242/jcs.106.4.1153](https://doi.org/10.1242/jcs.106.4.1153)
[^murray1989]: Murray AW, Kirschner MW (1989). "Cyclin synthesis drives the early embryonic cell cycle". *Nature*. 339 (6222): 275–280. [doi:10.1038/339275a0](https://doi.org/10.1038/339275a0)
[^tysonnovak2001]: Tyson JJ, Novák B (2001). "Regulation of the eukaryotic cell cycle: molecular antagonism, hysteresis, and irreversible transitions". *Journal of Theoretical Biology*. 210 (2): 249–263. [doi:10.1006/jtbi.2001.2293](https://doi.org/10.1006/jtbi.2001.2293)
[^pomerening2003]: Pomerening JR, Sontag ED, Ferrell JE Jr (2003). "Building a cell cycle oscillator: hysteresis and bistability in the activation of Cdc2". *Nature Cell Biology*. 5 (4): 346–351. [doi:10.1038/ncb954](https://doi.org/10.1038/ncb954)
[^stern1996]: Stern B, Nurse P (1996). "A quantitative model for the *cdc2* control of S phase and mitosis in fission yeast". *Trends in Genetics*. 12 (9): 345–350. [doi:10.1016/S0168-9525(96)80016-3](https://doi.org/10.1016/S0168-9525(96)80016-3)
[^coudreuse2010]: Coudreuse D, Nurse P (2010). "Driving the cell cycle with a minimal CDK control network". *Nature*. 468 (7327): 1074–1079. [doi:10.1038/nature09543](https://doi.org/10.1038/nature09543)
[^santamaria2007]: Santamaría D, Barrière C, Cerqueira A, Hunt S, Tardy C, et al. (2007). "Cdk1 is sufficient to drive the mammalian cell cycle". *Nature*. 448 (7155): 811–815. [doi:10.1038/nature06046](https://doi.org/10.1038/nature06046)
[^cao2014]: Cao L, Chen F, Yang X, Xu W, Xie J, Yu L (2014). "Phylogenetic analysis of CDK and cyclin proteins in premetazoan lineages". *BMC Evolutionary Biology*. 14: 10. [doi:10.1186/1471-2148-14-10](https://doi.org/10.1186/1471-2148-14-10)