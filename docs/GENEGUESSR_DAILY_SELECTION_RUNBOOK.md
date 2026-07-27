# GeneGuessr daily selection

**ARCHITECTURE FENCE [GG-001]**

## Decision

Automatic daily targets are weighted by normalized `gene_surname`, not by
protein row. Every surname contributes exactly one candidate to the
deterministic daily sequence. The selector then chooses a deterministic member
inside each surname for that date.

This is a two-stage lottery:

1. choose a surname from the set of eligible surnames;
2. choose one eligible protein inside that surname.

A one-member surname and a 400-member surname therefore each occupy one slot.
Manual admin overrides are explicit exceptions and remain authoritative.

## Why this exists

`gene_surname` was added to stop large gene families such as SLC, OR, ZNF, and
KRTAP from dominating selection. The original implementation applied the
two-stage lottery only to practice mode. Daily mode continued hashing across
the flat protein table, which produced three computed SLC targets in July 2026:

- `SLC22A5` on July 3;
- `SLC6A8` on July 25;
- `SLC12A2` on July 26.

All three were automatic picks, not admin overrides.

## Selection contract

- The eligible source query is stable and excludes transient
  `structure_failures`; reachability is verified after selection.
- Surnames are trimmed and normalized to uppercase before grouping.
- Missing surname metadata does not remove a playable protein. That protein is
  temporarily treated as its own one-member family.
- The date and `DAILY_TARGET_SALT` seed a deterministic surname rotation and a
  deterministic representative within every surname.
- The candidate sequence contains exactly one protein per surname.
- AlphaFold-only and unreachable candidates advance through that balanced
  sequence. They must never fall back to the adjacent row in the flat protein
  table.
- A recorded actual target remains authoritative unless the existing
  availability rules permit replacement before the first guess.

## Schedule and release behavior

The admin schedule caches computed future days. Any selection-algorithm change
must increment `ADMIN_SCHEDULE_CACHE_VERSION` so cached previews are recomputed.
The production pre-warm cron and request-time slow path must consume the same
balanced candidate sequence.

After deployment:

1. wait for the deploy workflow to complete;
2. open the live admin panel with a cache-busting URL;
3. verify future computed targets were regenerated;
4. inspect at least one public GeneGuessr page;
5. confirm the live API reports computed picks and overrides accurately.

## Required tests

`workers/lib/daily-selection-pool.test.js` must prove:

- the source pool is ordered and independent of transient structure failures;
- every surname contributes exactly one candidate;
- input ordering does not change the deterministic result;
- a large family's representative changes across dates without adding slots.

`workers/lib/daily-target-availability.test.js` protects the separate structure
availability and recorded-target replacement rules.
