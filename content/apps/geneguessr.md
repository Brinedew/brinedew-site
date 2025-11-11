---
title: "Geneguessr"
description: "Daily protein guessing game"
date: 2025-10-08
draft: false
tags:
- content/apps
aliases:
- /apps/geneguessr/index
- /apps/geneguessr/index.html
---

<div id="geneguessr-root" data-static="../static/geneguessr"></div>

---

<div class="pg-feedback-card collapsed" id="attribution-card" data-expanded="false">
  <button class="pg-collapse-toggle" aria-expanded="false" aria-controls="attribution-content">
    <span class="pg-collapse-chevron">▶</span>
    <span style="font-weight: 700; font-size: 1rem;">Attribution & Data Sources</span>
  </button>
  <div class="pg-feedback-content" id="attribution-content" style="display: none;">
    <div class="pg-section">
      <span class="pg-section-label">Function:</span> <span class="pg-section-entry">Gene Ontology (GO-Slim biological process annotations)</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Domains:</span> <span class="pg-section-entry"><a href="https://www.ebi.ac.uk/interpro/">InterPro</a> database</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Tissue specificity:</span> <span class="pg-section-entry"><a href="https://www.proteinatlas.org/">Human Protein Atlas</a></span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Properties:</span> <span class="pg-section-entry"><a href="https://www.uniprot.org/">UniProt</a> (transmembrane/secreted classification)</span>
    </div>
    <div class="pg-section">
      <span class="pg-section-label">Length:</span> <span class="pg-section-entry"><a href="https://www.uniprot.org/">UniProt</a> (amino acid count)</span>
    </div>
  </div>
</div>

<script>
// Add collapse functionality to attribution card (IIFE to attach immediately)
(function() {
  function attachToggle() {
    const toggle = document.querySelector('#attribution-card .pg-collapse-toggle');
    if (toggle && !toggle.dataset.listenerAttached) {
      toggle.dataset.listenerAttached = 'true';
      toggle.addEventListener('click', function() {
        const card = document.getElementById('attribution-card');
        const content = document.getElementById('attribution-content');
        const chevron = card.querySelector('.pg-collapse-chevron');
        const currentlyExpanded = card.dataset.expanded === 'true';
        const newExpanded = !currentlyExpanded;
        
        card.classList.toggle('expanded', newExpanded);
        card.classList.toggle('collapsed', !newExpanded);
        card.dataset.expanded = newExpanded;
        toggle.setAttribute('aria-expanded', newExpanded);
        chevron.textContent = newExpanded ? '▼' : '▶';
        content.style.display = newExpanded ? 'block' : 'none';
      });
    }
  }
  
  // Try immediately
  attachToggle();
  
  // Also try after DOMContentLoaded in case it hasn't fired
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToggle);
  }
})();
</script>




