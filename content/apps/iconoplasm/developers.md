---
title: "For developers — Iconoplasm"
description: "Put Iconoplasm gene cards in your own tools: one image URL per gene, a free resolver for aliases and UniProt accessions, a one-file bulk download, and the limits and good practice for each."
date: 2026-09-25
draft: false
schemaType: WebPage
---

# For developers

Iconoplasm draws every human protein-coding gene as a character: 19,023 labelled cards, one per HGNC symbol. Everything on this page is free, needs no key or sign-up, and every image is [CC0](/license). Attribution is welcome but not required.

## Quickstart

Show a gene card in a page, a notebook or a slide:

```html
<img src="https://iconoplasm.brinedew.bio/blot/TP53.webp" alt="TP53 as an Iconoplasm character" width="384" height="512">
```

Turn names from your data (aliases, mixed case, UniProt accessions) into card URLs:

```bash
curl -s https://iconoplasm.brinedew.bio/api/public/v1/images/resolve \
  -H "Content-Type: application/json" \
  -d '{"identifiers": ["p53", "MDM2", "P38398"]}'
```

```json
{
  "api_version": "v1",
  "max_symbols": 50,
  "results": [
    {
      "requested": "p53",
      "found": true,
      "canonical_symbol": "TP53",
      "matched_by": "alias",
      "page_url": "https://iconoplasm.brinedew.bio/gene/TP53",
      "images": {
        "gene_blot": {
          "canonical_url": "https://iconoplasm.brinedew.bio/blot/TP53.webp",
          "immutable_url": "https://iconoplasm.brinedew.bio/blots/v1/T/TP53/19cc3b9c…/TP53-iconoplasm-gene-blot.webp",
          "width": 768,
          "height": 1024,
          "rights": "CC0 1.0 Universal",
          "attribution_required": false
        }
      }
    }
  ]
}
```

(Trimmed. Results come back in the order you sent them, one per identifier.)

## Which approach to use

| You have | Use | Cost to you |
| --- | --- | --- |
| A few official HGNC symbols (TP53, BRCA1) | Build the image URL directly: `/blot/{SYMBOL}.webp` | Nothing to call |
| Names from papers or datasets: aliases like p53 or IL-1β, UniProt accessions, odd capitalisation | The resolver, up to 50 identifiers per request | 1 request per 50 names |
| Every gene, or offline use: a mirror, a figure pipeline, an ML dataset | The bulk file: one JSONL download of all 19,023 genes | 1 download (19 MB) |
| A mirror you want to keep current | The bulk file once, then the change feed, polled at most hourly | 1 small request per poll |

Rule of thumb: if you would call the resolver more than about 20 times in a row, download the bulk file instead.

## Images

`https://iconoplasm.brinedew.bio/blot/{SYMBOL}.webp` is the labelled card for a gene. It shows the gene's name and symbol over its character.

- 768 × 1024 WebP, about 140 KB.
- `{SYMBOL}` is the HGNC symbol and is case-insensitive (`tp53` works). It is not an alias: `/blot/p53.webp` is a 404. Resolve aliases first.
- It always serves the gene's **current** card, which can change when the community picks a better one. It is cached for 5 minutes and may be served stale for up to a day while refreshing. It sends an `ETag`, so conditional requests are cheap.
- `Access-Control-Allow-Origin: *`, so you can draw it into a canvas or fetch it from any web page.
- An unknown symbol returns `404` with a small JSON body.

Every resolver result also has an `immutable_url`. That URL never changes its bytes, so you can cache it forever. Use it when you store or embed an exact version, for example in a published figure.

### Using images at scale

The `/blot/` URL is served by a small program on our side for every request. If a page of yours will show many cards to many readers (a pathway figure on a popular site, say), **download the images once and serve them from your own site or CDN**. CC0 means you may. That is faster for your readers and keeps the service free for everyone.

## Resolver

`POST https://iconoplasm.brinedew.bio/api/public/v1/images/resolve`

Request body (JSON), with one of these fields:

| Field | Type | Notes |
| --- | --- | --- |
| `identifiers` | array of strings, 1–50 | Preferred. Any mix of the identifier types below. |
| `symbols` | array of strings, 1–50 | Older name for the same thing. |

What an identifier can be:

| Kind | Example | `matched_by` |
| --- | --- | --- |
| HGNC symbol, any capitalisation | `TP53`, `tp53` | `symbol` |
| Common alias from the literature (about 60 curated, listed in [metadata](https://iconoplasm.brinedew.bio/api/public/v1/metadata) under `publication_aliases`) | `p53`, `pRb`, `IL-1β`, `E-cadherin` | `alias` |
| UniProt accession | `P04637` | `uniprot` |

Not supported yet: HGNC IDs (`HGNC:11998`), Ensembl gene IDs (`ENSG…`), NCBI Gene IDs (`7157`). Map these to HGNC symbols first; they come back as `"found": false`, not as errors.

Each result has:

| Field | Meaning |
| --- | --- |
| `requested` | Exactly what you sent. |
| `found` | `false` means we have no card for it; `canonical_symbol`, `matched_by` and `images` are then `null`. |
| `canonical_symbol` | The HGNC symbol it resolved to. |
| `matched_by` | `symbol`, `alias` or `uniprot`. |
| `page_url` | The gene's page on Iconoplasm. |
| `images.gene_blot` | The card: `canonical_url`, `immutable_url`, `width`, `height`, licence fields. |

Errors:

| Status | When | Body |
| --- | --- | --- |
| `400` | Missing or empty list, or more than 50 | `{"error": "Too many symbols (max 50)", "max_symbols": 50}` |
| `405` | Anything but `POST` | `{"error": "Method not allowed"}` |
| `429` | Rate limit reached (see below) | Problem JSON with `retry_after_seconds` |
| `503` | The card catalogue is briefly unavailable, usually during a publish | Retry after a minute |

The full schema is in the [OpenAPI document](https://iconoplasm.brinedew.bio/api/public/v1/openapi.json).

## Bulk download

The whole catalogue is one JSONL file, one gene per line, about 19 MB. Its URL changes with every release, so read it from the metadata first:

```bash
curl -s https://iconoplasm.brinedew.bio/api/public/v1/metadata | jq -r '.urls.catalog_jsonl'
curl -sO "$(curl -s https://iconoplasm.brinedew.bio/api/public/v1/metadata | jq -r '.urls.catalog_jsonl')"
```

Each line:

| Key | Meaning |
| --- | --- |
| `s` | HGNC symbol. Build the card URL as `https://iconoplasm.brinedew.bio/blot/{s}.webp`. |
| `n` | Full gene name. |
| `u` | UniProt accession, when there is one. |
| `c` | The character's signature colour (hex). |
| `p` | The unlabelled portrait: `renditions.full`, `.medium`, `.thumb`, each with a `canonical_url`. |

The file is immutable: a given URL never changes, and a new release gets a new URL. Metadata also tells you `gene_count`, `released_at` and the release hash, so you can tell whether you already have the latest.

### Staying current

`GET https://iconoplasm.brinedew.bio/api/public/v1/changes?since={cursor}` lists genes whose card, portrait or details changed after `since`, oldest first, 200 per page. Each page has a `next_cursor`; pass it back as `since`.

Start from the `released_at` of the file you downloaded rather than from the beginning of time, and poll at most once an hour.

## Limits

Limits are per client IP address and reset on a rolling 60-second window.

| Endpoint | Requests per 60 s |
| --- | --- |
| `/api/public/v1/images/resolve` | 60 (so up to 3,000 identifiers a minute) |
| `/api/public/v1/changes` | 60 |
| `/api/public/v1/metadata`, `/stats`, `/schema` | 60 |
| `/api/public/v1/dumps/…` (bulk file) | 60 |
| `/api/public/v1/media/{SYMBOL}` | 120 |
| `/blot/{SYMBOL}.webp` | No per-client limit (see "Using images at scale") |

Every rate-limited response carries `ratelimit-policy`, `x-ratelimit-limit` and `x-ratelimit-period` headers. Past the limit you get `429` with `Retry-After` and a JSON body containing `retry_after_seconds`. Wait that long, then continue.

## Good practice

Do:

- Send up to 50 identifiers per resolver request, not one request per gene.
- Cache resolver results. A symbol's card changes rarely, so a day is a sensible cache time for most tools.
- Use the bulk file for anything genome-wide.
- On `429` or `503`, wait (`Retry-After`), then retry with exponential backoff and a little random jitter.
- Send a descriptive `User-Agent` with a contact URL or email, so we can reach you before blocking a runaway script.
- Serve images from your own storage when many people will see them.

Don't:

- Loop over all 19,023 genes through the resolver. It takes over 6 minutes at the limit, and the bulk file is one request.
- Poll the change feed more than hourly, or from the beginning of time on every run.
- Retry a `400` or a `"found": false`. They will not change.
- Resolve aliases by guessing `/blot/{alias}.webp` URLs. Use the resolver.

## Licence and credit

Every card and portrait is dedicated to the public domain under [CC0 1.0](/license): use, modify, embed and sell them without asking. Credit ("Images: Iconoplasm") is appreciated, not required. Please don't suggest that Iconoplasm endorses your product.

## Machine-readable descriptions

- [OpenAPI 3.1](https://iconoplasm.brinedew.bio/api/public/v1/openapi.json) for the resolver.
- [Service metadata](https://iconoplasm.brinedew.bio/api/public/v1/metadata): current release, bulk file URLs, aliases.
- [llms.txt](https://iconoplasm.brinedew.bio/llms.txt): a short text description for AI tools.
