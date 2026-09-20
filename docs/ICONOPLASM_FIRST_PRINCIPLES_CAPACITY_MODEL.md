# Iconoplasm capacity testing guide

This is a testing guide, not a product specification.

The product requirement is defined in
[ICONOPLASM_PRODUCT_OPERATING_MODEL.md](ICONOPLASM_PRODUCT_OPERATING_MODEL.md):
support 10,000 daily active readers on the current Cloudflare Free allowances
without losing accepted actions, splitting canon, or making reading depend on
the mutation plane.

No workload mix or provider-operation count in a test becomes a requirement.

## What a capacity test is for

A capacity test answers a dated question about one implementation:

> Given these declared reader journeys, failure conditions, and provider
> allowances, what runs out first and what does a person experience?

The answer is evidence for changing or keeping that implementation. It is not a
reason to preserve the implementation, the test inputs, or the observed cost
shape forever.

## Required dimensions

A useful whole-product assessment varies at least:

- anonymous and authenticated reading;
- light and heavy discovery;
- ordinary and concentrated voting;
- unchanged and frequently changing canon;
- warm, cold, and evicted caches;
- healthy Bunny delivery, partial failure, and full first-party fallback;
- steady arrivals, bursts, retries, and UTC reset boundaries;
- concurrent website, extension, workstation, and scheduled activity.

Each run must state its own assumptions. Do not copy percentages from a previous
report merely because they are already written down.

## Resource accounting

Use the provider's current documented allowances and the account's fresh
telemetry. Count the resources the implementation actually uses, including
indexes, retries, duplicate origins, background work, and uncertain
reservations.

Do not infer capacity from:

- yesterday's low traffic;
- a warm-cache benchmark;
- one successful user operation;
- nominal rows returned instead of rows scanned or written;
- a local arithmetic model after the architecture changed;
- provider enforcement lag beyond a documented limit.

The executable scenario model is:

```powershell
pnpm run model:iconoplasm-capacity
```

The release-oriented checks are:

```powershell
pnpm run gate:iconoplasm-viral-load
pnpm run test:architecture-fences
```

These tools encode hypotheses. When their assumptions become wrong, update or
delete them. Never update the product requirement to match a convenient model.

## Decision rule

Use one of three conclusions:

### Architecture sound

Choose this only when ordinary reader journeys are bounded by construction,
anonymous reads avoid mutable state, accepted mutations have durable admission,
and the tested target retains meaningful headroom in every independent
allowance.

### Targeted structural repair

Choose this when the durable architecture is appropriate but a particular
schema, index, route, retry loop, projection, or scheduler amplifies work.
Replace that mechanism without rewriting the product around it.

### Fundamental rework

Choose this when a normal product action inherently requires corpus-scale work,
multiple authorities on the hot path, continuous reader polling, or more than a
hard allowance even after straightforward batching and indexing.

Missing or stale telemetry prevents a supported-capacity claim. It does not by
itself prove that the architecture is unsound.

## Evidence record

Store load-run inputs and receipts under the task's evidence directory or CI
artifacts. A useful record contains:

- source and deployed revisions;
- timestamp and provider/account scope;
- declared journeys and arrival pattern;
- measured provider operations, latency, failures, and remaining headroom;
- user-visible degradation;
- conclusion and the exact implementation decision it supports.

Linear owns current work and decisions. Git history owns old experiments.
Neither old issue prose nor this guide is a tomb for retired assumptions.
