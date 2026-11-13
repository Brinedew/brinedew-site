---
title: Quiescence depth
tags:
- content/wiki
date: 2026-11-11
draft: true
vital_level: 2
class: B
aliases:
- 
---
# Quiescence depth

**Quiescence depth** (also termed **G0 depth** or **depth of cellular dormancy**) is a classification of the non-dividing cells in eukaryotic organisms by how restricted are they from returning to the mitotic cell cycle. Quiescent cells cells occupy a spectrum characterized by variable activation thresholds and latencies to initiate DNA replication upon mitogenic stimulation.[1, 2] Cells situated in shallow quiescence reside near the restriction point and can re-enter the cell division cycle within hours of receiving minimal growth signals.[1, 3] Conversely, deeply quiescent or dormant cells require prolonged, high-concentration mitogen exposure, marked transcriptional reprogramming, and organelle remodeling before committing to cell division.[1, 4]

The depth of quiescence is governed biochemically by the bistable RB1-E2F1 signaling switch, the stoichiometric balance of cyclin-dependent kinases (CDKs) and their inhibitors (CKIs), metabolic shifts between protein synthesis and lysosomal autophagic clearance, and chromatin compaction.[1, 5] The regulation of quiescence depth is critical to tissue homeostasis, stem cell maintenance, longevity, and the evasion of cytotoxic therapies by dormant cancer cells.[2, 6]

---

## History

Early cell cycle models treated cellular quiescence as a uniform, off-cycle state.[2, 7] In 1953, Alma Howard and Stephen Pelc first divided the cell cycle into four discrete phases: G1, S, G2, and M.[8] However, this framework assumed that all viable cells continuously divided.[8] In 1963, Hungarian-British hematologist László G. Lajtha introduced the term "G0" to explain the kinetics of adult bone marrow stem cells, proposing that cells could reversibly exit the proliferative cycle into an out-of-cycle resting pool to avoid exhaustion while retaining the capacity to regenerate tissue.[7]

In 1974, Arthur Pardee identified a metabolic checkpoint in late G1 phase in mammalian cells, which he termed the restriction point (R-point).[3] Pardee observed that growth factor deprivation before this point caused cells to drop out of cycle into G0, whereas cells that had passed the R-point were committed to completing mitosis regardless of environmental signals.[3] In 1985, Swedish researchers Anders Zetterberg and Olle Larsson established that cells serum-starved during early G1 required a significant post-stimulation latency before initiating DNA synthesis, demonstrating that exit from G0 back into the cell cycle is an active, time-dependent transition rather than an instantaneous resumption of G1.[9]

Throughout the late 20th century, G0 was widely assumed to be a passive, default state resulting merely from the absence of mitogens.[2] This view was overturned in 2006 by Hilary A. Coller and colleagues, who conducted microarray analyses of human fibroblasts arrested via serum starvation, contact inhibition, or loss of matrix adhesion.[2] Their work showed that quiescent cells actively transcribe a conserved genetic program that suppresses terminal differentiation, prevents apoptosis, downregulates proliferation machinery, and restructures the extracellular matrix.[2]

In 2008, Guang Yao, Lingchong You, and Joseph R. Nevins demonstrated that the mammalian RB1-E2F1 gene network functions as a bistable, hysteretic switch that converts graded growth factor inputs into an all-or-none commitment to cycle entry.[1] Their work provided a physical and mathematical definition of quiescence depth: depth corresponds to the distance between a cell's basal state and the threshold required to flip the RB1-E2F1 switch.[1]

In 2014, Joseph T. Rodgers and Thomas A. Rando identified a primed, intermediate state termed "GAlert" in adult stem cells.[10] They showed that systemic injury triggers distant muscle stem cells to transition into this shallow state, which features increased metabolic activity and halved cell-cycle entry latency.[10] In 2015, Fabiana Laurenti, John E. Dick, and colleagues mapped quiescence depth directly to human hematopoiesis, demonstrating that differential abundance of CDK6 protein acts as an intracellular timer governing the division latency between dormant long-term stem cells and primed progenitors.[11]

---

## Continuum of Quiescence States

Quiescence depth is categorized into four distinct, progressive states along a biological continuum from shallowest to deepest.[1, 10, 11]

```
Shallowest ─────────────────────────────────────────────────────────────► Deepest

  GAlert / Primed         Homeostatic / Resting        Dormant               Terminal / Senescent
  (Class I)               (Class II)                   (Class III)           (Class IV)
  ─────────────────       ──────────────────────       ───────────────       ────────────────────
  • High CDK6             • Unphosphorylated RB1       • Absent CDK6         • Permanent CDK block
  • Active MTOR           • CDKN1B / CDKN1C balanced  • High CDKN1C / TFEB  • High CDKN2A / CDKN1A
  • Rapid exit (<14h)     • Standard exit (18–30h)     • Delayed exit (>48h) • Non-cycling (locked)
```

| State | Activation threshold | S-phase latency | Representative human cell populations | Defining molecular markers and drivers |
| :--- | :--- | :--- | :--- | :--- |
| **Primed / Alert (GAlert)** | Minimal; responds rapidly to low-dose mitogens or injury signals | 8–14 hours | Multipotent progenitors (MPPs), short-term hematopoietic stem cells (ST-HSCs), alerted muscle satellite cells | High CDK6 protein, CD34, KIT, PROM1, active MTOR, basal MYC; absence of MKI67 |
| **Homeostatic / Resting** | Intermediate; requires sustained physiological mitogen signaling | 18–30 hours | Unperturbed skeletal muscle satellite cells, resting vascular endothelial cells, naive and memory T cells | Hypophosphorylated RB1, unphosphorylated RBL2, balanced CDKN1B and CDKN1C, PAX7, CALCR, SDC4, FOXO3 |
| **Dormant (Deep G0)** | High; requires prolonged, supranormal growth factor stimulation | 36–72+ hours | Long-term hematopoietic stem cells (LT-HSCs), dormant neural stem cells (dNSCs), disseminated tumor cells (DTCs) | Complete absence of CDK6 protein, high CDKN1C, CDKN1A, low translation, active TFEB, ITGA6, THY1, GPRC5C, MECOM |
| **Terminal / Irreversible Boundary** | Infinite under normal physiological conditions; refractory to mitogens | Irreversible arrest | Senescent cells (replicative, oncogene-induced, or deep quiescence-derived), mature post-mitotic neurons, cardiomyocytes | High CDKN2A, sustained CDKN1A, active TP53, permanent loss of PCNA and MCM2; SASP factors IL6, CXCL8, MMP3 |

---

## Human Cell Populations by Depth

### 1. Primed and Alert Quiescence (Shallowest G0)

Cells in primed quiescence reside immediately adjacent to the R-point boundary.[1, 10] They are functionally non-dividing and lack classical proliferation markers such as MKI67 and PCNA, yet maintain active cellular transcription, intact mitochondrial networks, and elevated baseline translation rates compared to deeper states.[10, 11]

* **Multipotent Progenitors (MPPs):** Defined immunophenotypically as Lin- CD34+ CD38- PTPRC- THY1- ITGA6-, human MPPs are lineage-uncommitted progenitors that have lost long-term self-renewal capacity.[11] MPPs sit in a shallow G0 state and cross into S phase within 8 to 12 hours of exposure to early-acting hematopoietic cytokines such as KITLG, FLT3LG, and TPO.[11]
* **Short-Term Hematopoietic Stem Cells (ST-HSCs):** Defined as Lin- CD34+ CD38- PTPRC- THY1+ ITGA6-, these cells act as an intermediate compartment between deeply dormant stem cells and committed progenitors.[11] ST-HSCs express high basal levels of CDK6 protein, enabling immediate assembly with D-type cyclins such as CCND1 to drive rapid cell cycle re-entry.[11]
* **Alerted Muscle Satellite Cells (GAlert):** In response to distant muscle trauma or systemic signaling mediated by hepatocyte growth factor binding to the MET receptor, resting muscle satellite cells transition into an alerted state.[10] Dependent on signaling through MTOR complex 1, GAlert cells show increased cell size, enhanced mitochondrial oxidative phosphorylation, and halved entry latency into the first division cycle relative to homeostatic satellite cells.[10]
* **Molecular characteristics:** High pre-existing reserves of CDK6 protein, active MTOR signaling, basal expression of MYC, and identity markers including CD34, KIT, PROM1, ASCL1, and HES1.[10, 11]

### 2. Homeostatic and Resting Quiescence (Intermediate G0)

Homeostatic quiescence represents the baseline state of adult somatic stem cells and differentiated tissues under steady-state physiological conditions.[2, 10] These cells divide infrequently to compensate for normal physiological turnover and require sustained, standard concentrations of growth factors to pass the restriction point.[1, 3]

* **Resting Skeletal Muscle Satellite Cells:** Positioned between the sarcolemma and basal lamina of uninjured muscle fibers, homeostatic satellite cells maintain quiescence under the control of the transcription factor PAX7 and cell surface receptors CALCR and SDC4.[10] Active NOTCH1 signaling maintains expression of HES1, repressing myogenic differentiation mediated by MYOD1 until local mechanical or chemical injury occurs.[10]
* **Vascular Endothelial Cells:** Endothelial cells lining mature human blood vessels remain in an intermediate G0 arrest for months or years in the presence of laminar shear stress.[12] Unphosphorylated RB1 and RBL2 associate with E2F4 and E2F5 to actively repress cell-cycle promoters, while basal levels of CDKN1B prevent premature activation of CDK2.[12]
* **Naive and Resting Memory T Lymphocytes:** Non-proliferating lymphocytes circulate through blood and secondary lymphoid organs until recruited by cognitive antigen presentation.[13] Their resting state is actively maintained by transcription factors FOXO3 and KLF2, which silence the translational activator MYC and repress growth signaling.[13]
* **Molecular characteristics:** Moderate levels of cyclin-dependent kinase inhibitors CDKN1B and CDKN1C, hypophosphorylated RB1, unphosphorylated RBL2, and low CDK2 activity.[1, 12]

### 3. Dormant Quiescence (Deep G0)

Dormant cells exhibit the highest activation barrier among reversible cell cycle states.[4, 11] They display low cell volume, low mitochondrial membrane potential, minimal global translation, and high resistance to cytotoxic insults.[4, 6]

* **Long-Term Hematopoietic Stem Cells (LT-HSCs):** Human LT-HSCs (Lin- CD34+ CD38- PTPRC- THY1+ ITGA6+) reside within perivascular and endosteal bone marrow niches.[11] They show near-complete absence of CDK6 protein.[11] Before an LT-HSC can cross the R-point, it must transcribe and translate CDK6 de novo, producing an enforced delay of 48 to 72 hours before S-phase entry.[11]
* **Dormant Neural Stem Cells (dNSCs):** In the adult subventricular zone and hippocampal dentate gyrus, primitive radial glia-like stem cells remain dormant for prolonged intervals.[14] Deep dormancy is maintained by glycolytic metabolism, low reactive oxygen species, and transcription factors including NR2F1 and ID3.[14]
* **Disseminated Tumor Cells (DTCs):** Cancer cells that metastasize to distant organs (e.g., bone marrow, lung, brain) frequently enter deep dormancy as solitary cells or micrometastases.[6] They evade anti-proliferative chemotherapies by upregulating CDKN1C, CDKN1A, and NR2F1 while downregulating proliferative machinery.[6]
* **Molecular characteristics:** Absence of CDK6 protein, elevated levels of CDKN1C and CDKN1A, active endolysosomal and autophagic clearance governed by TFEB, LAMP1, and CTSD, expression of dormancy-associated surface markers including GPRC5C, MECOM, and EGR1, and marked repression of cyclins CCND1, CCND2, and CCNE1.[4, 6, 11]

### 4. Terminal and Senescent Arrest (Deepest G0 Boundary)

The extreme terminus of the quiescence continuum consists of cells that have lost the capacity to re-enter the cell cycle under normal physiological conditions.[5, 15] Prolonged residence in deep quiescence can erode the molecular mechanisms preserving reversibility, transitioning cells across a boundary into permanent cell cycle arrest.[5]

* **Quiescence-Origin Senescent Cells:** Cells subjected to unalleviated serum deprivation, severe contact inhibition, or persistent metabolic stress can transition from deep G0 into senescence.[5] This transition is marked by the accumulation of CDKN2A (which permanently disables CDK4 and CDK6) and TP53-dependent induction of CDKN1A.[5, 15]
* **Terminally Differentiated Post-Mitotic Somatic Cells:** Fully mature human cells, such as ventricular cardiomyocytes, osteocytes, and adult central nervous system neurons, are permanently post-mitotic.[15] Their cell cycle apparatus is silenced through the eviction of pre-replication complexes (permanent loss of PCNA, MCM2, and MCM7) and extensive formation of repressive heterochromatin.[15]
* **Molecular characteristics:** Irreversible pocket protein suppression mediated by sustained CDKN2A and CDKN1A expression, stable heterochromatin packaging of E2F target genes, and, in senescent populations, secretion of the senescence-associated secretory phenotype (SASP), including IL6, CXCL8, and MMP3.[5, 15]

---

## Molecular Mechanisms

### The RB1-E2F1 Bistable Switch

The molecular determinant of quiescence depth is the bistable switch formed by the pocket protein RB1 and the transcription factor E2F1.[1]

1. In quiescent cells, unphosphorylated or hypophosphorylated RB1 binds directly to E2F1, E2F2, and E2F3, assembling repressor complexes that recruit histone deacetylases and methyltransferases to silence cell-cycle promoters.[1, 12]
2. Upon mitogenic stimulation, D-type cyclins (CCND1, CCND2, CCND3) bind CDK4 and CDK6, mono-phosphorylating RB1.[16]
3. Mono-phosphorylated RB1 releases small amounts of E2F1, which transcribes CCNE1 and CCNE2.[16]
4. CCNE1 and CCNE2 activate CDK2, which hyper-phosphorylates RB1 across multiple serine and threonine residues, completely disengaging RB1 from E2F1.[1, 16]
5. Free E2F1 activates its own transcription via a positive feedback loop, driving irreversible commitment to S-phase entry.[1]

Quiescence depth corresponds to how far a cell's biochemical state rests from the critical threshold of this switch: shallow cells require minimal mitogen input to trigger the hyper-phosphorylation loop, whereas deep cells maintain high inhibitory thresholds that require sustained signaling to overcome.[1]

### Cyclin-Dependent Kinase Reservoirs and Timers

In human adult stem cells, differential protein abundance of CDK6 functions as an intracellular timer governing quiescence depth.[11] While both dormant LT-HSCs and primed ST-HSCs transcribe CDK6 mRNA, LT-HSCs selectively repress CDK6 translation through post-transcriptional mechanisms and microRNA targeting.[11] Because CDK6 is required for the initial phosphorylation of RB1, cells lacking CDK6 cannot respond to immediate mitogenic stimuli until new CDK6 protein is synthesized, establishing an intrinsic delay that separates shallow populations from deep dormancy.[11]

### Cyclin-Dependent Kinase Inhibitors

Quiescence depth is stabilized by two structural classes of stoichiometric kinase inhibitors:[5, 15]

* **CIP/KIP Family (CDKN1A, CDKN1B, CDKN1C):** 
  * CDKN1C is the primary inhibitor that sustains stem cell dormancy in the hematopoietic and nervous systems; its loss results in spontaneous exit from dormancy and stem cell exhaustion.[4, 11]
  * CDKN1B preserves intermediate homeostatic quiescence by binding and inhibiting CDK2-cyclin complexes.[1, 12]
  * CDKN1A is induced downstream of TP53 in response to replication stress, oxidative damage, or deep quiescence aging.[5]
* **INK4 Family (CDKN2A, CDKN2B, CDKN2C, CDKN2D):**
  * These proteins bind directly to monomeric CDK4 and CDK6, altering the ATP-binding pocket to prevent complex assembly with D-type cyclins.[15] High, sustained expression of CDKN2A marks the transition from reversible dormancy into permanent senescence.[5, 15]

### Proteostasis and Lysosomal Autophagy

Deep quiescence is an active metabolic state supported by selective organelle turnover rather than uncoordinated shutdown.[4] Deeply dormant stem cells suppress global protein translation to preserve genomic integrity and prevent proteotoxic stress.[4] To survive decades of relative inactivity, dormant cells upregulate autophagy and lysosomal clearance driven by the basic helix-loop-helix transcription factor TFEB.[4] TFEB directs the coordinated transcription of lysosomal enzymes and structural proteins, including LAMP1 and CTSD, clearing damaged mitochondria to suppress reactive oxygen species and prevent aberrant exit from dormancy.[4]

---

## Physiological and Clinical Significance

### Hematopoietic Stem Cell Transplantation

The therapeutic efficacy of bone marrow and mobilized peripheral blood grafts in clinical transplantation relies on the preservation of deeply dormant Class III LT-HSCs.[11] While shallow Class I cells (MPPs and ST-HSCs) provide rapid, short-term reconstitution of neutrophils and platelets within the first two weeks post-transplantation, only deeply dormant LT-HSCs sustain multilineage hematopoiesis over the recipient's lifetime.[11] Standard ex vivo culture protocols often drive LT-HSCs into shallow quiescence, resulting in the loss of long-term engraftment potential.[11]

### Cancer Dormancy and Therapeutic Resistance

Disseminated tumor cells (DTCs) that enter deep quiescence present a primary barrier to curative oncology in breast, prostate, and hematologic malignancies.[6] Standard cytotoxic chemotherapies (such as cytarabine, taxanes, and anthracyclines) target actively cycling cells by disrupting DNA synthesis or mitotic spindle assembly.[6] Deeply dormant cancer cells survive treatment because their replication apparatus (including PCNA and MCM2) is fully dismantled, and cell survival is supported by high levels of CDKN1A, CDKN1C, and autophagic flux.[4, 6] Following months or years of dormancy, microenvironmental perturbations can reactivate these cells into shallow quiescence and continuous cycling, causing metastatic relapse.[6]

### Stem Cell Aging

Aging in human stem cell compartments is characterized by dysregulation of quiescence depth.[10, 15] Chronic exposure to low-grade inflammatory cytokines alters the depth spectrum, locking muscle and neural stem cells into abnormally deep, refractory states or driving them across the boundary into irreversible senescence via accumulation of CDKN2A.[10, 15] This age-associated deepening impairs regenerative responsiveness, contributing to sarcopenia, decreased immune competence, and reduced neurogenesis in elderly populations.[10, 15]

---

## See also

* Cell cycle
* G0 phase
* Restriction point
* Stem cell
* Cellular senescence
* Disseminated tumor cells

---

## References

1. Yao, G.; Lee, T. J.; Mori, S.; Nevins, J. R.; You, L. (2008). "A bistable Rb-E2F switch underlies the restriction point". *Nature Cell Biology*, 10(4), 476–482. doi:10.1038/ncb1711.
2. Coller, H. A.; Sang, L.; Roberts, J. M. (2006). "A new description of cellular quiescence". *PLOS Biology*, 4(3), e83. doi:10.1371/journal.pbio.0040083.
3. Pardee, A. B. (1974). "A restriction point for control of normal animal cell proliferation". *Proceedings of the National Academy of Sciences*, 71(4), 1286–1290. doi:10.1073/pnas.71.4.1286.
4. Cabezas-Wallscheid, N.; Buettner, F.; Sommerkamp, P.; Klimmeck, D.; Ladel, L.; Thalheimer, F. B.; Pastor-Flores, D.; Roma, L. P.; Renders, S.; Zeisberger, P.; Przybylla, A.; Schönberger, K.; Scialdone, A.; Trumpp, A. (2017). "Vitamin A-Retinoic Acid Signaling Regulates Hematopoietic Stem Cell Dormancy". *Cell*, 169(5), 807–823. doi:10.1016/j.cell.2017.04.018.
5. Fujimaki, K.; Li, R.; Chen, H.; Dell'Erba, S.; Kobatake, E.; Yao, G. (2019). "Graded Regulation of Cellular Quiescence Depth between Proliferation and Senescence by a Bifurcated Mechanism". *Proceedings of the National Academy of Sciences*, 116(45), 22624–22634. doi:10.1073/pnas.1915905116.
6. Sosa, M. S.; Bragado, P.; Aguirre-Ghiso, J. A. (2014). "Mechanisms of disseminated cancer cell dormancy: an awakening". *Nature Reviews Cancer*, 14(9), 611–622. doi:10.1038/nrc3793.
7. Lajtha, L. G. (1963). "On the concept of the cell cycle". *Journal of Cellular and Comparative Physiology*, 62(S1), 143–145. doi:10.1002/jcp.1030620413.
8. Howard, A.; Pelc, S. R. (1953). "Synthesis of deoxyribonucleic acid in normal and irradiated cells and its relation to chromosome breakage". *Heredity*, 6(Suppl), 261–273. doi:10.1038/hdy.1953.31.
9. Zetterberg, A.; Larsson, O. (1985). "Kinetic analysis of regulatory events in G1 leading to proliferation or quiescence of Swiss 3T3 cells". *Proceedings of the National Academy of Sciences*, 82(16), 5365–5369. doi:10.1073/pnas.82.16.5365.
10. Rodgers, J. T.; King, K. Y.; Brett, J. O.; Cromie, M. J.; Charville, G. W.; Maguire, P. D.; Brunson, C.; Mastey, N.; Liu, L.; Tsai, C. R.; Cheung, T. H.; Rando, T. A. (2014). "mTORC1 controls the adaptive transition of quiescent stem cells from G0 to GAlert". *Nature*, 510(7505), 393–396. doi:10.1038/nature13255.
11. Laurenti, F.; Frelin, C.; Xie, S.; Ferrari, R.; Dunant, C. F.; Zandi, S.; Neumann, A.; Plumb, I.; Doulatov, S.; Chen, J.; April, C.; Fan, J. B.; Iscove, N.; Dick, J. E. (2015). "CDK6 levels regulate quiescence exit in human hematopoietic stem cells". *Cell Stem Cell*, 16(3), 302–313. doi:10.1016/j.stem.2015.01.017.
12. Akerman, I.; Fuster, J. J. (2020). "Vascular endothelial cell quiescence and proliferation: two sides of the same coin". *Arteriosclerosis, Thrombosis, and Vascular Biology*, 40(7), 1622–1631.
13. Yusuf, I.; Fruman, D. A. (2003). "Regulation of quiescence in lymphocytes". *Trends in Immunology*, 24(7), 380–386. doi:10.1016/S1471-4906(03)00168-5.
14. Urbán, N.; Blomfield, I. M.; Guillemot, F. (2019). "Quiescence of Adult Neural Stem Cells: An Inside-Out, Outside-In Dynamic". *Trends in Cell Biology*, 29(12), 978–989. doi:10.1016/j.tcb.2019.09.006.
15. Campisi, J.; d'Adda di Fagagna, F. (2007). "Cellular senescence: when bad things happen to good cells". *Nature Reviews Molecular Cell Biology*, 8(9), 729–740. doi:10.1038/nrm2233.
16. Narasimha, A. M.; Kaulich, M.; Shapiro, G. S.; Choi, Y. J.; Sicinski, P.; Dowdy, S. F. (2014). "Cyclin D activates the Rb tumor suppressor by mono-phosphorylation". *eLife*, 3, e02872. doi:10.7554/eLife.02872.