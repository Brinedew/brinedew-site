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

`gene_surname` keeps large gene families such as SLC, OR, ZNF, and KRTAP from
dominating selection. Hashing across the flat protein table instead picks
members of one large family days apart. Practice mode also picks by surname.

## Selection contract

- The eligible source query is stable, excludes AlphaFold-only rows, and does
  not depend on transient `structure_failures`; reachability is verified after
  selection. It runs only to build the stored pool described below.
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

## Pool storage

The playable pool, meaning every surname family and its members in canonical
order, is stored as one row of the GeneGuessr D1 table `daily_selection_pool`.
Every reader takes it from that row: the 23:55 UTC pre-warm, the player path when
no recorded pick exists, the admin schedule and cards views, and the
availability-replacement routes. A read costs one row however large `proteins`
is, and does not depend on which isolate asks. Building it scans `proteins` once
(29,422 rows read for 19,110 proteins on 2026-10-02).

- Columns: `catalog_version`, `fingerprint`, `families_json`, `built_at`.
  `families_json` is `[["SURNAME",["UNIPROT",...]],...]`, families sorted by
  surname and members sorted, exactly the families the lottery walks. The
  fingerprint is computed from those families, so it does not depend on whether
  the pool was just built or read back. The stored row is about 150 KB; D1's row
  limit is 2 MB.
- `workers/lib/protein-store.js` creates the table, its one row and its three
  triggers on first use, in one batch. A normal deploy applies no migration to
  this database, and the maintenance release refuses a migration file that has
  no reviewed cost-plan entry, so there is deliberately no file in `migrations/`
  for it.
- Freshness is automatic. A trigger on `proteins` clears the stored pool and
  bumps `catalog_version` after any insert, any delete, and any update that
  changes `uniprot`, `gene_surname`, `structure_source` or `gene_summary`. Those
  are exactly the columns the source statement reads
  (`DAILY_SELECTION_POOL_SOURCE_COLUMNS`); a test fails if the statement and the
  list disagree. Edits to other columns, structure failures and synonyms leave
  the pool alone.
- The next reader after a clear rebuilds it. A rebuild reads `catalog_version`
  before it scans and stores its result only if the version is unchanged, so a
  catalog write that lands during the scan never leaves a stale pool. Requests
  that arrive during a rebuild in the same isolate share it. A stored row that
  does not parse is rebuilt, never thrown. When D1 cannot be read, selection
  returns no pick and the existing "target unavailable" handling applies; when
  the rebuilt pool cannot be stored, the caller still gets it.
- To force a rebuild by hand: `UPDATE daily_selection_pool SET families_json = NULL
WHERE id = 1`.
- A bulk catalog write costs one extra row written per changed row for the
  trigger. On a local D1 built from the real migrations, a 1,000-row update
  writes 4,000 rows with the search triggers alone and 5,000 with this one.
- Dropping and recreating `proteins` also drops its triggers. Afterwards drop
  `daily_selection_pool` too, so the next reader recreates the table and the
  triggers together.

## Schedule and release behavior

The admin schedule computes future days from the stored playable-family pool
and its fingerprint on every request (one row read). It does not write a per-day
KV cache. The
batch planner and minimal protein-summary query make that cache unnecessary,
while avoiding hundreds of writes against Cloudflare's shared daily KV quota.
The production pre-warm cron and request-time slow path must consume the same
balanced candidate sequence.

An annual admin request computes its primary identities from one in-memory
shuffle-bag plan and bulk-loads only the protein summary projection. It must not
perform one `SELECT *` per day: per-day reads can exhaust the request and come
back as null rows under HTTP 200. If any planned summary is unavailable, the entire
schedule response is HTTP 503 with the missing dates.

Automatic availability pins use the same salt and pool fingerprint. Stale pins
do not survive a picker or pool change. They are lower priority than manual
overrides and recorded actual targets. The admin cards endpoint, tomorrow
pre-warm, and request-time selection must resolve the same pin and preserve its
horizon exclusions if the pinned structure later becomes unavailable.
Pins live in D1, not KV: they must remain writable after unrelated traffic has
exhausted Cloudflare's daily KV write allowance.

Successful browser rendering alone is not enough for a future replacement.
When the `STRUCTURES_BUCKET` R2 binding is configured, the canonical curated
structure is cached in R2, its `pinnedUntil` metadata is extended through the
play date (including rewriting metadata on an existing cached object), and the
metadata is read back before reconciliation accepts the replacement. The binding
is commented out in the Wrangler configs; without it, pinning is skipped and the
replacement needs an upstream structure URL.

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

`workers/daily-selection-pool-cost.test.js` must prove, on a real local D1 built
from the real migrations at production shape (19,110 proteins, 10,312 playable,
3,900 families):

- a cold isolate reads a constant number of rows (two for a pick), and the
  365-day schedule reads the pool in at most four;
- every kind of catalog write that can change eligibility clears the stored pool
  and the next reader rebuilds it exactly, while unrelated writes leave it alone;
- a write that lands inside a rebuild is never hidden behind a stored pool;
- the stored pool gives the fingerprint and the picks the family builders give
  (golden values and a differential check), so availability pins stay valid;
- a missing table, a missing row, a corrupt row, a D1 error on read and on
  persist, an empty catalog, and simultaneous requests are each handled.

`workers/admin-schedule-year.test.js` must prove that the first uncached annual
request returns 365 complete, unique protein and surname identities using bulk
queries, and that missing summaries fail the response closed without caching
partial rows.

`workers/lib/daily-target-availability.test.js` protects the separate structure
availability and recorded-target replacement rules.
