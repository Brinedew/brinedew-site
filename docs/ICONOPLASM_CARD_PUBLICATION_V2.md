# Card publication and reload delivery (B-716)

## ARCHITECTURE FENCE [IPD-011]: one committed head, immutable Bunny bytes

The single `IconoplasmCardPublicationCoordinator` SQLite Durable Object owns
current/previous publication versions and the consumed D1 event watermark.
D1 still owns authoring and the existing vote outbox. Bunny Storage holds
content-addressed full cards, independent gene/portrait projections, small
hash directories, packed bulk-read shards and the root manifest. It never
selects a winner. R2 and paid Cloudflare upgrades are not prerequisites.

The coordinator changes its head and watermark in one synchronous transaction
only after every referenced object has passed an authenticated GET/hash check.
An accepted PUT or a successful HEAD is not sufficient evidence of readable
bytes. Failed preparation retains the old complete head and durable progress.
Events arriving during preparation remain beyond the captured watermark.
Post-commit route/materialization wakeups have their own durable pending state.

Do not PUT a mutable `current.json` to Bunny: an old timed-out request can
complete after a newer request and roll a replica backward. The small current
document is an HTTP-cached read of the coordinator instead. It has a 30-second
shared-cache lifetime and a zero browser lifetime. Origin Shield aggregates
origin misses; neither caching nor shielding is a hard request cap.

Seven cards per preparation invocation means at most 42 storage transfers
(three objects, PUT plus verified GET). Sealing one 750-card packed shard and
its 128-gene directories is a separate bounded phase, including shard splits.
Only two cards (six object pipelines) start concurrently. Cloudflare's April
2026 rule limits requests waiting for response headers to six; starting all
21 uploads together can spend their timeout in the platform queue. Reducing
the seven-card durable batch would instead increase SQLite checkpoint writes.
All started uploads settle before a failed phase returns or retries. Regression
tests enforce both limits; neither longer timeouts nor optimistic PUT success
is a substitute for bounded work and verified bytes.
Public single-card reads use small exact objects, not the packed shard.
No-op jobs stop; no continuously running publisher or per-reader write exists.
The publisher reserves at most 55,000 SQLite row writes per UTC day before
performing work; failed attempts are not refunded. This is a local allocation,
not a global account reservation. It leaves 45,000 of the Free account's
100,000 writes for votes, other coordinators and recovery. Exhaustion retains
the old readable head and durable work for the next day. Bootstrap reserves
about 44,000 writes for the current 19,023-card catalog; inspect actual account
usage before authorizing it. Failure-status bookkeeping is separately bounded
by backoff and must be included in capacity accounting.
Nearby write-side wakeups coalesce for ten seconds. Alarms resume durable work
with bounded backoff; scheduled recovery catches a lost notification.

## ARCHITECTURE FENCE [IPD-008]: article lifetime is the freshness boundary

Each `GET_GENE_DATA` load checks `/api/public/v1/card-current` independently of
the scanner's five-minute refresh. A minutes-old installation check cannot
skip this request. The returned epoch belongs to that article; another tab's
storage update cannot replace it or refetch its visible hover. No timer polls
an idle article. A failed check retains the coherent cached epoch.
Disk-cache hydration must use that explicitly selected article epoch, never
replace it with the browser-global saved version. A delayed storage lookup
cannot undo a newer explicit selection. A differently versioned cache belongs
to another article and is ignored, not deleted or adopted.

Extension updates invalidate an existing article's isolated runtime. Chrome
can leave its old highlights behind; those do not prove a working connection.
Metadata, portraits and snapshot recovery share one runtime client. Permanent
invalidation rejects pending requests, disposes speculative work and presents
one user-controlled reload notice. Cached hovers also check runtime identity.
Do not silently reload the host article, ask for broader permissions to reinject,
or retry a permanently invalid context. A temporarily sleeping/missing background
receiver is a different, retryable failure. Validate an actual update cycle,
then leave the inspected article refreshed and working.

The scanner's ordinary five-minute manifest refresh also uses the existing
Bunny/first-party race. It requests the shared latest public contract without
credentials, version headers or cache-busting parameters, and validates the
complete contract before accepting either source. Only explicit retired-card
recovery bypasses that shared cache. An invalid CDN response cannot suppress
the bounded first-party fallback. Connectivity is reconsidered per refresh.
The scanner artifact itself remains separately versioned and is downloaded
only on an actual scanner change; its cold-download cost is not zero.

Discovery recording rechecks membership after its asynchronous state load.
Otherwise a gene already on the shelf can be written again once per article.
That suppression does not remove explicit repeat-encounter semantics at the
API, and failed/guest encounters remain in the local pending buffer.

Healthy readers fetch immutable objects directly from paid Bunny Storage/CDN.
Blocked or corrupt responses use the exact first-party object path, with
bounded hedging, cancellation and byte/hash validation. Private routes and
credentials never enter these CDN paths. Both lanes share only bounded hash
directories; a stalled rich card must not block its independent portrait.
Changing one gene does not change its neighbors' card/image URLs.

## Explicit migration and verification

1. Deploy the coordinator binding, routes and consumers together. The binding
   freezes legacy KV publication; public reads retain the frozen legacy head
   until the new complete catalog is committed. This is a migration state,
   not a second live publisher.
2. With administrator authentication, POST
   `/api/iconoplasm/admin/gallery/migrate-card-storage`. Inspect
   `/api/iconoplasm/admin/gallery/publish-status` for durable group/offset,
   failures, watermark and committed `ccv2-…` version. Do not fabricate a
   successful migration from a queued response.
3. Bootstrap copies exact existing card content. Routine jobs materialize only
   event-named genes. A mapper revision mismatch fails closed and requires an
   explicit mapping migration; never hide a full rebuild in a reader or vote.
4. Configure the tiny current route and public catalog manifest as Bunny
   first-party origin proxies with a 30-second successful-response TTL and
   zero browser TTL. Only these exact public URLs match; no private endpoints,
   cookies or authorization headers belong in this shared-cache contract.
   The immutable namespace uses the
   existing Storage origin and year-long successful-response caching. Errors
   are not immutable successes. Origin Shield was enabled and freshly read
   back on the existing zone (Paris) on 2026-08-27; concurrency limits are off.
5. Verify exact site/hover identity, ordinary reload, unchanged-byte reuse,
   corrupt/blocked Bunny, old open articles and the installed browser package.
   Source deployment does not update installed store extensions.

Do not roll back to the frozen KV head after new publications have committed:
that would revert canonical state. Recovery resumes the durable job/head.
Legacy artifacts remain read-only migration evidence until the new catalog and
release are verified; cleanup is not an implicit recursive deletion.

## Capacity proof boundary

The target is one minute, with two acceptable; scale and smooth reading outrank
a strict timer. The 10,000-daily-reader workload includes votes, saved
discoveries, authentication, other site traffic, regional fallbacks, cold
caches, storage growth and retries. Unit tests and local workerd failure tests
do not certify that workload. Track measured deployment/browser and whole-cost
acceptance in B-716, not a competing architecture issue.
