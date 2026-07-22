# Iconoplasm gene-card semantics runbook

**ARCHITECTURE FENCE [IPD-002]** — Every generated `/gene/<symbol>` page must
contain a labelled, accessible text equivalent of the visual Iconoplasm card,
while remaining a non-indexed application detail route rather than a 20,000-page
search corpus.

## Why this exists

The card deliberately presents facts as a compact physical label: a person can
associate a handwritten note, selected field, and molecular origin at a glance.
DOM readers and AI browsing agents instead received an unlabeled stream of text.
The shared renderer now emits one semantic profile using a heading and a
definition list. It carries the exact card facts (including character and
molecular distinctions) without adding visual duplication.

## Boundaries that must move together

The semantic profile is rendered by
`shared/iconoplasm-card/shared-card-runtime.js` and styled with the standard
visually-hidden, accessibility-tree-preserving rule in
`shared/iconoplasm-card/shared-card-label.css`. The same renderer supplies both
the Worker-generated first HTML and the hydrated client card; do not create a
second server-only or client-only fact mapper.

The presence of structured facts does **not** establish standalone explanatory
content. Until that product decision changes through an explicit migration,
gene routes must keep all of these protections:

- `<meta name="robots" content="noindex,follow,noarchive">` in the rewritten
  HTML;
- `X-Robots-Tag: noindex, follow, noarchive` on `/gene/*` responses; and
- no `/gene/*` entries in Iconoplasm's XML sitemap or `llms.txt`.

## Safe changes

When a visible card field changes, update the canonical resolver and semantic
profile together, then run the semantic-card and SEO discovery tests. Keep the
profile a normal semantic `<section>` with labelled `<dt>` and `<dd>` pairs;
never use `display: none`, `hidden`, `visibility: hidden`, or `aria-hidden`,
because those erase it from the accessibility tree.

If a gene page gains genuine standalone explanatory content, treat indexing as
a product and search-quality migration: revise this fence, the sitemap and
`llms.txt` policy, robots headers, metadata, tests, and release verification in
one review. Do not make that change incidentally while improving card semantics.
