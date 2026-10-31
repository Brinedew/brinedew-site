---
title: Terminal selectors
tags:
- content/wiki
date: 2026-10-31
draft: true
aliases:
- 
---
# Terminal selectors

In developmental and stem cell biology, **terminal selectors** (lineage-determining master transcription factors, such as MyoD in muscle, HNF4α in hepatocytes, Pax5 in B-cells, or CHE-1/unc-86 in neurons) lock in cell identity. They do this by establishing **positive autoregulatory and reciprocal feedback loops** at cell-type-specific super-enhancers. These loops produce **bistable switches** (with stable "ON" and "OFF" states) that insulate differentiated cells from spontaneous dedifferentiation.

Yet, ectopic expression of the four **Yamanaka factors** (Oct4, Sox2, Klf4, and c-Myc; **OSKM**) can universally extinguish these disparate positive feedback loops across virtually any differentiated somatic lineage. 

Because OSKM do not contain individual repressors specific to each cell lineage, they break these loops using **shared dynamical, biochemical, and epigenetic mechanisms**:

---

### 1. Dynamical Systems Mechanism: Collapsing the Bistable "Tipping Point"
In gene regulatory networks, positive feedback loops maintain a bistable state only if the master regulator's concentration and active transcription rate remain strictly above a critical **auto-activation threshold** ($T_{\text{crit}}$). 
* A cell does not require 100% direct repression of its terminal selector to lose its identity.
* If the transcription rate of the selector is dampened even moderately—or if the existing protein is diluted/degraded—its concentration drops below $T_{\text{crit}}$.
* Once below this threshold, the mathematical stability of the positive feedback loop fails, and the regulatory circuit **spontaneously collapses to the "OFF" state** without requiring targeted transcriptional silencing of every downstream effector gene.

---

### 2. Pioneer Intrusion and Enhancer Decommissioning
Oct4, Sox2, and Klf4 are **pioneer transcription factors** that can bind dense, nucleosomal heterochromatin:
* **Promiscuous enhancer binding:** Overexpressed at non-physiological levels, OSKM invade not only pluripotency targets, but also active somatic enhancers and super-enhancers that sustain terminal selector transcription.
* **Steric disruption of "Enhanceosomes":** Terminal selector autoactivation requires highly cooperative multiprotein assemblies (enhanceosomes) on chromatin. Pioneer binding of OSKM to adjacent or overlapping DNA motifs disrupts the precise stereochemical alignment between terminal selectors, their cofactors, and basal transcription machinery.
* **Displacement of universal somatic gatekeepers (The AP-1 Complex):** Chromatin accessibility across diverse somatic tissues is held open by generic structural partners—most notably the **AP-1 complex (c-Jun/c-Fos)** and **RUNX** factors. OSKM systematically displace AP-1 from somatic regulatory elements, triggering rapid closure of open chromatin at somatic enhancers.

---

### 3. Cofactor Squelching / Resource Competition ("Cofactor Stealing")
Active somatic super-enhancers driving terminal selector loops depend on massive local concentrations of shared, rate-limiting transcriptional co-activators:
* **The Mediator complex (e.g., MED1)**
* **Histone acetyltransferases (p300/CBP)**
* **Chromatin remodelers (SWI/SNF / BAF complexes)**
* **Positive transcription elongation factors (P-TEFb)**

High levels of ectopic OSKM act as massive molecular "sinks," sequestering (squelching) these cofactors away from somatic super-enhancers and redistributing them to newly engaged pluripotency loci. Deprived of p300/CBP and Mediator, somatic super-enhancers undergo an immediate transcriptional crash, causing terminal selector synthesis to plummet.

---

### 4. Active Recruitment of Epigenetic Corepressors
Yamanaka factors do not function exclusively as activators; they actively interact with and recruit corepressor and chromatin-remodeling complexes to somatic loci:
* **NuRD Complex (MBD3/NuRD):** Oct4 and Klf4 interact directly with the NuRD complex, recruiting histone deacetylases (HDAC1/2). This drives rapid deacetylation of histone H3 lysine 27 (**loss of H3K27ac**) at somatic enhancers, switching them off.
* **Polycomb Repressive Complexes (PRC1/PRC2):** OSKM recruit Polycomb complexes to terminal selector promoters, depositing repressive **H3K27me3** marks.
* **Heterochromatinization & DNA Methylation:** Active marks like H3K4me2/me3 are stripped, followed by recruitment of H3K9 methyltransferases (SETDB1, SUV39H1) and DNA methyltransferases (DNMT1/3A/3B), structurally compacting the terminal selector locus into constitutive heterochromatin and making the loss of identity permanent.

---

### 5. Cell Cycle Acceleration and Protein Dilution ("The Myc Effect")
Many differentiated cells are post-mitotic (e.g., neurons) or slow-cycling (e.g., fibroblasts, hepatocytes). Because terminal selector proteins can be relatively stable, their levels persist in non-dividing cells:
* **c-Myc** (acting alongside Klf4) aggressively accelerates the cell cycle by repressing CDK inhibitors ($p21^{\text{CIP1}}$, $p16^{\text{INK4a}}$) and activating cyclins/CDKs.
* When forced into rapid, symmetric cell divisions while new transcription is inhibited (due to squelching and displacement), existing terminal selector proteins and active histone marks are **diluted by ~50% per cell division**.
* Rapid dilution quickly drops terminal selector concentrations below the critical threshold required to reignite positive autoregulation.

---

### 6. Dismantling Reinforcing Extrinsic Signaling & miRNA Cascades
Terminal selector feedback loops in tissue contexts are often reinforced by autocrine/paracrine signaling loops (e.g., autocrine TGF-β/BMP, Wnt, or FGF loops):
* Yamanaka factors actively silence these paracrine signaling pathways (e.g., Klf4 and Sox2 antagonize TGF-β/Snail signaling to drive a mesenchymal-to-epithelial transition, or MET).
* OSKM strongly upregulate embryonic **microRNA clusters** (such as **miR-302/367** and **miR-290–295**), which bind to and accelerate the degradation of diverse somatic transcription factor mRNAs and their supporting signaling receptors.

---

### 7. Assembly of the Dominant Pluripotent Attractor
In developmental dynamics, a cell fate change is an attractor transition. As the somatic attractor is destabilized, OSKM establish the embryonic core regulatory network composed of **Oct4, Sox2, and Nanog**.
* This network forms its own self-reinforcing, tripartite positive feedback loop.
* Once the endogenous Oct4-Sox2-Nanog loop is activated, it acts as a deep potential well (the ground state of pluripotency), reinforcing global repression of lineage-specific terminal selectors across the genome via bivalent chromatin domains and Polycomb-mediated silencing.