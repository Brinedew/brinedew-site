---
title: Taxonomy of non-mechanistic models in biology
tags:
  - content/wiki
  - taxonomy
date: 2026-08-17
draft: true
aliases:
  -
---
# Taxonomy of non-mechanistic models in biology

**Mechanistic models** in molecular biology express hypotheses with the language of the molecular structure and chemical reactions - dimerization, phosporylation, conformation change and so on. 

In contrast, many other models are **non-mechanistic**. They abstract away chemistry where it's unknown, irrelevant, or too complicated to model.

| Situation                    | Typical non-mechanistic model                 | What the biologist is trying to learn                  |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Dose-response experiment     | Hill curve, sigmoid, spline                   | EC50, dynamic range, cooperativity-like steepness      |
| Protein or RNA turnover      | Exponential decay                             | Half-life                                              |
| Cell proliferation           | Exponential or logistic growth                | Growth rate                                            |
| Time-course omics            | PCA, clustering, trajectory model             | State transitions and correlated programs              |
| RNA-seq                      | Negative-binomial regression                  | Which genes change between conditions                  |
| Single-cell RNA-seq          | Latent-variable model, nearest-neighbor graph | Cell types and states                                  |
| CRISPR screen                | Regression or enrichment score                | Which perturbations affect phenotype                   |
| Drug screen                  | Response-surface model                        | Which compounds work and whether combinations interact |
| Sequence-function experiment | Neural network, random forest, regression     | Predict activity from sequence                         |
| Enhancer assay               | Sequence-to-expression model                  | Which sequences give high expression                   |
| Microscopy                   | Image classifier or segmentation model        | Phenotype from morphology                              |
| Aging                        | Epigenetic clock, transcriptomic clock        | Biological age                                         |
| Cancer                       | Expression signature or mutation classifier   | Prognosis or subtype                                   |
| Protein engineering          | Fitness landscape surrogate                   | Which sequence to synthesize next                      |
| Synthetic biology            | Input-output transfer function                | How a circuit behaves                                  |
| Evolution experiments        | Fitness regression                            | Which variants confer advantage                        |