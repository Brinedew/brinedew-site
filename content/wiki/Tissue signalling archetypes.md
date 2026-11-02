---
title: Tissue signalling archetypes
tags:
- content/wiki
date: 2026-11-02
draft: true
aliases:
- 
---
# Tissue signalling archetypes

The six proteins—**IL6, CXCL8 (IL-8), MMP3, SERPINE1 (PAI-1), CCL2 (MCP-1), and TGFB1**—form a core signaling constellation at the intersection of **cellular senescence (SASP)**, **fibroblast functional divergence (iCAF vs. myCAF)**, **extracellular matrix (ECM) remodeling**, and **myeloid-skewed immune exclusion**. 

---

### 1. Functional Axes & Regulatory Modules

These six factors fall into two primary regulatory circuits that often operate in reciprocal, antagonistic, or sequentially phased modes:

| Axis | Factors | Primary Driver / Signaling Hub | Biological Function |
| :--- | :--- | :--- | :--- |
| **Inflammatory / Chemotactic Axis** | **IL6, CXCL8, CCL2** | NF-κB, C/EBPβ, AP-1 | Myeloid chemotaxis, acute-phase activation, neutrophil recruitment, systemic inflammation. |
| **Fibrogenic / Matrisome Axis** | **TGFB1, SERPINE1, MMP3** | TGF-β/SMAD2/3, p53 | Matrix deposition, protease balance, EMT/EndMT, tissue tension, senescence induction. |

---

### 2. Deconstructing Key Combinations (Combinatorics & Semantics)

Rather than evaluating all $2^6 = 64$ mathematical subsets, the combinations resolve into distinct biological archetypes:

```
                      [TGFB1 / SERPINE1]
                       (SMAD/p53 - Matrix)
                               ▲
                               │
            Fibrotic Arrest    │    Chronic Wound /
            / myCAF State      │    Exhausted TME / "Full SASP"
                               │
  ─────────────────────────────┼─────────────────────────────► [IL6 / CXCL8 / CCL2]
                               │                                (NF-κB - Inflammatory)
             Baseline /        │    Acute Inflammatory
             Quiescent Stroma  │    / iCAF State
                               │
                      [MMP3 Proteolysis]
```

---

#### Archetype 1: The Pure Inflammatory Niche (NF-κB High, SMAD Low)
* **Combination:** $\text{IL6}^\text{high} + \text{CXCL8}^\text{high} + \text{CCL2}^\text{high} \quad [\text{TGFB1}^\text{low}, \text{SERPINE1}^\text{low}]$
* **Cell State Semantics:**
  * **Fibroblasts:** Inflammatory Cancer-Associated Fibroblast (**iCAF**) or acute inflammatory tissue fibroblast.
  * **Epithelium:** Regenerative or stressed secretory epithelium without permanent arrest.
  * **Endothelium:** Activated/inflamed endothelium displaying high leukocyte adhesion (ICAM-1/VCAM-1).
* **Communication Semantics:**
  * **Granulocyte & Monocyte Mobilization:** CXCL8 recruits neutrophils via **CXCR1/CXCR2**; CCL2 recruits inflammatory monocytes via **CCR2**.
  * **T-Cell Reprogramming:** High IL6 signals via **IL6R/gp130** (classical or trans-signaling), activating **STAT3** in T cells to inhibit Foxp3 and push Th17 polarization (if basal TGF-β is available) or sustain a non-resolving inflammatory circuit.
* **Tissue Meaning:** Hyper-acute tissue reaction, early-stage pathogen invasion, or an active inflammatory tumor microenvironment.

---

#### Archetype 2: The Desmoplastic / Fibrotic Sclerosis Niche (SMAD/p53 High, NF-κB Low)
* **Combination:** $\text{TGFB1}^\text{high} + \text{SERPINE1}^\text{high} \quad [\pm \text{MMP3}^\text{low}, \text{IL6}^\text{low}, \text{CXCL8}^\text{low}, \text{CCL2}^\text{low}]$
* **Cell State Semantics:**
  * **Fibroblasts:** Myofibroblastic CAF (**myCAF**), mature myofibroblast, or quiescent/scar-forming stroma.
  * **Parenchyma:** Epithelial-to-Mesenchymal Transition (**EMT**) or deep fibrogenesis.
* **Communication Semantics:**
  * **ECM Accumulation & Fibrinolysis Shutdown:** TGFB1 induces heavy collagen/fibronectin synthesis. SERPINE1 (PAI-1) inhibits uPA/tPA, preventing plasmin generation and locking the matrix against degradation.
  * **Immunosuppression:** TGFB1 directly silences CD8+ cytotoxic T cells and NK cells (downregulating Granzyme B, Perforin) while promoting conventional **Treg** expansion.
* **Tissue Meaning:** "Cold," desmoplastic, immune-excluded fibrotic scar; late-stage fibrosis (e.g., idiopathic pulmonary fibrosis, scleroderma, or non-inflamed dense tumor stroma).

---

#### Archetype 3: The Full Senescence-Associated Secretory Phenotype (SASP) Hub
* **Combination:** **All 6 High** ($\text{IL6}^\text{high} + \text{CXCL8}^\text{high} + \text{MMP3}^\text{high} + \text{SERPINE1}^\text{high} + \text{CCL2}^\text{high} + \text{TGFB1}^\text{high}$)
* **Cell State Semantics:**
  * **Senescent State:** Canonical late-stage, persistent senescent cell (replicative, therapy-induced, or oncogene-induced senescence [OIS]). 
  * Reflects dual activation: **p53/p21/SMAD** driving SERPINE1 and TGFB1, alongside **NF-κB/C-EBPβ** driving IL6, CXCL8, and CCL2.
* **Communication Semantics:**
  * **Paracrine Senescence Propagation:** Extracellular TGFB1, IL6, and CXCL8 signal back to neighboring normal cells in an autocrine/paracrine loop, generating secondary bystander senescence.
  * **Immune Confusion / Myeloid Shield:** CCL2 and CXCL8 recruit monocytes and neutrophils; however, the surrounding TGFB1 and IL6 skew these cells into **M2-like Tumor-Associated Macrophages (TAMs)** and **Myeloid-Derived Suppressor Cells (MDSCs)**, shielding senescent or neoplastic cells from clearance.
  * **ECM Turnover Uncoupling:** Simultaneous expression of MMP3 (degradation) and SERPINE1 (anti-proteolysis) causes uncoordinated, chaotic matrix remodeling, generating fragmented matrikines that fuel invasiveness.

---

#### Archetype 4: Matrix Invasiveness vs. Matrix Stasis (The MMP3 vs. SERPINE1 Ratio)
The balance between **MMP3** and **SERPINE1** acts as an ECM rheostat:

```
   [High MMP3 / Low SERPINE1]                   [High SERPINE1 / Low MMP3]
 ──────────────────────────────                 ──────────────────────────────
 • Unchecked Proteolysis                        • Fibrinolytic Blockade
 • Basement membrane cleavage                   • Matrix Stiffening / Crosslinking
 • Shedding of E-cadherin (Invasion)            • ECM Stasis & Scar Maturation
```

* **Sub-combination A ($\text{MMP3}^\text{high} + \text{CXCL8}^\text{high} + \text{IL6}^\text{high}$ with $\text{SERPINE1}^\text{low}$):**
  * **Cell State:** Angiogenic / Invasive Front Stroma.
  * **Semantics:** MMP3 strips the basement membrane and cleaves precursor forms of cytokines, CXCL8 promotes endothelial sprout formation via CXCR2, and IL6 promotes survival. Signals tissue destruction, tumor invasion, or ulcerative wound margins.
* **Sub-combination B ($\text{SERPINE1}^\text{high} + \text{MMP3}^\text{high}$ together):**
  * **Cell State:** Invasive yet Motile Senescent / EMT State.
  * **Semantics:** Paradoxical co-expression. SERPINE1 coordinates cell detachment/adhesion cycles via vitronectin and LRP1 interactions, while MMP3 opens micro-tracks through collagen networks. This facilitates directional collective cell migration or metastasis.

---

#### Archetype 5: The Myeloid-Excluded Fibrogenesis Module
* **Combination:** $\text{TGFB1}^\text{high} + \text{SERPINE1}^\text{high} + \text{CCL2}^\text{high} \quad [\text{CXCL8}^\text{low}, \text{IL6}^\text{low}]$
* **Cell State Semantics:**
  * **Stroma:** Macrophage-dependent fibrogenesis.
* **Communication Semantics:**
  * CCL2 specifically recruits CCR2+ classical monocytes out of the bone marrow. 
  * Upon entry into the tissue, high local TGFB1 suppresses an M1 inflammatory response and induces a **pro-fibrotic M2/reparative macrophage phenotype**. These macrophages then produce additional TGFB1, creating a feed-forward fibrotic loop that locks the stroma into progressive sclerosis.

---

#### Archetype 6: The Inflammatory-Fibrotic Transition Switch
* **Combination:** $\text{TGFB1}^\text{high} + \text{IL6}^\text{high} \quad [\pm \text{CCL2}^\text{med}, \text{SERPINE1}^\text{med}, \text{CXCL8}^\text{low}]$
* **Cell State Semantics:**
  * **Immunological Switch:** The fundamental combination for **Th17 cell commitment**. Naive CD4+ T cells exposed to TGFB1 alone upregulate Foxp3 (Treg); adding IL6 upregulates RORγt via STAT3, driving Th17 differentiation.
  * **Fibroblast Intermediate:** "Hybrid CAF" or transitioning myofibroblast caught midway between an acute wound-healing state and a permanent scar state.
  * **Vascular Transition:** Endothelial-to-Mesenchymal Transition (**EndMT**), often observed in chronic vascular remodeling, pulmonary hypertension, or diabetic nephropathy.

---

### 3. Summary Matrix of Signatures

To use these markers as a decoding guide for bulk RNA, single-cell RNA-seq (scRNA-seq), or secretome arrays:

| Molecular State Signature   | Dominant Upstream Hub     | Inferred Cell State / Subpopulation         | Dominant Receptor–Ligand Pairs                                 | Tissue / Pathophysiological Outcome                                               |
| :-------------------------- | :------------------------ | :------------------------------------------ | :------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **CXCL8 + CCL2 + IL6**      | NF-κB / C/EBPβ            | **iCAF** / Acute Inflammatory Stroma        | CXCL8 $\to$ CXCR1/2<br>CCL2 $\to$ CCR2<br>IL6 $\to$ IL6R/gp130 | Acute inflammation, leukocyte influx, hyperpermeability.                          |
| **TGFB1 + SERPINE1**        | SMAD2/3 / p53             | **myCAF** / Myofibroblast                   | TGFB1 $\to$ TGFBR1/2<br>SERPINE1 $\to$ uPAR/LRP1               | Desmoplasia, ECM crosslinking, T-cell exclusion, immunosuppression.               |
| **All 6 Positive**          | NF-κB + p53 + SMAD        | **Core SASP** / Senescent Cell              | Multi-axis autocrine & paracrine signaling loops               | Chronic wound non-healing, late-stage cancer progression, paracrine tissue aging. |
| **MMP3 + CXCL8 + IL6**      | AP-1 / NF-κB              | Invasive / Angiogenic Endothelium or Stroma | CXCL8 $\to$ CXCR2 (Endothelial)<br>MMP3 $\to$ ECM cleavage     | Matrix destruction, active neovascularization, tissue invasion.                   |
| **TGFB1 + SERPINE1 + CCL2** | SMAD3 + NF-κB (selective) | Pro-fibrotic Macrophage–Stromal Niche       | CCL2 $\to$ CCR2<br>TGFB1 $\to$ SMAD2/3                         | Organ fibrosis (liver cirrhosis, pulmonary fibrosis, kidney CKD).                 |
| **TGFB1 + IL6**             | SMAD + STAT3              | Immune Divergence / EndMT Hub               | IL6 $\to$ gp130/STAT3<br>TGFB1 $\to$ SMAD                      | Th17 lineage skewing, chronic autoimmunity, vascular stiffening.                  |