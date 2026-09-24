---
title: "For developers — Iconoplasm"
description: "How to put Iconoplasm gene cards in your own tools: stable image URLs, a free resolver for symbols and aliases, and CC0 reuse."
date: 2026-09-25
draft: false
schemaType: WebPage
---

# For developers

Every published human gene has a labelled character card, and every card is free to reuse under [CC0](/license). No key, no sign-up.

## One gene, one URL

```
https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp    the labelled card image
https://iconoplasm.brinedew.bio/gene/{HGNC_SYMBOL}         the gene's page
```

Use the official HGNC symbol, for example `TP53`. The image URL is what you want for pathway diagrams, slides and teaching material.

## Symbols, aliases, batches

If your data has aliases or mixed identifiers, resolve them first. Up to 50 per request:

```bash
curl -s https://iconoplasm.brinedew.bio/api/public/v1/images/resolve \
  -H "Content-Type: application/json" \
  -d '{"identifiers": ["TP53", "p53", "MDM2"]}'
```

Each result tells you the canonical symbol, how it matched (`symbol` or `alias`), the gene page and the card image URL. Unknown identifiers come back with `"found": false`. Ensembl, Entrez and UniProt IDs are not supported yet; map them to HGNC symbols first.

The full schema is in the [OpenAPI document](https://iconoplasm.brinedew.bio/api/public/v1/openapi.json).

## The whole catalog

The [sitemap](https://iconoplasm.brinedew.bio/sitemap.xml) lists every published gene page. For bulk use, build the image URLs from the symbols instead of calling the resolver once per gene.

## Fair use of the servers

The images are static and cached; fetch them as often as you like. The resolver is rate-limited, so call it for the identifiers you actually need rather than looping over the whole genome.
