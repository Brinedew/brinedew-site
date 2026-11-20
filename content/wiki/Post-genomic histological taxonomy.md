---
title: Post-genomic histological taxonomy
tags:
  - content/wiki
  - taxonomy
date: 2026-11-20
draft: true
vital_level: 3
class: C
aliases:
  - Transcriptomic prediction of tissue architecture
  - Histological taxonomy
---
# Post-genomic histological taxonomy

**Post-genomic histological taxonomy** asks how living three-dimensional tissue architecture should be classified once every cell's transcriptome can be measured—and, more sharply, how much of a tissue's 3D geometry is actually determined by steady-state gene expression versus developmental history, boundary geometry, and mechanical stress.

Classical histology still rests on the 19th-century consolidation of Marie François Xavier Bichat's 21 anatomical tissues (1800–1802) into **Four Basic Tissue Types**—epithelial, connective, muscle, and nervous (with *Terminologia Histologica* [2008] separating haemolymphoid tissue as a fifth top-level bin).[^bichat1800][^terminologia2008] That taxonomy survives in medical education and cancer pathology (separating epithelial carcinomas from mesenchymal sarcomas), but cracks under modern biology: "connective tissue" lumps calcified cortical bone with liquid blood, hormone secretion spans neurons and adipocytes as well as glandular epithelia, and embryonic germ layers do not map cleanly onto the four classes.

A rigorous test of whether gene expression can replace classical histology must avoid smuggling organ-specific marker genes (*NPHS1*, *UPK1A*, *MBP*, *GATA4*) into the classifier—which is merely organ-name lookup, not physical prediction. When restricted strictly to **domain-general physical and mechanical gene modules**, steady-state gene expression cleanly predicts **~18 distinct local material and micro-architectural basins**, while provably failing to break four exact classes of mesoscale 3D symmetry: macro-topology, fibril orientation angle, load-adaptive porosity, and embryonic migration lamination.

## Four parallel post-genomic frameworks

No single textbook rewrite (including Paul and Eve Neumann's 2021 proposal of 11 basic tissues and 30 second-order classes)[^neumann2021] has dethroned the four-tissue teaching scaffold. Instead, post-genomic biology has built four parallel operational frameworks:

1. **Multi-scale atlas ontologies & Functional Tissue Units (HuBMAP / Human Cell Atlas):** Replaces broad tissue buckets with computable **ASCT+B tables** linking **A**natomical **S**tructures (Uberon), **C**ell **T**ypes (Cell Ontology), and molecular **B**iomarkers onto a 3D Common Coordinate Framework, anchored around repeating **Functional Tissue Units (FTUs)** (kidney glomerulus, colonic crypt, lung alveolus, liver lobule).[^borner2021]
2. **Transcriptomic & evolutionary cell-type trees:** Single-cell genomics revealed thousands of transcriptionally distinct cell clusters where classical histology named ~200 cell types. Frameworks include hierarchical multimodal phylogenies (Allen Brain Cell Atlas: *class → subclass → supertype → cluster*),[^zeng2022] Detlev Arendt's evolutionary **Core Regulatory Complex (CoRC)** taxonomy defining cell types by conserved [[Terminal selectors|terminal selector]] combinations,[^arendt2016] and Xia and Yanai's "Periodic Table of Cell Types" organizing lineage and reversible physiological state as analogous to chemical elements and isotopes.[^xia2019]
3. **Spatial-omics cellular neighborhoods & molecular pathology:** Spatial transcriptomics and multiplexed proteomics classify tissues bottom-up into recurring **cellular neighborhoods** and **tissue ecotypes** (see [[Tissue signalling archetypes]]). In clinical oncology, the modern **WHO Classification of Tumors** (especially in CNS and hematolymphoid malignancies) has already transitioned to an integrated **histo-molecular taxonomy** where DNA methylation profiles and driver mutations override H&E morphology.
4. **Structural vs. regulatory gene constraint:** Physical laws tightly constrain **structural/effector genes** (tight junctions, cadherins, fibrillar collagens, sarcomeres—changing cadherin expression alone forces dissociated cells to self-sort into concentric layers), whereas core **regulatory toolkit pathways** (Wnt, Notch, Hedgehog, BMP, FGF) are highly promiscuous across radically different organ architectures.

## A strictly domain-general physical vector: $\mathbf{V} = (J, P, B, M, K, V)$

To test how far steady-state gene expression predicts 3D tissue architecture without cheating via organ-unique markers, each ~200 µm tissue voxel can be encoded along six universal mechanical and transport axes:

- **$J$ — Intercellular mechanical coupling & sealing:** `J0` dispersed (low cadherins/claudins); `J1` plastic/fluid adhesion (*CDH1*/*CDH2*, no tight seals or desmosomes); `J2` leaky cohesive sheet (*CDH1* + pore-forming *CLDN2/10/15/16/19*); `J3` tight polarized seal (*CDH1* + sealing *CLDN1/3/4/5/8/18*, *OCLN*); `J4` high-shear riveted lattice (*CDH1* + dense desmosomes *DSP/DSG/DSC/JUP* + cytokeratins); `J5a` junctional electromechanical syncytium (*CDH2* + desmosomes + *GJA1/GJA5* gap junctions); `J5b` fused cytoplasmic syncytium (*MYMK*, *MYMX*).
- **$P$ — Polarity & division-axis geometry:** `P0` apolar; `P1` single apical-basal axis with in-plane spindle (*CRB3*, *PARD3*, *SCRIB*); `P2` apical-basal + planar cell polarity (*VANGL1/2*, *CELSR1–3*, *FZD3/6*); `P3` multipolar / lateral-lumen polarity (*STK11*, *MARK2*); `P4` stratifying perpendicular division (*TP63* + vertical spindle *GPSM2/NUMA1*).
- **$B$ — Basement membrane / boundary stiffness:** `B0` absent/discontinuous; `B1` standard flexible sheet (*COL4A1/2*, *LAMA5/B1/C1*, *HSPG2*); `B2` shear-riveted anchor (*LAMA3/B3/C2*, *COL7A1*, *COL17A1*, *ITGA6/B4*); `B3` high-pressure crosslinked filter (*COL4A3/4/5*, *LAMA5/B2*); `B4` force-transducing sheath (*LAMA2*, *DAG1*, *ITGA7*).
- **$M$ — Interstitial matrix material phase:** `M0` ultra-soft polyelectrolyte gel (<1 kPa; *HAS1–3*, lecticans, no fibrillar *COL1/3*); `M1` compliant loose reticular mesh (high *COL3A1*:*COL1A1*, low *LOX*); `M2` elastic recoil composite (*ELN*, *FBN1*, *FBLN5*, *LOXL1*); `M3` isotropic woven tensile fabric (*COL1A1/2*, *COL3A1*, *LOX*); `M4` aligned fibrillar tensile material (*COL1A1/2*, *COL5A1*, fibril-spacing clamps *DCN/FMOD/LUM/COL12A1/14A1*, *LOX*); `M5` pressurized compressive hydrogel (*COL2A1*, *ACAN*, *HAPLN1*); `M6` rigid mineralized solid (*COL1A1/2* + *ALPL*, *PHOSPHO1*, *IBSP*, *SPP1*, *DMP1*).
- **$K$ — Intracellular mechanical engine:** `K0` cortical actin only; `K1` passive cytokeratin armor (*KRT*); `K2` non-striated tonic contractility (*ACTA2*, *MYH11*, *TAGLN*); `K3` crystalline striated motors (*TTN*, *ACTN2*, *MYOM1/2*, *DES*); `K4` long-range microtubule/neurofilament cables (*TUBA/B*, *MAPT*, *NEFL/M/H*).
- **$V$ — Local microvascular transport regime:** `V0` avascular (no *CDH5*/*PECAM1*); `V1` sealed transcytosis-blocked (*CDH5*, *CLDN5*, *MFSD2A*); `V2` standard continuous (*CDH5*, *CAV1*, *COL4A1/2*); `V3` fenestrated bulk-flux (*CDH5*, *PLVAP*/*VEGFA*); `V4` open discontinuous sinusoidal (*CDH5*, absent vascular BM).

### Forward physical derivation rules and hard incompatibilities

Six biophysical laws map valid $(J, P, B, M, K, V)$ vectors blindly onto 3D geometry and eliminate $>99\%$ of the $36,750$ combinatorial states:

1. **Dimensionality:** `P0 + J0` cannot form sheets or lumina (3D solid/gel continuum dictated by `M`); `P1/P2 + J2/J3 + B1/B3` forces a 1-cell-thick closed surface (sheet, sphere, or tube); `P4 + J4 + B2` forces a multi-layered shear-resistant sheet; `P3 + J3 + B0 + V4` forces 1–2-cell anastomosing plates with lateral micro-canals bathed in open sinusoids.
2. **Buckling instability:** A proliferating sheet (`P1`) on compliant stroma (`M1`) radially confined by concentric smooth muscle (`K2`) undergoes compressive buckling into folds, crypts, or villi; dropping `K2` yields an unbuckled lumen.
3. **Directional flow:** Planar polarity (`P2`) on a 1-cell surface forces anisotropic unidirectional transport along the lumen axis.
4. **Force alignment:** Striated motors (`K3`) coupled via `B4` must align into uniaxial parallel fascicles (`J5b`) or branched helical sheets (`J5a`) rather than packing isotropically.
5. **Diffusion scale:** Avascularity (`V0`) caps thickness at the $\text{O}_2$ diffusion limit ($\le 1\text{–}2\text{ mm}$); mineralized solids (`M6 + V2`) block passive diffusion and force micro-porous vascular canals and dendritic intercellular tunnels.
6. **Hard incompatibilities:** `(M5 or M6) + (J2–J5)` is physically impossible (pressurized gel or mineral encasing every cell prevents continuous epithelial junctions); `K3 + (B0 or M0)` rips cells off their matrix; `V0 + (K3 or K4)` necroses beyond ~200 µm; `(P1 or P4) + J3/J4 + B0` collapses without a basement membrane.

## The ~18 predictive basins and their exact collision boundaries

| Vector `(J, P, B, M, K, V)` | Blindly derived 3D micro-architecture | Human organs landing in this basin | What steady-state gene expression **fails** to predict |
| :--- | :--- | :--- | :--- |
| `(J4, P4, B2, M3, K1, V2)` | Multi-layered, shear-riveted stratified sheet over isotropic woven base | Skin, esophagus, oral mucosa, vagina, ectocervix | Flat outer sheet vs. collapsed tube; dry cornified vs. wet surface |
| `(J3, P1, B1, M1, K0, V3)` | 1-cell-thick watertight polarized lumen(s) in compliant high-flux stroma | Thyroid follicles, pancreatic acini/ducts, salivary glands, renal collecting ducts | **Macro-topology:** closed spheres vs. branched trees vs. straight pipes |
| `(J2, P1, B1, M1, K0, V3)` | 1-cell-thick *leaky* unbuckled polarized absorptive tube | Kidney proximal tubule, choroid plexus (inverted) | Convoluted pipe vs. tufted frond |
| `(J2, P1, B1, M1, K2, V3)` | 1-cell-thick *leaky* polarized sheet buckled by concentric smooth muscle (`K2`) | Small intestine | Exact villus-to-crypt ratio |
| `(J3, P1, B1, M1, K2, V2)` | 1-cell-thick *watertight* distensible folded hollow sac/tube | Colon, stomach, urinary bladder, ureter, gallbladder | Hollow sac vs. tube; specialized apical plaques vs. mucus pits |
| `(J3, P2, B1, M2, K2, V2)` | Sealed polarized tube with unidirectional planar axis (`P2`) + elastic/muscular recoil | Conducting airways (trachea/bronchi), fallopian tube, epididymis | Dichotomous branching tree vs. single coiled tube |
| `(J3, P1, B3, M2, K0, V2)` | Sealed ultra-thin sheet on crosslinked BM (`B3`) inside elastic spring web (`M2`) | **Lung alveoli** *(unique basin)* | Alveolar pore size and lobular partitioning |
| `(J1, P1, B3, M1, K0, V3)` | Porous polarized sheet on high-pressure crosslinked BM opposing fenestrated capillaries | **Kidney glomerulus** *(unique basin)* | Capillary loop convolution geometry |
| `(J3, P3, B0, M1, K0, V4)` | Multipolar lateral-lumen cells with tight micro-seals, no BM, bathed in open sinusoids | **Liver lobule** *(unique basin)* | Hexagonal vs. acinar vascular boundary geometry |
| `(J1, P0, B1, M1, K0, V3)` | Apolar loosely cohesive lumen-less solid nests/cords with fenestrated capillaries | Pancreatic islets, adrenal cortex/medulla, parathyroid, anterior pituitary | Spherical islets vs. parallel cords vs. arched nests |
| `(J5a, P0, B4, M3, K3, V2)` | Branched electromechanical striated syncytium | **Heart myocardium** *(unique basin)* | Four-chamber geometry and helical fiber pitch |
| `(J5b, P0, B4, M3, K3, V2)` | Fused multinucleated striated cylinders force-coupled to ECM | **Skeletal muscle** *(unique basin)* | Fusiform vs. pennate vs. circular sphincter geometry |
| `(J1, P0, B1, M2, K2, V2)` | Concentric tonic contractile rings in elastic recoil lamellae (Windkessel vessel) | Elastic conducting arteries (aorta, carotid; `M2 → M3` gives muscular arteriole) | Caliber and branching angles |
| `(J0, P0, B0, M4, K0, V0)` | Avascular, diffusion-thin, strictly spaced Type I collagen composite | Tendon, ligament, corneal stroma, intervertebral disc annulus | **Fibril angle:** parallel rope vs. 90° transparent plywood vs. helical rings |
| `(J0, P0, B0, M5, K0, V0)` | Avascular osmotically pressurized Type II hydrogel cushion | Articular hyaline cartilage, tracheal rings, nasal septum | Macroscopic mold (joint cap vs. C-ring vs. flat plate) |
| `(J0, P0, B0, M6, K0, V2)` | Vascularized rigid mineralized collagen composite (`V2 → V0` gives tooth dentin) | Cortical bone, trabecular bone | **Mesoscale porosity:** dense concentric osteons vs. open 3D strut lattice |
| `(J1, P0, B0, M0, K4, V1)` | Ultra-soft (<1 kPa) collagen-free gel packed with microtubule cables behind sealed vessels | Cerebral cortex, cerebellum, striatum, hippocampus, spinal gray | **Mesoscale neuroanatomy:** 6-layer cortex vs. folded 3-layer folia vs. unlayered nuclei |
| `(J0, P0, B0, M1, K0, V4)` | Non-cohesive motile cells inside open reticular mesh with sinusoidal flow | Lymph node, spleen, bone marrow stroma | Compartmentalized B-follicle, T-zone, and red-pulp zoning |

## Where steady-state transcriptomics provably hits a wall

The collisions in the rightmost column define the exact boundary between genetic specification and emergent biophysics. Steady-state structural gene expression specifies the **local material phase and micro-architectural basin**, whereas four geometric symmetries are broken strictly outside the steady-state transcriptome:

1. **Macro-topology:** `(J3, P1, B1, M1, K0, V3)` cannot distinguish a closed thyroid sphere from a branched pancreatic tree or a straight renal collecting duct; macro-topology is a frozen record of developmental morphogenesis and luminal pressure history.
2. **Fibril and lamellar orientation angles:** `(J0, P0, B0, M4, K0, V0)` cannot distinguish parallel tendon from orthogonal corneal plywood or helical disc rings; fiber angle is set by external mechanical tension vectors during matrix assembly.
3. **Load-adaptive mesoscale porosity:** `(J0, P0, B0, M6, K0, V2)` cannot distinguish compact osteon cortical bone from spongy trabecular bone; that architecture is computed dynamically by local mechanical stress tensors (Wolff's law).
4. **Historical migration and buckling lamination:** `(J1, P0, B0, M0, K4, V1)` cannot distinguish 6-layer neocortex from folded cerebellum or unlayered striatum; those architectures were locked in by transient embryonic migration waves and differential growth buckling that vanish from the adult transcriptome.

## See also

- [[Terminal selectors]]
- [[Tissue signalling archetypes]]
- [[Mosaic vs regulative development spectrum]]
- [[Taxonomy of non mechanistic models in biology]]

## References

[^bichat1800]: Bichat MFX (1800). *Traité des membranes en général et de diverses membranes en particulier*. Paris: Richard, Caille et Ravier.
[^terminologia2008]: Federative International Committee on Anatomical Terminology (FICAT) (2008). *Terminologia Histologica: International Terms for Human Cytology and Histology*. Philadelphia: Lippincott Williams & Wilkins.
[^neumann2021]: Neumann PE, Neumann EE (2021). "General histology: a new classification of tissues". *Clinical Anatomy*. 34 (3): 399–408. [doi:10.1002/ca.23676](https://doi.org/10.1002/ca.23676)
[^borner2021]: Börner K, Teichmann SA, Quardokus EM, Gee JC, Browne K, et al. (2021). "Anatomical structures, cell types and biomarkers of the Human Reference Atlas". *Nature Cell Biology*. 23 (11): 1117–1128. [doi:10.1038/s41556-021-00788-6](https://doi.org/10.1038/s41556-021-00788-6)
[^zeng2022]: Zeng H (2022). "What is a cell type and how to define it?". *Cell*. 185 (15): 2739–2755. [doi:10.1016/j.cell.2022.06.031](https://doi.org/10.1016/j.cell.2022.06.031)
[^arendt2016]: Arendt D, Musser JM, Baker CVH, Bergman A, Cepko C, et al. (2016). "The origin and evolution of cell types". *Nature Reviews Genetics*. 17 (12): 744–757. [doi:10.1038/nrg.2016.127](https://doi.org/10.1038/nrg.2016.127)
[^xia2019]: Xia B, Yanai I (2019). "A periodic table of cell types". *Development*. 146 (12): dev169854. [doi:10.1242/dev.169854](https://doi.org/10.1242/dev.169854)
