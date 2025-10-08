---
title: "Proteindle"
description: "Daily protein guessing game"
date: 2025-10-08
draft: false
tags:
- content/apps
---

<div id="proteindle-root"></div>

<script type="module">
  // Load CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/proteindle/styles.css';
  document.head.appendChild(link);
  
  // Load and execute JS
  const script = document.createElement('script');
  script.src = '/static/proteindle/app.js';
  document.body.appendChild(script);
</script>

---

**Attribution:** GO-Slim terms derived from biological process annotations. Protein metadata from [UniProt](https://www.uniprot.org/). Domain information from InterPro. See [/About](/About) for full licensing details.
