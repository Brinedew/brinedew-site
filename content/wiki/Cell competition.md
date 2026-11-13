---
title: Cell competition
tags:
  - content/wiki
date: 2026-11-13
draft: true
vital_level: 2
class: C
aliases:
  - cell competition
  - Cellular competition
  - supercompetition
---
# Cell competition

**Cell competition** is a cell-non-autonomous quality-control mechanism in multicellular tissues whereby neighboring cells compare relative metabolic and proliferative fitness at cell–cell boundaries, triggering apoptosis and extrusion of suboptimal ("loser") cells in favor of fitter ("winner") cells. First observed in *Drosophila melanogaster* by Ginés Morata and Pedro Ripoll (1975) in mosaic *Minute* wings, it eliminates slow-growing or damaged cells that would otherwise be viable in isolation—tempering strict somatic [[de-darwinization]] while creating an attack surface that pre-malignant **supercompetitors** can hijack to kill surrounding normal cells.

## Distributed fitness sensing and execution

A multicellular tissue cannot rely on a central arbiter to score individual cells; instead it runs a local comparison algorithm across three steps:

1. **Fitness broadcasting:** Cells scale levels of metabolic master regulators—especially **[[myc|MYC]]** (*dMyc* in *Drosophila*)—and isoform markers such as **[[flower-drosophila|Flower]]** (*Flower^Win* vs. *Flower^Lose*) with translational and metabolic capacity.
2. **Comparative assessment:** Neighboring cells compare relative fitness across cell–cell junctions. Cells with lower *dMyc* or *Minute*/*Rp* ribosomal deficiencies are registered as relative losers when juxtaposed against fitter neighbors.
3. **Winner survival vs. loser death:** All competitors experience metabolic/stress signaling (such as **JNK** pathway activation), but winners protect themselves while losers undergo [[apoptosis]] and engulfment.

## The *Drosophila* mechanism vs. mammalian pathways

In *Drosophila* wing imaginal discs, competition operates along a well-mapped axis:

- **Fitness detection:** High-*dMyc* cells sense lower-*dMyc* neighbors via elevated ribosome biogenesis, protein synthesis, and [[flower-drosophila|Flower]] isoform display.
- **JNK vs. Puckered balance:** Competitive stress activates JNK in losers, inducing pro-apoptotic *hid*, which neutralizes DIAP1 and activates caspases. High-*dMyc* winners survive their own hyper-metabolic stress by upregulating **puckered**, a dual-specificity phosphatase that dephosphorylates and blocks JNK.
- **Corpse clearance:** Winners engulf apoptotic loser debris via macrophage-like phagocytosis and expand into the vacated space.

| Feature | Winners | Losers |
| :--- | :--- | :--- |
| **MYC / dMyc level** | High | Low |
| **JNK repressor (*puckered*)** | High — blocks death signals | Low — death signals active |
| **JNK pathway** | Blocked | Active (`JNK → hid → DIAP1 block → apoptosis`) |
| **Fate** | Survive and eliminate neighbors | Extruded and phagocytosed |

In mammals, single *puckered* is replaced by multiple DUSP phosphatases (such as DUSP1/MKP-1 and DUSP6/MKP-3), and competitive elimination blends JNK stress signaling with **BIM**-mediated mitochondrial apoptosis alongside [[Anti-frontrunner dynamics#1-epithelial-defense-against-cancer-edac|EDAC]] (apical extrusion of Ras/Src-transformed cells by wild-type epithelial neighbors).

## How malignant cells hijack cell competition

Normally, cell competition purges defective cells and suppresses nascent neoplasia. Cancer breaks this homeostatic balance along two distinct evolutionary trajectories:

1. **Super-competitor transformants:** Hyperactivation of **dMyc / MYC**, STAT, or **Yorkie ([[yap-yap1|YAP]]/[[taz-wwtr1|TAZ]])** turns a nascent clone into a supercompetitor that drives apoptosis in surrounding wild-type tissue (even at a distance of several cell diameters in *Drosophila*), passively inheriting niche space as neighbors die. To survive its own oncogene-induced metabolic stress, a supercompetitor upregulates JNK phosphatases and anti-apoptotic inhibitors (DIAP1 in flies; [[bcl-2|BCL-2]] / [[mcl-1|MCL-1]] / [[xiap-p98170|XIAP]] in mammals).
2. **Resistant losers:** Loss of apicobasal polarity tumor suppressors (*scrib*, *lgl*, *dlg*) normally tags cells as losers marked for JNK-mediated extrusion. Additional lesions—such as activated *Ras* or direct blocks on JNK/*hid*—grant competitive immunity, converting a former loser into a tumorous clone that refuses to die.

### Drosophila cell competition states

| Feature | Normal winners | Super-competitors | Normal losers | Transformed losers |
| :--- | :--- | :--- | :--- | :--- |
| **Genotype examples** | Wild-type vs. *Minute/+* | *dMyc*, STAT, or Yorkie activation | *Minute/+*; wild-type vs. super-competitors | *scrib⁻*, *lgl⁻*, *dlg⁻* mutants (context-dependent) |
| **MYC / dMyc level** | Normal | Very high | Low / normal | Variable |
| **Core driver** | Relative fitness excess | Oncogene hyperactivation | Ribosomal deficiency; reduced translation | Polarity loss; endocytic defects (*rab5*, *vps25*, *TSG101*) |
| **Killing range** | Contact-dependent (adjacent cells) | Extended distance (up to 8–10 cell diameters) | None | Variable |
| **Apoptosis pathway** | *Puckered* blocks JNK | Blocks own death; induces non-autonomous *hid* | `JNK → hid → apoptosis` | Context-dependent rescue flips loser to tumor |

## Evolutionary significance

Cell competition illustrates the ambivalence of [[multicellular-cooperation|multicellular policing]]: the same comparative mechanism that clears damaged, slow-cycling cells during development and homeostasis can, once co-opted by a fitter oncogene clone, cull healthy wild-type neighbors—and conversely, in aged or inflamed stroma where background tissue fitness drops ([[adaptive-oncogenesis]]), mutant clones face weakened collective resistance.

## Related

- [[flower-drosophila|Flower (Drosophila)]] — the *Lose*/*Win* transmembrane isoform code
- [[Anti-frontrunner dynamics]] — EDAC, clonal interference, and collective suppression of outgrowing clones
- [[adaptive-oncogenesis]] — how aging tissue environments flip selective winners
- [[oncogene-classification]] — broader catalog of host-coordination evasion mechanisms
- [[de-darwinization]] — suppression of intra-organismal cell-level selection
