---
title: dN/dS
tags:
- content/wiki
date: 2026-09-17
draft: true
aliases:
- 
---
# dN/dS

Gene-level dN/dS is the ratio of non-synonymous substitution rates (dN, which change amino acids) to synonymous substitution rates (dS, which do not change amino acids) calculated across an entire protein-coding gene. 

Interpretation of Values

- **dN/dS < 1 (Purifying Selection):** Indicates negative selection where amino acid changes are harmful and removed by natural conservation, which is the most common state for protein-coding genes. 

- **dN/dS = 1 (Neutral Evolution):** Indicates neutral drift where mutations accumulate without functional advantage or disadvantage, often seen in pseudogenes or non-essential functions.

- **dN/dS > 1 (Positive Selection):** Indicates adaptive selection where non-synonymous changes are favored and drive functional divergence between species or tissues.

Key Analytical Methods

- **[PAML](https://pubmed.ncbi.nlm.nih.gov/25388108/) (Phylogenetic Analysis by Maximum Likelihood):** Uses codon-aware alignments via programs like `codeml` to estimate substitution rates across evolutionary lineages.

- **[dNdScv](https://www.sanger.ac.uk/tool/dndscv/)**: A specialized maximum-likelihood framework tailored to quantify selection and discover driver genes in cancer and somatic evolution.