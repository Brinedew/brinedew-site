---
title: Novak–Tyson model
tags:
- content/wiki
date: 2026-06-21
draft: true
aliases:
- 
---
# Novak–Tyson model

The **Novak–Tyson model** is a mathematical and computational framework that describes the biochemical network regulating the eukaryotic cell cycle, specifically the transitions into and out of mitosis (M-phase). Developed by biochemist Béla Novák and mathematical biologist John J. Tyson in 1993, the model simulates how cells coordinate growth and division. By representing biochemical interactions as a system of non-linear ordinary differential equations, the model tracks the concentrations and activity levels of key regulatory proteins, particularly the M-phase promoting factor (MPF). The initial iteration of the model focused on _Xenopus_ (frog) egg extracts and embryos, and subsequent versions were adapted to model cell division in yeast and mammalian cells.

At the core of the model is the concept of a bistable biochemical switch driven by positive and negative feedback loops. The entry into mitosis is governed by MPF, a protein complex composed of cyclin and a cyclin-dependent kinase. MPF promotes its own activation by activating its activator, the phosphatase Cdc25, and inhibiting its inhibitor, the kinase Wee1. These mutual feedback loops create a mathematical state known as bistability, meaning that at certain protein concentrations, the system can exist in one of two stable states: a low-activity state (interphase) or a high-activity state (mitosis). The transition between these states exhibits hysteresis, where the cell requires a high threshold of cyclin to trigger cell division, but a much lower threshold to remain in division once started. This mechanism ensures that the transition is rapid, decisive, and irreversible under normal physiological conditions.

Prior to the model's publication, cell biologists debated whether the cell cycle progressed through a gradual, continuous accumulation of signals or via sudden, switch-like transitions. The Novak–Tyson model provided a mathematical explanation for the latter, showing how a continuous increase in cyclin could trigger an abrupt, digital-like entry into mitosis. The model has been validated by experimental studies using cell-free extracts and genetically modified organisms. In particular, experiments on mutant strains of fission yeast (_Schizosaccharomyces pombe_) lacking specific regulatory enzymes, such as Wee1, demonstrated cell-cycle behaviors that matched the model's quantitative predictions. Beyond its application to mitosis, the Novak–Tyson model served as an early framework in systems biology for describing cellular checkpoints as dynamical systems, influencing subsequent mathematical models of DNA replication, cellular differentiation, and apoptosis.