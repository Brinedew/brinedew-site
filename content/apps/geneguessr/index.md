---
title: "GeneGuessr - Daily Protein Guessing Game"
description: "Can you identify the protein from its 3D structure? A daily guessing game where you use clues about domains, pathways, and molecular functions to figure out which gene made the protein."
date: 2025-11-23
draft: false
folderPage: true
tags:
- content/apps
---

<h1 class="sr-only">GeneGuessr - Daily Protein Guessing Game</h1>

<div id="geneguessr-root" data-static="/static/geneguessr"></div>

---

<div class="pg-feedback-card collapsed" id="attribution-card" data-expanded="false">
  <button class="pg-collapse-toggle" aria-expanded="false" aria-controls="attribution-content">
    <span class="pg-collapse-chevron">▶</span>
    <span class="pg-feedback-gene">Attribution & Data Sources</span>
  </button>
  <div class="pg-feedback-content" id="attribution-content" style="display: none;">
    <div class="pg-section">
      <span class="pg-section-label">Protein data:</span> <span class="pg-section-entry"><a href="https://www.uniprot.org/">UniProt</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Gene Ontology:</span> <span class="pg-section-entry"><a href="http://geneontology.org/">GO Consortium</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Domain annotations:</span> <span class="pg-section-entry"><a href="https://www.ebi.ac.uk/interpro/">InterPro</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Pathway data:</span> <span class="pg-section-entry"><a href="https://reactome.org/">Reactome</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Tissue specificity:</span> <span class="pg-section-entry"><a href="https://www.proteinatlas.org/">Human Protein Atlas</a> RNA expression (tau metric)</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">3D structures:</span> <span class="pg-section-entry"><a href="https://www.rcsb.org/">RCSB PDB</a>, <a href="https://alphafold.ebi.ac.uk/">AlphaFold DB</a>, <a href="https://swissmodel.expasy.org/">SWISS-MODEL</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Structure viewer:</span> <span class="pg-section-entry"><a href="https://molstar.org/">Mol*</a> (via <a href="https://github.com/molstar/pdbe-molstar">PDBe integration</a>)</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Similarity embeddings:</span> <span class="pg-section-entry"><a href="https://github.com/JaesikKim/HiG2Vec">HiG2Vec</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Origin age:</span> <span class="pg-section-entry">Litman T & Stein WD (2019). <a href="https://doi.org/10.1053/j.seminoncol.2018.11.002">Obtaining estimates for the ages of all the protein-coding genes...</a> <i>Semin Oncol</i> 46(1):3-9</span>
    </div>
  </div>
</div>
