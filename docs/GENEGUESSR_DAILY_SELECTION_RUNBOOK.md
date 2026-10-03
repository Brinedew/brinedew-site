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
members of one large family days apart. Practice mode also picks by surname,
from its own pool (see "Practice pool").

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
- To force a rebuild by hand, of this pool and of the practice pool that counts
  the same version, run the statement the triggers run: `UPDATE
daily_selection_pool SET catalog_version = catalog_version + 1, fingerprint =
NULL, families_json = NULL, built_at = NULL WHERE id = 1`.
- A bulk catalog write costs one extra row written per changed row for the
  trigger. On a local D1 built from the real migrations, a 1,000-row update
  writes 4,000 rows with the search triggers alone and 5,000 with this one.
- Dropping and recreating `proteins` also drops its triggers. Afterwards drop
  `daily_selection_pool` and `practice_selection_pool` too, so the next reader
  recreates the tables and the triggers together.

## Practice pool

Practice plays every protein that has a structure and a summary, AlphaFold-only
proteins included: 17,513 proteins in 6,049 surname families on 2026-10-02, of
which 7,201 proteins and 2,149 families are AlphaFold-only. The daily pool leaves
AlphaFold out, so practice has its own pool, in the same shape, in one row of the
GeneGuessr D1 table `practice_selection_pool`. A practice start never scans
`proteins`.

- The row records the `catalog_version` of `daily_selection_pool` it was built at
  and counts only while that version is current. The daily pool's triggers are
  therefore the only invalidation path; the practice pool has no trigger of its
  own. The statement that builds it reads `uniprot`, `gene_surname`,
  `structure_source` and `gene_summary`, all of which the triggers watch, and a
  test fails if it ever reads another column.
- Building it scans `proteins` once (19,110 rows read on 2026-10-02) and runs
  after a write to `proteins` has bumped the version, or on first use. A rebuild
  stores its result only while the version it started from is still current, and
  requests in one isolate share a rebuild, as for the daily pool. The stored row
  is about 240 KB.
- `workers/lib/protein-store.js` creates the table on first use. A database that
  has the daily pool but not this table gets the table without the daily pool
  being touched; a database with neither gets both, with the daily row and
  triggers, in one batch.
- The stored pool does not depend on `structure_failures`, a table that changes at
  runtime, so a failure write never rebuilds it. A practice start draws up to ten
  candidates from ten different families (uniform over families, then over the
  members of the family, so a 400-member family weighs what a one-member family
  does), asks `structure_failures` about those ten ids in one batch of point
  lookups, and drops the failed ones. A lookup that finds nothing reads no row.
  When every candidate in a round has failed, another round is drawn, up to three.
- The availability check walks the surviving candidates in order, so a fallback is
  another family and never the next row of the protein table.
- A start therefore reads two rows for the pool, one row per failed candidate and
  one row per protein it loads. Nothing about it grows with the catalog.
- A pick happens only when nothing names a target. `/api/game/bootstrap?practice=1`
  reads the session first. A same-day session without `restart=1`, a restart
  that has a stored `practicePool`, `date=YYYY-MM-DD` and `same_target=1` each
  name the target, and when that protein loads there is no pick, no structure
  probe, no `structure_failures` write and no pool read. The pick runs for a
  first-time player, a restart with no pool, yesterday's session, and a named
  protein the catalog lacks. A browser with no session cookie has no session by
  construction, so it skips the session read and picks at once. Daily mode keeps
  its parallel session read and pick. Because R2 is unbound, a pick costs one
  outbound probe and one KV put, which is why a returning player must not pay it.

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

## Structure bytes and KV

`/api/structure-cached?key=` is a public GET, so the server alone decides what it
fetches. The upstream comes from the key: RCSB for a `pdb/` key, the stored
`proteins` row for an `alphafold/` or `swissmodel/` key (one indexed row), and
the AlphaFold file derived from the accession when no row matches. No query
parameter names an upstream. Every structure fetch (the route, the availability
probe, the R2 cache fill and the daily pin) goes through
`fetchStructureUpstream` in `workers/lib/structure-upstream.js`: https only, no
userinfo, no port, and exactly `models.rcsb.org`, `alphafold.ebi.ac.uk` and
`swissmodel.expasy.org`, with redirects followed by hand (three at most) and
each hop checked. The response's `Content-Type` follows the key's format
(`bcif` octet-stream, `cif` chemical/x-cif, `pdb` chemical/x-pdb) with
`X-Content-Type-Options: nosniff`. A fourth provider is one entry in that file.

A protein with a stored structure source never touches KV: the row is the
decision and always wins. KV key `structure_source:<uniprot>` holds only what
discovery found for a protein that has no stored source (749 of 19,110 on
2026-10-03; none is in the autocomplete index or a target pool). It is written on
a miss with a 30-day TTL, so the worst case is one write per such protein per
month, and `/api/structure-token` refuses an accession that is not in the
catalog before discovery runs. The free plan allows 1,000 KV writes a day and the
recorded daily answer shares that allowance, so a lookup that a reader can repeat
must not write.

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

`workers/practice-bootstrap-returning-session.test.js` must prove, through the real
Worker on the same production-shaped local D1 with R2 unbound and `fetch` counted:

- a returning same-day bootstrap makes no pick statement, no structure probe and
  no KV put, and on a cold isolate reads one protein row;
- a first-time bootstrap, a restart with no pool, yesterday's session, an unknown
  `same_target` and a failed session read still pick;
- a restart with a stored pool, `same_target=1` and `date=` name the target with no
  pick;
- a browser with no session cookie reads no session.

`workers/structure-cached-key-lookup-cost.test.js` must prove that an
`/api/structure-cached?key=` request for a SWISS-MODEL or AlphaFold structure
reads at most one row of `proteins` through an index search, finds the row the
`upper(uniprot)` statement finds, and keeps its answers for a missing row, a key
with no accession, a D1 error and a PDB key.

`workers/structure-cached-upstream.test.js` must prove, through the real Worker
with a network stub that follows redirects as Workers does, that no
`upstream=` value is ever fetched (another host, userinfo, IP literals,
localhost, odd ports, http and other schemes), that a stored upstream off the
three provider hosts is refused without a fetch, that a redirect off the
providers is not followed and a loop stops after three hops, that the
`Content-Type` comes from the key, that an R2 bucket never receives a caller's
bytes, and that the three providers are still served.

`workers/structure-kv-writes.test.js` must prove, on the production-shaped local
D1 with R2 unbound, that a structure token, a first and a returning practice
bootstrap and a guess make no KV put for a protein with a stored source, that an
accession outside the catalog is refused with no fetch and no put, that discovery
writes once per protein with a 30-day TTL, and that a stale KV entry never beats
the stored row.

`workers/admin-schedule-year.test.js` must prove that the first uncached annual
request returns 365 complete, unique protein and surname identities using bulk
queries, and that missing summaries fail the response closed without caching
partial rows.

`workers/lib/daily-target-availability.test.js` protects the separate structure
availability and recorded-target replacement rules.
