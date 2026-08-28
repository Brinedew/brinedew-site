# Card publication and reload delivery (B-716)

## ARCHITECTURE FENCE [IPD-011]: one committed head, immutable Bunny bytes

The single `IconoplasmCardPublicationCoordinator` SQLite Durable Object owns
current/previous publication versions and the consumed D1 event watermark.
D1 still owns authoring and the existing vote outbox. Bunny Storage holds
content-addressed full cards, independent gene/portrait projections, small
hash directories, packed bulk-read shards and the root manifest. It never
selects a winner. R2 and paid Cloudflare upgrades are not prerequisites.

The deployed Worker composition dispatches declared routes from the shared
route contract, including `/published-cards/v2/immutable/*`; a nested handler
test alone cannot prove that first-party fallback avoids a static-site 404.
For an extension tab already using first-party metadata, use its exact
snapshot/lane endpoint directly. Do not resolve the manifest, directory and
object through three serial first-party requests just to reach that same record.

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
the old readable head and durable work for the next day. Within that allocation,
1,000 writes are reserved for failure bookkeeping and a durable next-day alarm;
ordinary publication stops at 54,000. Every actual `setAlarm` costs one SQLite
row write, and recording its reservation costs another. Failure inserts/deletes
are also reserved. Existing earlier alarms are not rewritten. Quota exhaustion
retries at the UTC boundary, not every thirty seconds; actor reconstruction and
new wakeups cannot shorten this deadline.

The earlier roughly 44,000-write bootstrap estimate omitted control writes.
Including alarms and their reservations puts the 19,023-card bootstrap nearer
50,000 writes before retries; this remains an estimate, not a measured bill.
Inspect actual account usage. Ledger version 2 marks a carried-over version-1
day as `legacy_control_writes_unmetered` until UTC reset rather than pretending
the historical partial count is complete. No local ledger reserves capacity
against independent classes or proves the account-wide quota is available.
Nearby write-side wakeups coalesce for ten seconds. Alarms resume durable work
with bounded backoff; scheduled recovery catches a lost notification.

## ARCHITECTURE FENCE [IPD-008]: article lifetime is the freshness boundary

Each article checks `/api/public/v1/card-current` independently of
the scanner's five-minute refresh. A cache-only `GET_GENE_DATA` first permits
local recognition after the initial paint boundary, without network or portrait
hydration. `GET_CARD_FRESHNESS` runs once after host load or on explicit early
hover; a cold `GET_GENE_DATA` performs the same selection. If a last-known
published epoch exists, selection returns it immediately from local storage.
The head check runs in the background and saves its validated result for future
articles. Only an installation without a saved epoch waits for the network.
Both card lanes and disk hydration use the selected epoch. This deliberately
allows a coherent older card on the first article after a publication, instead
of blanking a saved card until the network responds. The next article adopts
the refreshed head. Another tab's storage update cannot replace an open
article's epoch or refetch its visible hover. Older concurrent checks cannot
overwrite a newer check's saved result. No timer polls an idle article. Failed
checks retain the saved epoch; explicit retirement still forces recovery.
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
Hover membership uses the private `/discoveries/membership` endpoint, limited
to 128 explicit symbols and composite-primary-key probes. It must not seed
starter genes or fetch the rich account gallery. The active symbol goes first;
later intent outside the checked window gets another bounded lookup. Concurrent
lookups share work. A 20,000-row local collection test reads eight rows for
three requested symbols (two hits), with zero writes. Empty-symbol checks serve
popup authentication without reading or creating discovery rows.

Healthy readers fetch immutable objects directly from paid Bunny Storage/CDN.
Blocked or corrupt responses use the exact first-party object path, with
bounded hedging, cancellation and byte/hash validation. Private routes and
credentials never enter these CDN paths. Both lanes share only bounded hash
directories; a stalled rich card must not block its independent portrait.
Changing one gene does not change its neighbors' card/image URLs.

### Released-client transport acceptance

The public/store 0.5.3 package predates the native v2 client. It still requests
`card-snapshots/:version/delivery-index` and
`card-content/v1/:rangeHash/:lane/:symbol`. The v2 migration originally returned
`card_delivery_index_unavailable` (503) to that client, silently disabling its
Bunny metadata accelerator. Checking only a later validation build also labeled
0.5.3 missed this regression. Verify runtime file hashes as well as the version.

The existing v1 transport now admits both published storage formats. For v2 it
returns the same bounded range/hash envelope, then resolves a range hash through
one at-most-128-gene directory and the exact independent `genes` or `portraits`
object. It never reads the packed shard or full card to supply a locator, elects
canon, writes storage, or publishes a second artifact. Missing/corrupt objects
fail uncached; unknown/unpublished hashes remain 410. Existing Bunny rules cover
these URLs, so the repair applies to installed 0.5.3 without changing its package.

Legacy clients retain range-level invalidation: a changed neighbor in the same
range changes that client's metadata URL. Only the native v2 client has per-gene
metadata reuse across such changes. Do not claim the legacy adapter provides
native-v2 capacity or universal instantaneous hover. A cold legacy fill needs a
published manifest, one directory and one lane object; both lanes share parsed
manifest/directory reads. Warm Bunny hits avoid Worker execution, while regional
fallback still costs first-party requests. Regression tests exercise the real
route with the released client header, independent lane failures, unchanged
range reuse, invalid identities and zero packed-shard/full-card reads.

### Portrait preparation belongs to the displaying context

The 2026-08-28 released-client trace on Wikipedia RAD51 transferred the same
29,984-byte portrait twice: first in the host page, then in the extension frame.
The second transfer followed completion of the first, adding a serial network
wait. HTTP caches are partitioned by browsing context; preparing a host-page
`Image` does not certify that the embedded card can paint it.

Moving the HTTPS loader into the displaying frame removed that within-page
duplicate, but did not solve reuse across websites. A retained installation
then downloaded the same BRCA1 bytes again when moving from Wikipedia to PMC;
the first paper hover took 3.7 seconds with browser cache interception disabled.

The background now owns bounded extension-origin IndexedDB for exact public
card responses and immutable portrait bytes. A miss uses the existing tab source
plan, 350 ms hedge and losing-source cancellation. The displaying frame (or
simple host layout) decodes the returned data URL, without a second HTTPS read.
The bounded frame protocol acknowledges only the matching request after decode
and retains cancellation and deadlines. Provider and publication authority do
not change; no new permission is required. Cache limits and migration evidence
are in `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.

Verify packaged requests on ordinary pages with routing/cache interception off;
a routed synthetic fixture disables HTTP caching and cannot alone prove
cross-site reuse. This client change requires a new authorized store release;
it is not shipped to users by a backend deployment.

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
