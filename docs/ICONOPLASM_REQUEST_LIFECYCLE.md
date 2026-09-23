# Iconoplasm request lifecycle

This document names the current request boundaries. It does not freeze routing,
file names, cache policy, or storage layout.

## Anonymous reading

<!-- ARCHITECTURE FENCE [IPD-009] -->

An anonymous reader receives the application shell and published Iconoplasm
artifacts without consulting mutable application state. The stable
`/blot/{symbol}.webp` alias enters the existing Worker to select the exact
published card and its immutable WebP object. It does not use D1, a session,
or a second publication owner. The shell and immutable artifacts stay static.

The publication system owns one coherent head. Immutable records beneath that
head provide search, gallery, gene dossiers, passive candidate and vote
summaries, portraits, and blots. Bunny may accelerate the same public bytes.
Neither Bunny nor a browser cache chooses canon.

Anonymous reading does not require:

- a session lookup;
- D1, Durable Object, or Queue access;
- a discovery write;
- a publication repair;
- an administrator route.

When current published bytes cannot be verified, the reader retains a coherent
prior publication or receives a static failure state. The request does not
reconstruct canon from mutable state.

## Authenticated actions

Sign-in adds explicit private or mutation requests: personal discovery,
voting, requests, comments, caretaker work, and administration.

Each accepted action is admitted, idempotent, and durable. Its derived public
effect crosses the publication boundary later. Authentication does not create a
different public gene truth.

## Freshness

An open reading context may remain on one coherent publication. A new context or
reload checks for a newer head through a bounded path. It reuses unchanged
immutable bytes.

There is no continuous open-tab freshness requirement and no reader-triggered
whole-catalog repair.

## Failure behavior

- Published reading remains independent from mutation-plane availability.
- A rejected mutation is reported as rejected, never as accepted-but-lost.
- Retriable work has one durable owner and due time.
- Missing or inconsistent publication state fails closed rather than mixing
  versions.
- Provider failure may select a byte-equivalent fallback, not a second canon.

## Verification

Verify anonymous and authenticated paths separately. A useful release check
opens fresh cache-busted contexts for at least two genes, confirms the published
identity and media agree, and then verifies one relevant authenticated action.
Record source revision, deployed revision, publication head, and observation
time separately.
