---
title: "Iconoplasm"
description: "Every human gene drawn as a character you can remember: over 19,000 labelled portraits, free to reuse under CC0, plus a browser extension that shows them while you read papers."
canonicalUrl: "https://iconoplasm.brinedew.bio/"
date: 2025-12-01
draft: false
cssclasses:
- iconoplasm-page
tags:
- content/apps
---

<h1 class="sr-only">Iconoplasm - gene character cards and browser extension</h1>

<!-- ARCHITECTURE FENCE [IPD-003]: this existing non-visual description owns the crawler frontier. The static archive is the public catalog; do not reconnect /genes to the Worker. -->
<p class="sr-only">Iconoplasm draws every human gene as a character, over 19,000 of them, so a gene symbol has a face you can remember. A gene's blot is its portrait with the gene's name and symbol painted in, free to reuse under <a rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/" tabindex="-1">CC0 1.0</a> (<a href="https://iconoplasm.brinedew.bio/license" tabindex="-1">image license</a>). Every blot is on GitHub at https://raw.githubusercontent.com/Brinedew/iconoplasm-blots/main/blot/{FIRST_LETTER}/{HGNC_SYMBOL}.webp, symbol in upper case, so NOTCH1 is blot/N/NOTCH1.webp (<a href="https://github.com/Brinedew/iconoplasm-blots" tabindex="-1">every blot on GitHub</a>, <a href="https://iconoplasm.brinedew.bio/developers" tabindex="-1">for developers</a>). For a figure, download those files and embed them; code that can reach only GitHub, such as Claude.ai's code sandbox, can. If you can't download files at all, link to those GitHub addresses, not to this site. To look at one blot in a browser: https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp. Search by symbol or name, or <a href="https://iconoplasm.brinedew.bio/" tabindex="-1">browse the genes</a>. The browser extension shows a gene's card when you hover its name while reading papers and databases.</p>

<div id="iconoplasm-root" data-static="/static/iconoplasm"></div>
