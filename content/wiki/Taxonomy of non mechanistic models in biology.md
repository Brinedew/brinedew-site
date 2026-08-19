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

**Mechanistic models** in molecular cell biology explain complicated phenomena like nutrient sensing or apoptosis by decomposing them into: 
* the molecules (receptor A, kinase B, cell membrane...)
* how these molecules act on each other (A dimerizes, B phosphorylates C, D undergoes conformation change...)

A circle-and-arrow chart of these molecules is called the mechanism. Knowing mechanisms is useful for many things, like for example picking targets for a therapeutic intervention.

In contrast, many other models are **non-mechanistic**. Non-mechanistic models abstract away molecules and interactions because they are unknown, irrelevant, or too complicated to model. 
Instead, these models introduce higher-level abstractions. These abstractions are also useful to know.

| Biological problem                                  | Modeled abstraction                       | Modeling method                                               | What is inferred                                        | Why it is non-mechanistic                                                                              |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Ligand changes cellular response                    | Input-output transfer function            | Hill curve, spline, Gaussian process                          | EC50, response ceiling, response steepness              | Does not specify receptor, kinase, transcription-factor, or feedback machinery                         |
| Protein disappears after synthesis is blocked       | Effective abundance-decay process         | Exponential or biexponential decay                            | Apparent half-life, decay rates                         | Collapses degradation pathways, compartments, binding states, and synthesis history                    |
| Cells increase in number                            | Effective population growth rate          | Exponential, logistic, Gompertz model                         | Growth rate, carrying capacity-like parameter           | Does not represent the cell-cycle control network producing division                                   |
| Drug combinations alter viability                   | Drug-response surface                     | Bliss, Loewe, ZIP, response-surface regression                | Synergy or antagonism                                   | Represents interaction at the phenotype level rather than molecular interaction                        |
| Sequence variants have different activities         | Sequence-to-fitness function              | Linear model, Gaussian process, random forest, neural network | Predicted activity of unseen variants                   | Can predict function without representing structure or molecular chemistry                             |
| Enhancers produce different expression levels       | Sequence-to-expression function           | Regression, CNN, transformer                                  | Regulatory activity from sequence                       | Leaves transcription-factor binding, nucleosome dynamics, looping, and transcription kinetics implicit |
| Thousands of genes covary across cells              | Low-dimensional cell state                | PCA, factor analysis, variational latent-variable model       | Latent axes such as activation or differentiation state | State dimensions summarize many causal molecular processes                                             |
| Cells form recognizable transcriptional groups      | Discrete cell-state classes               | Mixture model, graph clustering, classifier                   | Cell type or state assignment                           | Classification can work without identifying what generates each state                                  |
| Cell states seem ordered through differentiation    | Position along a developmental trajectory | Principal curve, diffusion pseudotime, graph trajectory       | Relative progression through a state transition         | Ordering cells does not specify what molecular network drives progression                              |
| Perturbing genes changes a phenotype                | Gene-to-phenotype effect                  | Regression, generalized linear model, hierarchical model      | Effect size of each perturbation                        | Establishes intervention-response relationships without filling in intermediate molecular steps        |
| Pairs of gene perturbations behave unexpectedly     | Genetic interaction function              | Interaction regression, epistasis score                       | Synthetic lethality, suppression, enhancement           | Characterizes causal relations at the gene level without specifying molecular mediation                |
| Many molecular features correlate with age          | Effective biological-age coordinate       | Penalized regression, random forest, neural network           | Predicted chronological or biological age               | Age predictor need not encode any causal theory of aging                                               |
| Cell morphology changes under perturbation          | Morphological phenotype space             | Embedding model, classifier, nearest-neighbor model           | Phenotypic similarity or class                          | Images are mapped to phenotype without reconstructing molecular causes                                 |
| Expression profiles predict treatment response      | Molecular-state-to-outcome function       | Logistic regression, random forest, neural network            | Drug response, survival, subtype                        | Correlational or predictive mapping can succeed with causal pathway structure unresolved               |
| Cells fluctuate between recurrent phenotypic states | Effective state-transition process        | Markov model, hidden Markov model                             | Transition probabilities and dwell times                | Specifies state dynamics without specifying the molecular circuitry generating transitions             |
| A signaling output oscillates                       | Effective oscillator                      | Sinusoidal fit, autoregressive model, state-space model       | Period, phase, damping, coherence                       | Describes temporal behavior without representing the feedback loop producing it                        |
