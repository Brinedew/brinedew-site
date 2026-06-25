---
title: Causal inference frameworks in biology
tags:
  - content/wiki
date: 2026-06-25
draft: true
aliases:
  -
---
# Causal inference frameworks in biology

I noticed that when doctors, economists, and computer scientists try to reason about the effects of genes, their thinking bottoms out in probabilities or effect sizes. Something like "this gene causes you to have 50% higher risk of cancer" or "these alleles will give you +5 IQ points". 

I feel uneasy seeing these kinds of claims, but it's hard to say exactly why. These kinds of causal claims are very different from the ones we make in the lab. If I had to put my finger on it, I'd call them "predictive causality", as opposed to "mechanistic causality".

Different kinds of causal frameworks have already been described by philosophers of science, so let's look at them.

Some of the major frameworks and named approaches are:

|Framework|Main idea|Typical use in biology|
|---|---|---|
|Interventionism (Woodward)|X causes Y if manipulating X changes Y|Knockouts, CRISPR perturbations, drug treatments|
|Manipulationist causation (Pearl/Woodward tradition)|Causation defined through interventions rather than correlations|Genetic perturbation studies|
|Potential Outcomes Framework (Rubin Causal Model)|Compare outcome under treatment vs no treatment|Clinical trials, increasingly genomics|
|Structural Causal Models (Pearl)|Directed acyclic graphs and structural equations|Epidemiology, systems biology, genomics|
|INUS conditions (Mackie)|Cause is an insufficient but necessary part of an unnecessary but sufficient complex|Multifactorial disease causation|
|Mechanistic causation|Explain causal relations by identifying entities and activities producing an effect|Dominant style in molecular biology|
|Probabilistic causation (Suppes)|Causes raise probabilities of effects|Cancer epidemiology, risk factors|
|Counterfactual causation (Lewis)|If X had not occurred, Y would not have occurred|Evolutionary biology, epidemiology|
|Actual causation|Which particular event caused a particular outcome?|Precision medicine, pathology|
|Causal network inference|Infer causal graph from observational data|Transcriptomics, signaling networks|
|Dynamical systems causation|Causation as state transitions in dynamical systems|Developmental biology, physiology|
|Information-theoretic causality|Causal influence measured via information flow|Neuroscience, systems biology|
