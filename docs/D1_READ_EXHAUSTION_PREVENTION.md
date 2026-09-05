# D1 exhaustion: cause and prevention

## September 5 evidence

Cloudflare account analytics at approximately 09:50 UTC reported 5.97 million
rows read: roughly 4.86 million in Iconoplasm, 1.10 million in authoring, and
6,096 in GeneGuessr. These databases share one allowance. GeneGuessr migration
and OAuth failures were consequences, not evidence that GeneGuessr caused it.

Query Insights identified these concrete consumption defects:

- Finalization status counted unfinished jobs by scanning completed history:
  19,024 rows per call, 627,792 across 33 observed calls.
- Authoring gene resolution joined every identity to aliases before applying
  an OR predicate: about 28,901 rows per lookup, 317,917 across 11 calls.
- The previous snapshot builder copied 10,795 transport parts, accounting for
  237,490 observed reads and 43,180 writes. B-739 replaces this with streaming.
- Open/cancelled request counts scanned the requester's fulfilled history too.

The query-level dataset does not reconcile to the account aggregate. These
figures identify verified contributors, not an invented complete attribution.
Raw bounded evidence is in `artifacts/rescue-core-flows/d1-incident-*.json`.

## Chesterton's fence

**ARCHITECTURE FENCE [IPD-012]**: durable jobs exist to resume partially completed
publication safely. Exact status counts and completion timestamps are part of
the workstation contract. Preserve the jobs, phases, retry dates and exact
totals. Do not delete completed history or replace exact counts with guessed
values to reduce reads.

Migration 0094 maintains six counters on one row with transactional
insert/update/delete triggers. Global status reads that row and obtains the
latest completion using an indexed maximum. Scoped status probes only the
requested gene keys (maximum 5,000). A partial unfinished index excludes
completed history from pending lists and drains. The initial migration scans
history once; its index construction spends writes and requires deployment
headroom. Missing counters fail explicitly; no hidden scan fallback.

Gene resolution retains ID, case-insensitive canonical symbol, alias and merged
gene metadata. It first unions three indexed ID probes, then reads metadata.
The authoritative identities and aliases remain unchanged. Notification joins
still verify actual request, delivery and asset identity; do not remove those
joins as a cost shortcut.

## Admission and protected capacity

The account entitlement remains 5 million reads and 100,000 writes per UTC day.
The existing administrative/authoring runtime ledger now allocates at most
1 million reads and 20,000 writes. Historical monthly settings cannot raise
that allocation. This leaves headroom for readers, login, other databases,
concurrent in-flight requests and recovery. The ledger records actual costs;
it is not a complete account telemetry source or an atomic per-query reservation.

The existing PowerShell cutover preflight now also checks account-wide D1
analytics, across every database. It refuses new operator traffic at 3.5 million
reads or 70,000 writes, and on missing, invalid or wrong-day telemetry. Existing
atomic request reservations and Worker ceilings remain required. Analytics
lag is why this threshold is below the provider wall. Keep each operation's
work bounded; neither request count nor a fresh analytics sample bounds an
arbitrary SQL scan.

The normal production workflow runs this same control-plane preflight before
any D1 migration. It stops an exhausted release before spending more application
reads. It uses the existing CI credentials; no new provider or state owner.

Do not increase limits or retry continuously to finish a batch. Find the costly
query or repeated caller. Query analytics through the provider control plane,
which does not scan application D1, and verify SQL plans locally at catalogue
scale before running production work.

## Release and acceptance

Run the real-SQLite gene-resolver and finalization-summary tests, the D1 policy
and admission tests, and normal full release checks. The plan regressions use
20,000 rows and must reject catalogue scans. Counter tests cover creation,
state transitions, scoped reads, deletion and rollback.

The September 5 release attempt stopped at the D1 migration step. New Worker
code cannot be called live until the normal pipeline applies migrations and
deploys successfully. Waiting for the allowance reset is only a release access
condition; it does not complete this incident. After deployment compare actual
rows_read for the affected status and gene routes, prove account headroom under
the bounded bootstrap, and complete B-739/B-740 live acceptance. Until then,
report source/test proof separately from deployed prevention.
