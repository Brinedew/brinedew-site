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

Two steps: look your genes up once, then embed the `cdn_url` you get back.

**1. Look up.** Send up to 50 names at a time. Official symbols, common aliases, any capitalisation and UniProt accessions all work:

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
          "cdn_url": "https://iconoplasmportraits.b-cdn.net/blots/v1/T/TP53/19cc3b9c…/TP53-iconoplasm-gene-blot.webp",
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

**2. Embed** the `cdn_url` in a page, a wiki or a figure:

```html
<img src="https://iconoplasmportraits.b-cdn.net/blots/v1/T/TP53/19cc3b9c3e65e87f012b2364b0c406a8/TP53-iconoplasm-gene-blot.webp" alt="TP53 as an Iconoplasm character" width="384" height="512">
```

That address comes straight from our CDN and never changes, so the page keeps showing the card you picked, however many people read it.

Just trying it out in a notebook or a slide? `https://iconoplasm.brinedew.bio/blot/TP53.webp` works without a lookup and always shows the current card. Every view of it runs on our server, though, so please don't put it on a page many people will see (see [Using images at scale](#using-images-at-scale)).

## Which approach to use

| You have | Use | Cost to you |
| --- | --- | --- |
| A quick try in a notebook, a slide or a private page | Build the image URL directly: `/blot/{SYMBOL}.webp` (official HGNC symbols only) | Nothing to call, but every view runs on our server |
| Names from papers or datasets: aliases like p53 or IL-1β, UniProt accessions, odd capitalisation | The resolver, up to 50 identifiers per request | 1 request per 50 names |
| Cards on a page many people will see: a lab wiki, a blog post, a published figure | The resolver's `cdn_url` for each card | 1 request per 50 cards, then nothing per view |
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

Every resolver result also gives you two addresses for that exact card, which never change their bytes:

- `cdn_url` is the card on our CDN. **Use this one to embed or mirror.** It is cached for 30 days and costs us nothing per view.
- `immutable_url` is the same file at an address on our own domain, which will keep working if we ever change CDN. Every view of it goes through our server, so use it for links and records, not for images many people will load.

A new card for the same gene gets a new `cdn_url`, so an embedded figure keeps showing the version you picked.

### Using images at scale

The `/blot/` and `immutable_url` addresses are answered by a small program on our side, once per view. The site's free hosting allows about 100,000 of those a day, shared by everyone. A pathway figure of 20 cards on a popular page can use that up in an afternoon.

So for anything many people will see:

1. Resolve your genes once (50 per request) and use each card's `cdn_url`. Views then cost nothing.
2. Or download the images once and serve them from your own site. CC0 means you may.

Please don't point a popular page at `/blot/{SYMBOL}.webp`. It is for trying things out and for small, private use.

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
curl -s https://iconoplasm.brinedew.bio/api/public/v1/metadata | jq -r '.urls.catalog_jsonl_cdn'
curl -sO "$(curl -s https://iconoplasm.brinedew.bio/api/public/v1/metadata | jq -r '.urls.catalog_jsonl_cdn')"
```

Each line:

| Key | Meaning |
| --- | --- |
| `s` | HGNC symbol. For the labelled card, resolve symbols in batches of 50 and use each `cdn_url` (about 380 requests for the whole catalogue). |
| `n` | Full gene name. |
| `u` | UniProt accession, when there is one. |
| `c` | The character's signature colour (hex). |
| `p` | The unlabelled portrait: `renditions.full`, `.medium`, `.thumb`. Each has a `cdn_url` (download from here) and a `canonical_url` on our domain. |

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
