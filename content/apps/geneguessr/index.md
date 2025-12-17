---
title: "GeneGuessr - Daily Protein Guessing Game"
description: "Lunch break riddles for life scientists. Best enjoyed while your Western blot is running."
canonicalUrl: "https://geneguessr.brinedew.bio/"
date: 2025-11-23
draft: false
folderPage: true
tags:
- content/apps
---

<h1 class="sr-only">GeneGuessr - Daily Protein Guessing Game</h1>

<div style="height: 0; overflow: hidden; position: absolute; left: -9999px;" aria-hidden="true">
<h2>How to Play GeneGuessr</h2>
<h3>Welcome to GeneGuessr!</h3>
<p>This is the protein of the day. Can you figure out which gene made it?</p>
<p>You will see spoiler bars that cover valuable hints. Tap the spoiler bar to reveal a hint underneath.</p>
<p>Look up your favorite gene with the search bar. Submit it as your first guess.</p>
<h3>Feedback cards</h3>
<p>Each of your guesses will appear as a feedback card.</p>
<p>The feedback bar percentage shows how close you got.</p>
<p>Look for highlighted properties. They match your target.</p>
<h3>Revealing hints</h3>
<p>It costs 1 hint to remove a spoiler bar. You get +1 hint for each guess.</p>
<p>When the hint is too obvious, the bar stays locked. Just try unlocking another one.</p>
<p>You get to make 10 guesses before the game ends. Feel free to experiment!</p>
</div>

<div id="geneguessr-root" data-static="/static/geneguessr"></div>

---

<div class="pg-feedback-card collapsed" id="sources-card" data-expanded="false">
  <button class="pg-collapse-toggle" aria-expanded="false" aria-controls="sources-content">
    <span class="pg-collapse-chevron">▶</span>
    <span class="pg-feedback-gene">Sources</span>
  </button>
  <div class="pg-feedback-content" id="sources-content" style="display: none;">
    <div class="pg-section">
      <span class="pg-section-label">Protein data:</span> <span class="pg-section-entry"><a href="https://www.uniprot.org/">UniProt</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Gene Ontology:</span> <span class="pg-section-entry"><a href="http://geneontology.org/">GO Consortium</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Domains & clans:</span> <span class="pg-section-entry"><a href="https://www.ebi.ac.uk/interpro/">InterPro</a> / <a href="https://www.ebi.ac.uk/interpro/entry/pfam/">Pfam</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Architecture:</span> <span class="pg-section-entry"><a href="https://www.cathdb.info/">CATH</a></span>
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
      <span class="pg-section-label">Similarity:</span> <span class="pg-section-entry"><a href="https://github.com/JaesikKim/HiG2Vec">HiG2Vec</a>, <a href="https://doi.org/10.6084/m9.figshare.25270126">ESM2</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Origin age:</span> <span class="pg-section-entry">Litman T & Stein WD (2019). <a href="https://doi.org/10.1053/j.seminoncol.2018.11.002">Obtaining estimates for the ages of all the protein-coding genes and most of the ontology-identified noncoding genes of the human genome, assigned to 19 phylostrata</a> <i>Semin Oncol</i> 46(1):3-9</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">First publication year:</span> <span class="pg-section-entry">Zwick ME, Kraemer SA & Carter GW (2019). <a href="https://doi.org/10.1016/j.dib.2019.104770">Dataset of frequency patterns of publications for human protein-coding genes</a>. <i>Data Brief</i> 28:104770</span>
    </div>
  </div>
</div>
