# Iconoplasm card publication

This document defines the publication boundary. Version numbers, object layouts,
batch sizes, and cache mechanisms belong in code and tests.

## One published canon

<!-- ARCHITECTURE FENCE [IPD-011] -->

One committed publication head selects the immutable public record for every
gene. That record owns the public character data, selected source portrait, and
canonical blot identity.

Public site, extension, archive, APIs, portraits, blots, metadata, and sitemaps
must resolve through that same head. A copied CDN object may accelerate delivery
but cannot select a different version.

## Publication behavior

A publication:

1. begins from durable authoring or voting state;
2. prepares and verifies the changed immutable artifacts;
3. records a complete internally consistent release;
4. advances the public head only after required bytes are readable;
5. leaves the previous coherent release usable during failure.

Routine publication is incremental. A vote or small authoring change does not
justify rebuilding the corpus.

## Reader behavior

<!-- ARCHITECTURE FENCE [IPD-008] -->

A reading context adopts one coherent publication. Rich detail and portrait
delivery may proceed independently, but both must identify the same published
record.

An open article may retain its current publication. A new article or reload
performs a bounded head check and reuses unchanged immutable data. Readers do not
poll continuously or repair publication.

Anonymous reads never fall back to mutable D1, Durable Object, Queue, session,
or administrator state.

## Mutation behavior

Votes and authoring actions are accepted into their durable command owners.
Publication is a derived consequence, not part of the request transaction.

Repeated changes may be coalesced. The system must preserve the accepted action,
eventual publication intent, and final deterministic winner without requiring
one queue message or one full release per action.

## Failure behavior

- Missing new bytes do not advance the head.
- A partial release never becomes public.
- A failed accelerator uses the canonical byte-equivalent path when available.
- Missing current data may retain a coherent prior publication.
- A disagreement between record identity and media identity fails closed.
- Retrying publication is idempotent and resumes bounded work.

## Verification

A release claim requires:

- the exact source and deployed revisions;
- the committed publication head;
- verified immutable record and media identity;
- fresh anonymous reads for at least two genes;
- agreement across site and extension-facing contracts;
- one relevant mutation-to-publication check when mutation behavior changed;
- provider-operation evidence when the change affects capacity.

Local tests, source deployment, head advancement, CDN propagation, and verified
reader behavior are separate gates.

## What is not a requirement

This contract does not require a particular:

- storage provider or object directory;
- manifest, directory, shard, or delta format;
- cache lifetime or local database;
- publication batch size or schedule;
- queue topology;
- number of reads or writes per action.

Those mechanisms may change whenever the replacement preserves one canon,
bounded publication, durable accepted actions, reader availability, and the
free-plan growth boundary.
