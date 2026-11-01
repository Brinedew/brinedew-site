---
title: Pluripotency silencing
tags:
  - content/wiki
date: 2026-11-01
draft: true
aliases:
  -
---
# Pluripotency silencing

The best-supported model for pluripotency silencing is lineage-specific initiation, followed by recruitment of partly shared transcriptional, post-transcriptional and epigenetic silencing machinery. There are several distinct molecular solutions for switching off OCT4, SOX2 and NANOG. Different developmental lineages recruit different combinations of repressors, while the chromatin machinery that consolidates the differentiated state overlaps substantially.

There is an important complication: the three core pluripotency factors do not necessarily disappear together. Some developmental programmes retain one of them because it acquires a new function in the differentiated lineage.

I'll use the core pluripotency battery to mean OCT4 (POU5F1), SOX2 and NANOG, with KLF4, PRDM14, LIN28A and ZFP42 as associated components.

The following is an enumeration of the major human developmental lineage decisions, organised chronologically. It covers the preimplantation lineages, postimplantation extraembryonic lineages, three germ layers and germline specification. I distinguish direct mechanistic evidence from lineage-marker observations.

# 1. What machinery is available for silencing pluripotency?

Before following the lineage tree, it helps to distinguish four different levels of regulation.

1. Transcription-factor antagonism

Lineage-specifying transcription factors can directly repress components of the pluripotency network, or induce transcriptional conditions under which its autoregulatory circuitry collapses.

This is highly lineage-dependent.

A particularly informative paper is:

Wang et al. (2012), Distinct Lineage Specification Roles for NANOG, OCT4, and SOX2 in Human Embryonic Stem Cells. Cell Stem Cell. [DOI: 10.1016/j.stem.2012.02.016](https://doi.org/10.1016/j.stem.2012.02.016?utm_source=chatgpt.com).

They demonstrated that the three factors have distinct roles in suppressing differentiation:

|Pluripotency factor|Differentiation programme it suppresses|
|---|---|
|NANOG|Neuroectoderm and neural crest|
|SOX2, with SOX3|Primitive streak and mesendoderm|
|OCT4|Regulates BMP4-dependent fate specification, with effects depending on its abundance|

This is important because the original pluripotency battery itself contains lineage-specific inhibitors.

A cell can begin differentiating by removing the particular factor that suppresses its intended fate. It subsequently dismantles the rest of the pluripotency network.

2. Post-transcriptional degradation

A particularly interesting common mechanism is miR-145.

Xu et al. (2009), MicroRNA-145 Regulates OCT4, SOX2, and KLF4 and Represses Pluripotency in Human Embryonic Stem Cells. Cell. [DOI: 10.1016/j.cell.2009.02.038](https://doi.org/10.1016/j.cell.2009.02.038?utm_source=chatgpt.com).

They showed that:

- miR-145 is low in self-renewing human ESCs.
    
- Its expression increases during differentiation.
    
- It directly targets the 3′ untranslated regions of OCT4, SOX2 and KLF4.
    
- OCT4 itself represses the miR-145 promoter.
    

This creates a double-negative feedback circuit. Once differentiation induces miR-145, the microRNA suppresses several components of the original pluripotency network, reinforcing the transition.

This is a shared mechanism available to multiple differentiation programmes, rather than a specific silencer belonging to one germ layer.

PubMed+1

3. Polycomb-mediated repression

PRC2, particularly its EZH1/2 catalytic components, deposits H3K27me3. PRC1 can subsequently help establish and maintain repressive chromatin.

Human ESCs contain large numbers of developmentally regulated genes in a bivalent state, with H3K4me3 and H3K27me3 occupying the same regulatory regions.

During differentiation, these genes can resolve towards either activation or repression.

Consequently, Polycomb is a reusable component of lineage restriction. Its recruitment and retention at particular genes depend on the lineage being established.

4. DNA methylation and other forms of chromatin consolidation

An especially useful distinction emerges when looking at the three core factors individually.

Barrand and Collas (2010) examined OCT4, NANOG and SOX2 chromatin in human embryonal carcinoma cells, mesenchymal stem cells and fibroblasts.

They found:

|Gene|Repressive mechanism observed|
|---|---|
|OCT4|Promoter CpG methylation associated with repression|
|NANOG|H3K27me3 enrichment despite relatively unmethylated promoter DNA|
|SOX2|H3K27me3 enrichment despite relatively unmethylated promoter DNA|

They also found an inverse relationship between promoter H3K27me3 and gene-body H3K36me3.

Thus, even when the three genes are all inactive in a differentiated cell, their regulatory regions can carry different repressive signatures.

PubMed+1

A particularly relevant recent addition is ERH, Enhancer of Rudimentary Homolog.

Katznelson et al. (2026), ERH elicits cell lineage restriction in mammalian preimplantation development and differentiation from pluripotency via H3K9me3-heterochromatin. Nature Communications. [DOI: 10.1038/s41467-026-76015-3](https://doi.org/10.1038/s41467-026-76015-3?utm_source=chatgpt.com).

This study identifies ERH as a regulator of developmental gene repression. During human ESC differentiation towards germ-layer lineages, ERH helps silence naïve and pluripotency-associated genes, transposable elements and alternative somatic lineage programmes.

There is a mechanistic qualification: ERH participates in maintaining H3K9me3-rich heterochromatin in differentiated fibroblasts, while its effects during hESC differentiation also appear to involve functions independent of measurable global H3K9me3 maintenance.

It is therefore an interesting candidate for a broadly reused lineage-restriction mechanism.

Nature Communications+2

# 2. MECE developmental enumeration

The first useful partition occurs during blastocyst formation. The human embryo establishes three founding cell populations: trophectoderm, hypoblast and epiblast.

The epiblast subsequently generates the embryo proper. The other two produce important extraembryonic tissues.

[Epiblast formation by TEAD-YAP-dependent expression of pluripotency factors and competitive elimination of unspecified cells | Graduate School of Frontier Biosciences, Osaka University](https://images.openai.com/static-rsc-4/3u1MXABL7EkhyE15S6WWbnzBdP4VOJl0i9cVsLnZL0VjIvI9NkEQDflq3Wy9YM1XI4vDs8om61ui70uHj9X7m4K028z6q1XcAqcy33xHgTdSCHcoQ0dAsiG3Ot8YghVySkxPkOwb7mTWYr-xoTHj_SpZfnBOUQirMmuW3URq78U?purpose=inline)

[fbs.osaka-u.ac.jp](https://www.fbs.osaka-u.ac.jp/en/research_results/papers/detail/167?utm_source=chatgpt.com)

## Stage I. Preimplantation development: blastocyst formation

Approximately days 5–7 after fertilisation.

### 1A. Trophectoderm → trophoblast → placenta

Direct silencer network identified

The trophectoderm adopts a lineage-specific transcriptional network involving:

- GATA2
    
- GATA3
    
- TFAP2A
    
- TFAP2C
    
- CDX2
    

The particularly important discovery is the GATA2/3–TFAP2A/C network, called the trophectoderm four, or TEtra.

Krendl et al. (2017), GATA2/3-TFAP2A/C transcription factor network couples human pluripotent stem cell differentiation to trophectoderm with repression of pluripotency. PNAS. [DOI: 10.1073/pnas.1708341114](https://doi.org/10.1073/pnas.1708341114?utm_source=chatgpt.com).

Their experiments showed that the TEtra factors occupy regulatory regions associated with OCT4 and placental genes. GATA3 and TFAP2A functionally couple trophoblast gene induction to suppression of OCT4.

Importantly, they also showed that reducing GATA3 in primate embryos prevents proper trophectoderm specification.

This is an unusually direct demonstration of a differentiation battery actively participating in the shutdown of pluripotency.

PubMed+1

There is a human-specific qualification concerning CDX2. Human trophectoderm can initially express OCT4, and CDX2 expression develops with different timing from its mouse counterpart. The mouse CDX2–OCT4 antagonism therefore should not be treated as a complete description of human trophectoderm specification.

The TEtra network provides stronger direct human-relevant evidence for the coupling of trophoblast specification and OCT4 repression.

Downstream branches: cytotrophoblast, syncytiotrophoblast and extravillous trophoblast.

These populations acquire further differentiation programmes involving factors such as GCM1, ASCL2 and placental regulatory networks. The available literature does not establish a separate, universally defined OCT4 silencer for each terminal trophoblast subtype.

### 1B. Hypoblast / primitive endoderm → extraembryonic endoderm

Silencer identity incompletely resolved

The hypoblast is specified through a lineage programme involving:

- GATA6
    
- SOX17
    
- GATA4
    
- PDGFRA
    

Human embryo studies show segregation of NANOG-positive epiblast cells and GATA4/SOX17-positive hypoblast cells.

Roode et al. (2012), Human hypoblast formation is not dependent on FGF signalling. Developmental Biology.

[Article](https://doi.org/10.1016/j.ydbio.2011.10.030?utm_source=chatgpt.com).

An interesting species difference appears here: human hypoblast formation does not show the same dependence on FGF signalling as mouse hypoblast formation.

In other words, the mouse signalling mechanism cannot simply be assumed to explain the human lineage decision.

PMC+1

For this lineage, the human literature establishes the GATA6–SOX17–GATA4 differentiation programme and the segregation from the NANOG-positive epiblast.

The molecular identity of a direct, dedicated repressor that shuts down all three of OCT4, SOX2 and NANOG in human hypoblast remains poorly resolved.

The distinction matters: GATA6 or SOX17 expression does not by itself demonstrate direct binding and repression of all three pluripotency loci.

The resulting extraembryonic endoderm subsequently forms the yolk sac-associated lineages, including visceral and parietal endoderm.

Weatherbee et al. (2024), Distinct pathways drive anterior hypoblast specification in the implanting human embryo. Nature Cell Biology. [DOI: 10.1038/s41556-024-01367-1](https://doi.org/10.1038/s41556-024-01367-1?utm_source=chatgpt.com).

This study adds further human-specific detail about NODAL and BMP signalling in hypoblast specification.

PubMed+1

### 1C. Epiblast → embryo proper

The epiblast maintains the core pluripotency network.

Its defining markers include OCT4, SOX2 and NANOG.

This is the population from which the subsequent developmental branches emerge.

## Stage II. Implantation and the second week: epiblast transitions and extraembryonic differentiation

Approximately days 8–14.

This stage contains an important complication for the idea of pluripotency shutdown: some epiblast derivatives begin expressing lineage markers while retaining individual pluripotency factors.

### 2A. Postimplantation epiblast state transition

Pluripotency-state transition

The epiblast undergoes progressive changes in its transcriptional state in preparation for gastrulation.

Molè et al. (2021), A single cell characterisation of human embryogenesis identifies pluripotency transitions and putative anterior hypoblast centre. Nature Communications. [DOI: 10.1038/s41467-021-23758-w](https://doi.org/10.1038/s41467-021-23758-w?utm_source=chatgpt.com).

They characterised human embryos between implantation and gastrulation and found that the epiblast passes through different pluripotent states.

This is a transition within the pluripotent developmental trajectory. It prepares cells for later lineage commitment, with signalling interactions between epiblast and extraembryonic tissues helping to establish the embryonic axis.

Nature Communications

### 2B. Amnion → amniotic epithelium

Partial pluripotency shutdown

Amnion is an epiblast-derived extraembryonic lineage.

Its specification is strongly influenced by BMP signalling.

The differentiation programme involves:

- BMP–SMAD signalling
    
- TFAP2A
    
- ISL1
    
- GATA3
    

Sekulovski et al. (2024), Temporally resolved early bone morphogenetic protein-driven transcriptional cascade during human amnion specification. eLife. [DOI: 10.7554/eLife.89367](https://doi.org/10.7554/eLife.89367?utm_source=chatgpt.com).

They identified a temporally resolved transcriptional cascade in human pluripotent stem-cell-derived amnion models and demonstrated that TFAP2A controls progression of amnion specification.

PMC+1

An especially interesting observation comes from the human postimplantation embryo modelling work of Modelling post-implantation human development to yolk sac blood emergence (2024).

Amnion-like cells expressing ISL1, TFAP2A and GATA3 retained OCT4 expression while substantially lacking NANOG.

This is a partial dismantling of the pluripotency battery, with OCT4 retained during the acquisition of extraembryonic identity.

Nature

## Stage III. Gastrulation: establishment of the three germ layers

Around day 14–21 after fertilisation.

Gastrulation establishes ectoderm, mesoderm and definitive endoderm. This is the major transition from pluripotent epiblast into the somatic developmental programmes.

[Gastrulação e Neurulação | Concise Medical Knowledge](https://images.openai.com/static-rsc-4/k94OH1OiiU75HyZ9BPltgXQrg1jyzv3nUdcfz9OUx3IZFdP7tIkWoja4NndF5JZxRczxUiWsh6xtzl-z1G_QmHwGCgQwOqe8cfYoGnUqWaAJTKSUrDjA8wa_NBUM2LXQmqcCw8u17krqUIDf5CRT644Ggh_9UINLkbVZ-u8j--8?purpose=inline)

[lecturio.com](https://www.lecturio.com/pt/concepts/gastrulacao-e-neurulacao/?utm_source=chatgpt.com)

There is a useful temporal study for understanding what happens to the core factors during this transition.

Madrigal et al. (2023), Epigenetic and transcriptional regulations prime cell fate before division during human pluripotent stem cell differentiation. Nature Communications. [DOI: 10.1038/s41467-023-36116-9](https://doi.org/10.1038/s41467-023-36116-9?utm_source=chatgpt.com).

Their human PSC time course revealed:

|Time after induction|Molecular events|
|---|---|
|Early hours|SOX2 is the first core pluripotency marker to decrease|
|Around 12 hours|T/BRA increases, followed by MIXL1 and EOMES|
|Around 24 hours|OCT4 and NANOG can remain expressed in OCT4-positive, T-positive, SOX2-negative mesendoderm cells|
|Around 36 hours|OCT4 and NANOG decline substantially as endoderm-associated GATA4, GATA6, SOX17 and FOXA2 increase|

This demonstrates a sequential transition in which the three pluripotency factors are regulated independently.

PubMed+1

Let's separate the resulting lineages.

### 3A. Ectoderm → neural ectoderm and surface ectoderm

Several mechanisms identified

Neural ectoderm

The important factor here is NANOG.

NANOG suppresses neuroectoderm differentiation in human ESC models. Inhibition of TGFβ/Activin/NODAL signalling causes rapid NANOG suppression and promotes neural differentiation.

The neural lineage has an interesting property: SOX2 is retained.

SOX2 becomes a major component of neural progenitor identity. It is subsequently involved in maintaining neural stem and progenitor populations.

Thus, neural differentiation entails substantial OCT4 and NANOG repression, with SOX2 retained in a new regulatory context.

Kim et al. (2014), Dynamic changes in DNA methylation and hydroxymethylation when hES cells undergo differentiation toward a neuronal lineage. Human Molecular Genetics. [DOI: 10.1093/hmg/ddt453](https://doi.org/10.1093/hmg/ddt453?utm_source=chatgpt.com).

They followed human ESC differentiation towards ventral midbrain neural precursors and dopamine neurons.

They observed:

- Promoter DNA methylation and reduced expression of POU5F1.
    
- Similar changes at ZFP42 and HMGA1.
    
- Dynamic 5-hydroxymethylcytosine changes at neurogenesis-associated genes.
    
- Promoter methylation acting as a mechanism for maintaining long-term silencing.
    

This is a particularly useful example of an epigenetic lock acquired during neural lineage commitment.

PubMed+1

Neural crest

Neural crest is a specialised ectoderm-derived population specified at the neural plate border.

Wang et al. identified NANOG as a suppressor of neural crest differentiation.

Consequently, NANOG reduction is important in allowing this lineage to emerge.

Its eventual neural crest-specific differentiation programme uses a different collection of transcription factors, including TFAP2A, SOX9 and FOXD3.

The precise molecular machinery responsible for final OCT4, SOX2 and NANOG repression in human neural crest cells has not been mapped as comprehensively as the initial NANOG-dependent fate restriction.

PubMed+1

Surface ectoderm

Surface ectoderm generates epidermal and associated epithelial lineages.

It follows a distinct differentiation trajectory involving BMP signalling and epithelial regulators such as TFAP2A, TP63 and GATA3.

The same general mechanisms of pluripotency repression are available here, although a dedicated human surface-ectoderm-specific silencer of the complete OCT4–SOX2–NANOG network has yet to be established.

### 3B. Mesoderm → axial, paraxial, intermediate and lateral plate mesoderm

Lineage-specific initiation, shared silencing machinery

The first event is the primitive streak and mesendoderm transition.

The relevant signalling inputs include:

- WNT/β-catenin
    
- NODAL/Activin
    
- BMP
    

The resulting differentiation network includes T/BRA, EOMES and MIXL1.

The early reduction in SOX2 is particularly important because SOX2 and SOX3 normally inhibit primitive streak specification.

OCT4 is still present during the early transition, and it participates in the induction of mesendoderm.

Subsequently, the pluripotency network collapses as mesoderm identity becomes established.

The resulting mesoderm partitions into:

|Developmental subdivision|Major downstream outcomes|
|---|---|
|Axial mesoderm|Notochord|
|Paraxial mesoderm|Somites, skeletal muscle, vertebrae and dermis|
|Intermediate mesoderm|Kidney and reproductive tract|
|Lateral plate mesoderm|Cardiovascular system, blood vessels, blood and body-wall structures|

The specific transcription factors differ across these populations. For instance, MESP2 and TBX6 are important in paraxial mesoderm segmentation, while kidney development recruits regulators such as PAX2 and LHX1.

The important finding for your question is that there is no comparably well-established universal human mesoderm-specific transcriptional repressor that directly shuts down all three core pluripotency genes.

The early SOX2/SOX3-dependent gate is well supported. Subsequent repression uses the general chromatin and transcriptional machinery, recruited in the context of the mesodermal regulatory network.

PubMed+2

### 3C. Definitive endoderm → gut tube and associated organs

Distinctive OCT4-dependent mechanism identified

This is probably the most interesting lineage from the perspective of your question.

The endodermal differentiation battery includes:

- SOX17
    
- FOXA2
    
- GATA4
    
- GATA6
    

However, OCT4 participates in establishing the endodermal programme itself.

Ying et al. (2015), OCT4 Coordinates with WNT Signaling to Pre-pattern Chromatin at the SOX17 Locus during Human ES Cell Differentiation into Definitive Endoderm. Stem Cell Reports. [DOI: 10.1016/j.stemcr.2015.08.014](https://doi.org/10.1016/j.stemcr.2015.08.014?utm_source=chatgpt.com).

Their findings are quite revealing:

1. OCT4 levels increase transiently during the first 24 hours of endoderm differentiation.
    
2. OCT4 occupancy increases at SOX17 and FOXA2 regulatory regions.
    
3. OCT4 associates with β-catenin during differentiation.
    
4. WNT stimulation is required for the enhanced OCT4 occupancy.
    
5. PRC2 and H3K27me3 are removed from endoderm-associated regulatory regions.
    
6. Subsequent endoderm induction proceeds.
    

Knocking down OCT4 interferes with mesendoderm formation and the removal of H3K27me3 from the SOX17 promoter.

The mechanism is therefore particularly interesting: OCT4 initially helps establish the chromatin conditions necessary for the endodermal differentiation programme. Its own expression subsequently falls as the lineage becomes specified.

PMC+1

Definitive endoderm later generates:

- Foregut
    
- Midgut
    
- Hindgut
    

These produce the gastrointestinal epithelium, liver, pancreas, respiratory epithelium and associated organs.

I would distinguish the initial definitive-endoderm transition, for which we have a fairly detailed OCT4–WNT–PRC2 mechanism, from the subsequent organ-specific differentiation programmes. The latter have their own transcriptional networks, while the general machinery for repressing early developmental and pluripotency genes remains available.

## Stage IV. Germline specification: the unusual branch

The germline deserves its own category because its relationship with pluripotency is different.

Human primordial germ cells arise from posterior epiblast-associated precursors around gastrulation.

The critical human PGC specification network includes:

- SOX17
    
- PRDM1 / BLIMP1
    
- TFAP2C
    
- NANOG
    
- OCT4
    

Irie et al. (2015), SOX17 Is a Critical Specifier of Human Primordial Germ Cell Fate. Cell. [DOI: 10.1016/j.cell.2014.12.013](https://doi.org/10.1016/j.cell.2014.12.013?utm_source=chatgpt.com).

This study established a particularly interesting division of labour:

SOX17 specifies human germline fate. BLIMP1 represses endodermal and other somatic genes during germline specification.

The resulting human primordial germ-cell-like cells express OCT4 and NANOG, while SOX2 is downregulated.

The temporal expression profiles are especially revealing. OCT4 and NANOG initially decline in the differentiating embryoid population, followed by their enrichment and re-expression in BLIMP1-positive germline cells.

PRDM14 also undergoes an unusual trajectory, with an initial reduction followed by later expression.

This is a specialised route in which selected pluripotency-associated factors are retained or reactivated while the germline-specific programme develops.

PMC+1

Human and mouse germline specification also differ substantially. SOX17 is central to human PGC specification, whereas the mouse uses a different regulatory arrangement.

Tang et al. (2016), Specification and epigenetic programming of the human germ line. Nature Reviews Genetics. [DOI: 10.1038/nrg.2016.88](https://doi.org/10.1038/nrg.2016.88?utm_source=chatgpt.com).

Human PGCs undergo extensive DNA demethylation and chromatin reorganisation. This erases substantial amounts of inherited epigenetic information and prepares the germline for its subsequent developmental programme.

Nature Reviews Genetics+1

Later differentiation into oogonia, oocytes or male germ-cell lineages involves another major programme of transcriptional and epigenetic changes. PGC specification itself therefore should be treated as a distinct developmental transition rather than a conventional somatic pluripotency shutdown.

# 3. Consolidated MECE map

Here is the developmental hierarchy, including the best-supported silencing mechanisms and the main knowledge gaps.

|Developmental stage|Emerging lineage|Relevant differentiation factors / repressors|Pluripotency shutdown|
|---|---|---|---|
|Blastocyst|Trophectoderm|GATA2, GATA3, TFAP2A, TFAP2C, CDX2|Direct OCT4 repression by TEtra network|
|Blastocyst|Hypoblast|GATA6, SOX17, GATA4|Segregation from NANOG-positive epiblast; direct repressors incompletely resolved|
|Blastocyst|Epiblast|OCT4, SOX2, NANOG|Maintained|
|Implantation|Formative/postimplantation epiblast|Changing signalling and transcriptional networks|Progressive pluripotency-state transition|
|Implantation|Amnion|BMP–SMAD, TFAP2A, ISL1, GATA3|NANOG declines; OCT4 can persist|
|Gastrulation|Neural ectoderm|NANOG reduction, neural differentiation network|OCT4 silenced; SOX2 retained|
|Gastrulation|Neural crest|NANOG reduction, TFAP2A, SOX9, FOXD3|Pluripotency programme progressively suppressed|
|Gastrulation|Mesoderm|SOX2/SOX3 reduction, T/BRA, EOMES, MIXL1|Sequential loss of core factors|
|Gastrulation|Definitive endoderm|OCT4–WNT/β-catenin, SOX17, FOXA2, GATA4/6|OCT4 initially participates in induction, followed by shutdown|
|Gastrulation|Primordial germ cells|SOX17, BLIMP1, TFAP2C|OCT4 and NANOG retained/re-expressed; SOX2 repressed|
|Organogenesis|Terminal somatic lineages|Tissue-specific transcriptional networks|Progressive consolidation using lineage-dependent chromatin mechanisms|

This is exhaustive at the major developmental branch points. Within each branch, the hundreds of later cell types progressively acquire additional regulatory modules. The evidence does not support assigning one uniquely identified pluripotency silencer to every terminal cell type.

# 4. Papers I would prioritise

These are particularly useful for developing a molecular model of pluripotency shutdown.

|Paper|What it establishes|
|---|---|
|Wang et al., 2012. [Cell Stem Cell](https://doi.org/10.1016/j.stem.2012.02.016?utm_source=chatgpt.com)|Different anti-lineage functions of OCT4, NANOG and SOX2|
|Xu et al., 2009. [Cell](https://doi.org/10.1016/j.cell.2009.02.038?utm_source=chatgpt.com)|Shared miR-145-mediated repression of OCT4, SOX2 and KLF4|
|Krendl et al., 2017. [PNAS](https://doi.org/10.1073/pnas.1708341114?utm_source=chatgpt.com)|Direct coupling of trophoblast specification to OCT4 suppression|
|Xie et al., 2013. [Cell](https://doi.org/10.1016/j.cell.2013.04.022?utm_source=chatgpt.com)|Genome-wide epigenomic differences across human mesendoderm, neural, trophoblast-like and mesenchymal lineages|
|Ying et al., 2015. [Stem Cell Reports](https://doi.org/10.1016/j.stemcr.2015.08.014?utm_source=chatgpt.com)|OCT4–WNT–PRC2 cooperation during endoderm induction|
|Madrigal et al., 2023. [Nature Communications](https://doi.org/10.1038/s41467-023-36116-9?utm_source=chatgpt.com)|Temporal order of SOX2, OCT4 and NANOG decline during human mesendoderm differentiation|
|Irie et al., 2015. [Cell](https://doi.org/10.1016/j.cell.2014.12.013?utm_source=chatgpt.com)|Human germline specification, BLIMP1-mediated somatic repression and pluripotency-factor re-expression|
|Barrand & Collas, 2010. [BBRC](https://doi.org/10.1016/j.bbrc.2009.11.134?utm_source=chatgpt.com)|Different chromatin mechanisms at OCT4, NANOG and SOX2|
|Katznelson et al., 2026. [Nature Communications](https://doi.org/10.1038/s41467-026-76015-3?utm_source=chatgpt.com)|ERH and repression of pluripotency and alternative-lineage programmes across differentiation|

For the broader conceptual framework, I would also keep Theunissen and Jaenisch (2017), [Mechanisms of gene regulation in human embryos and pluripotent stem cells](https://doi.org/10.1242/dev.157404?utm_source=chatgpt.com), alongside these primary studies.

PubMed+3

# 5. A particularly interesting implication

There is an asymmetry in how the developmental system handles pluripotency.

The initial core network is itself responsible for preventing premature activation of differentiation programmes. OCT4, SOX2 and NANOG have different inhibitory effects on different fates.

As development proceeds, individual lineage programmes exploit those differences to initiate the transition. The subsequent disappearance of the original network involves additional regulatory mechanisms, including miRNAs, Polycomb, DNA methylation and chromatin remodelling.

This creates a developmental sequence with three distinguishable molecular events:

1. Release of a particular lineage from inhibition. For example, SOX2 reduction permits primitive streak specification, while NANOG reduction permits neural differentiation.
    
2. Activation of the lineage-specific transcriptional programme. Examples include GATA2/3 and TFAP2A/C in trophoblast, SOX17 in definitive endoderm, and SOX17–BLIMP1 in human germline.
    
3. Consolidation of the new regulatory state. Different combinations of promoter methylation, H3K27me3, H3K9me3, enhancer remodelling and post-transcriptional repression progressively restrict access to the original pluripotency programme.
    

The germline demonstrates how selectively this process can operate: it preserves or reactivates OCT4 and NANOG while repressing SOX2 and installing a germline-specific transcriptional network.

One particularly promising research question is whether the lineage-specific transcription factors primarily initiate pluripotency shutdown, while shared chromatin-maintenance machinery subsequently makes that shutdown durable. The TEtra experiments, the OCT4–WNT–PRC2 endoderm experiments and the 2026 ERH study provide three complementary experimental entry points into that problem.

1. **The Role of miR-145 (Xu et al., 2009):**
    
    - Correction: While miR-145 directly targets the 3′ UTRs of OCT4, SOX2, and KLF4, functional genetic studies have shown that microRNAs act as **kinetic buffers / noise filters**, not master switches. When the miR-145 or Dicer machinery is knocked out, human ESCs still shut down pluripotency and differentiate in response to lineage signals; they simply display delayed kinetics and noisier, less uniform transitions.
        
2. **Promoter Methylation Status (Barrand & Collas, 2010):**
    
    - Correction: That 2010 BBRC study suggested OCT4 undergoes promoter methylation while NANOG and SOX2 rely only on H3K27me3. Across broader ENCODE, Roadmap Epigenomics, and modern WGBS data:
        
        - Both **OCT4 (POU5F1) and NANOG** promoters undergo dense CpG methylation during terminal somatic differentiation.
            
        - **SOX2** remains distinct because its promoter remains unmethylated and H3K4me3-positive or bivalent (H3K4me3/H3K27me3) across several adult somatic niches (e.g., neural stem cells, bronchial epithelium, lens epithelium) where it retains physiological function.
            
3. **The Multi-Tiered Pluripotency Transition (Naïve**
    
    **`→→`**
    
    **Formative
    
    ```
    →→
    ```
    
    Primed):**
    
    - Correction: Pluripotency shutdown is not a single leap from preimplantation blastocyst into germ-layer gastrulation. It occurs in two distinct tiers:
        
        - **Naïve exit (Pre- to Post-implantation):** Naïve-specific network members (**KLF4, TFCP2L1, ESRRB, ZFP42**) are permanently extinguished during the transition to the formative/primed epiblast.
            
        - **Core exit (Gastrulation):** The core factors (**OCT4, SOX2, NANOG**) transition through different super-enhancer usage before being selectively displaced during germ layer specification.