---
title: IMR90 ER RAS model
tags:
  - content/wiki
date: 2026-07-18
draft: false
aliases:
  -
---
# IMR90 ER:RAS model

**IMR90 ER:RAS** is the cell culture model of oncogene-induced senescence (OIS). This system is based on non-immortalized, primary **IMR90 human fetal lung fibroblasts** that were made to express conditional oncogenic construct ER:RAS. The oncogene is inactive until triggered by the researcher upon the start of the experiment.

![[image-54.png|Principle of the experiment: addition of 4OHT to the culture medium triggers senescence in model cells. From McHugh et al., 2023.]]
### Setup
The baseline IMR90 cells are transduced with a chimeric fusion oncogene construct called ER:RAS. It consists of the **HRASG12V** oncogene fused to the ligand-binding domain of a mutant **estrogen receptor (ER)**.

There are 2 states in this model:
1. **Inducer absent, oncogene inactive:** The ER:RAS protein is normally bound by heat shock proteins (HSPs) and kept inactive in the cytoplasm.
2. **Inducer present, oncogene active:** Adding the inducer **4-hydroxy-tamoxifen (4-OHT)** to the culture medium triggers a conformational change in the estrogen receptor, displacing HSPs and activating robust RAS signaling.

![[image-52.png|Left: control IMR90 cells. Right: IMR90 cells displaying oncogene induced senescence. From McHugh et al., 2023.]]

Once 4-OHT is added, the transduced IMR90 cells demonstrate classic senescence markers: 
- **Irreversible G1 Growth Arrest**: Mediated through the synchronous activation of the **p53-p21** and **p16INK4a-RB** tumor suppressor pathways.
- **Morphological Changes**: Cells flatten, become enlarged, and exhibit a distinct, vacuolated cytoplasm.
- **Metabolic Changes**: Increased lysosomal activity detectable via positive **Senescence-Associated β-Galactosidase (SA-β-gal)** staining at pH 6.0.
- **SASP Activation**: Robust production of the **Senescence-Associated Secretory Phenotype**, including pro-inflammatory cytokines like IL-6 and IL-8.
- **Nuclear Changes**: Formation of **Senescence-Associated Heterochromatin Foci (SAHF)** and persistent DNA damage response (DDR) activation.
### Rationale
Primary human fibroblasts do not undergo spontaneous transformation easily and have an intact tumor-suppressor barrier. The system provides: 
- **Synchronicity**: Unlike replicative senescence (which takes months and happens asynchronously), the IMR90 ER:RAS system forces an entire cell population into a coordinated senescent state within 6 to 7 days.
- **Experimental Control**: Uninduced cells (treated with vehicle control) serve as an identical, actively proliferating baseline, minimizing genetic background discrepancies.