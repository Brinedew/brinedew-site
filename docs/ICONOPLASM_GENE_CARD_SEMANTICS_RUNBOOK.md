# Iconoplasm gene semantics and discovery runbook

**ARCHITECTURE FENCE [IPD-003]** — Complete canonical gene profiles are
discoverable through one immutable-catalog eligibility contract and frozen,
self-locating prefix ranges. The labelled semantic profile remains a one-to-one
non-visual equivalent of the existing card, never an extra visible SEO product.

## Why this exists

The card deliberately presents facts as a compact physical label: a person can
associate a handwritten note, selected field, and molecular origin at a glance.
DOM readers and AI browsing agents instead received an unlabeled stream of text.
The shared renderer now emits one semantic profile using a heading and a
definition list. Every two-part visual field is one explicit directional
mapping—for example, molecular category → character sex and PFAM clan →
character aesthetic—so non-visual readers never have to infer a relationship
from nearby text. It carries the exact card facts without adding visual
duplication.

## Boundaries that must move together

The semantic profile is rendered by
`shared/iconoplasm-card/shared-card-runtime.js` and styled with the standard
visually-hidden, accessibility-tree-preserving rule in
`shared/iconoplasm-card/shared-card-label.css`. The same renderer supplies both
the Worker-generated first HTML and the hydrated client card; do not create a
second server-only or client-only fact mapper.

IPD-003 supersedes IPD-002's obsolete blanket-noindex premise. A current
canonical catalog record with a full name and published lead portrait is
eligible only when the shared renderer also emits its labelled semantic
profile. Eligible pages omit both robots directives. Aliases redirect
permanently, known incomplete records remain noindex, and unknown symbols return
a real 404 instead of the application shell.

The same predicate owns response headers, HTML metadata, `/genes` membership,
gene sitemap shards, and tests. Never update just one of those surfaces.

## Frozen range contract

`workers/iconoplasm-gene-discovery.js` contains the deliberate range table for
the stable 19,023-gene inventory. `/genes` links every leaf directly under its
initial letter, and each range page contains ordinary server-rendered links to
canonical profiles. For example, TP53 is always `/genes` → `TO–TR` → TP53.

The range table is not generated at request or publication time. Numeric pages
and automatic count rebalancing are prohibited because an agent with a known
symbol must determine the correct link without guessing a page number. Routine
catalog or portrait publications update range contents but not boundaries. An
unmatched or multiply matched eligible symbol is a failed inventory migration
and must stop release work until a deliberate rebaseline updates the table,
documentation, sitemap expectations, and tests together.

Archive and sitemap requests read the shared versioned KV catalog artifact.
They must never add an on-request whole-catalog D1 scan.

## Safe changes

When a visible card field changes, update the canonical resolver and semantic
profile together, then run the semantic-card and SEO discovery tests. Keep the
profile a normal semantic `<section>` with labelled `<dt>` and `<dd>` pairs;
never use `display: none`, `hidden`, `visibility: hidden`, or `aria-hidden`,
because those erase it from the accessibility tree.

Indexability changes are atomic discovery migrations: revise this fence, the
range contract, sitemap and `llms.txt`, robots headers, metadata, tests, and
release verification together. Do not add visible derivation prose to gene
pages; the visual card already serves human readers and the semantic definition
list serves non-visual readers.
