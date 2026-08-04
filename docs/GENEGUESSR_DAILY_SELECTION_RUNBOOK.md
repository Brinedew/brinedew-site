# GeneGuessr daily selection

**ARCHITECTURE FENCE [GG-001]**

## Decision

Automatic daily targets are weighted by normalized `gene_surname`, not by
protein row. Every surname contributes exactly one candidate to the
deterministic daily sequence. The selector then chooses a deterministic member
inside each surname for that date.

This is a two-stage deterministic shuffle-bag:

1. walk every playable surname once, in a salted deterministic permutation;
2. choose one eligible protein inside that surname.

A one-member surname and a 400-member surname therefore each occupy one slot.
Manual admin overrides are explicit exceptions and remain authoritative.
Within one complete surname bag, an automatic family and its UniProt target do
not repeat. On later bag cycles, the representative advances inside each family.

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

- The eligible source query is stable, excludes AlphaFold-only rows, and does
  not depend on transient `structure_failures`; reachability is verified after
  selection.
- Surnames are trimmed and normalized to uppercase before grouping.
- Missing surname metadata does not remove a playable protein. That protein is
  temporarily treated as its own one-member family.
- The date selects a position in the `DAILY_TARGET_SALT`-seeded surname
  shuffle-bag and a deterministic representative within that surname.
- Independent per-date hashing is forbidden because it can repeat a target
  after only a few days. Automatic picks are without replacement for one full
  surname cycle. Overrides and recorded availability replacements are explicit
  exceptions.
- The candidate sequence contains exactly one protein per surname.
- Unreachable candidates may advance through the remaining balanced sequence
  as a recorded availability replacement. They must never fall back to the
  adjacent row in the flat protein table.
- Ahead-of-time horizon reconciliation keeps every valid computed target. A
  failed automatic target is replaced only by a non-AlphaFold candidate whose
  UniProt ID and normalized surname are both outside the complete authoritative
  horizon. This prevents both a direct repeat and a wraparound/member-rotation
  family repeat without cascading later dates.
- A recorded actual target remains authoritative unless the existing
  availability rules permit replacement before the first guess.

## Schedule and release behavior

The admin schedule caches computed future days. The cache entry includes a
fingerprint of the normalized playable family pool; adding, removing, or
reclassifying a protein invalidates the old bag rather than mixing old and new
computed days. Any selection-algorithm change
must increment `ADMIN_SCHEDULE_CACHE_VERSION` so cached previews are recomputed.
The production pre-warm cron and request-time slow path must consume the same
balanced candidate sequence.

An annual admin request computes its primary identities from one in-memory
shuffle-bag plan and bulk-loads only the protein summary projection. It must not
perform one `SELECT *` per day. The latter exhausted the live 2026-08-04 annual
request after 340 future identities and returned the remaining 25 as null rows
under HTTP 200. Only complete day entries may be cached; if any planned summary
is unavailable, the entire schedule response is HTTP 503 with the missing dates.

Automatic availability pins use the same salt and pool fingerprint. Stale pins
do not survive a picker or pool change. They are lower priority than manual
overrides and recorded actual targets. The admin cards endpoint, tomorrow
pre-warm, and request-time selection must resolve the same pin and preserve its
horizon exclusions if the pinned structure later becomes unavailable.

Successful browser rendering alone is not enough for a future replacement.
The canonical curated structure is cached in R2, its `pinnedUntil` metadata is
extended through the play date (including rewriting metadata on an existing
cached object), and the metadata is read back before reconciliation accepts the
replacement.

Recap images are not date-only schedule state. Their immutable storage identity
contains the day, selected UniProt ID, and `DISCORD_RECAP_RENDER_CONTRACT`.
Changing a target therefore makes any prior image an automatic miss. Whenever
the renderer, camera, colouring, or pixel-readiness rules change, increment the
render contract and regenerate the affected catalog from the admin panel.

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
- 365 consecutive automatic picks are unique when at least 365 surnames exist;
- bulk horizon planning yields exactly the same primary identity as the
  canonical one-day picker;
- a large family's representative advances between complete bag cycles without
  adding slots.

`workers/admin-schedule-year.test.js` must prove that the first uncached annual
request returns 365 complete, unique protein and surname identities using bulk
queries, and that missing summaries fail the response closed without caching
partial rows.

`workers/lib/daily-target-availability.test.js` protects the separate structure
availability and recorded-target replacement rules.
