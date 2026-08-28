# Iconoplasm product operating model

This is the product contract for the Iconoplasm website, extension, authoring
workstation, and public data plane. Read it before changing persistence,
freshness, caching, discovery, canon, or traffic behavior.

## Promise and audience

Iconoplasm makes molecular cell biology easier to remember by turning every
human gene/protein into a persistent character in one shared mnemonic world.

The primary users are life-science students and preclinical researchers reading
papers, databases, course material, and arbitrary webpages. They benefit because
people remember a striking character, story, faction, and social relationship
more readily than an isolated symbol and paragraph of molecular facts. The
extreme-mnemonic approach is inspired by Scott Alexander's writing about
memorable, interconnected mental models.

Iconoplasm is not a generic gene database. The database supports the memory
experience; it is not the product.

## User loop

1. The extension recognizes a gene/protein name in what the reader is already
   reading.
2. Hover shows the gene's stable portrait and identity without breaking reading
   flow.
3. A deliberate hover of about 900 ms becomes a discovery.
4. Click opens the gene dossier for the full character, biological traits,
   candidate portraits, requests, comments, and voting.
5. The homepage becomes the reader's personal discovery shelf. The optional
   shared overlay answers what the community has uncovered.
6. Votes and authoring choose the next portrait in D1. Publication alone
   propagates one coherent public version to the site, extension, archive, and
   outside clients.

The `/genes` archive is a stable reference/crawl surface, not a replacement for
the personal shelf. `/clans` shows personal progress through the worldbuilding
factions.

## What each surface is for

| Surface              | User job                                                | State owner                                               |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Extension hover      | Recognize a gene without leaving the page               | Published snapshot + bounded client cache                 |
| Gene dossier         | Understand, compare, vote, comment, request, and author | Published card portrait plus live D1 rich/candidate state |
| Homepage             | Resume the reader's own memory trail                    | Personal discovery shelf; optional shared overlay         |
| `/genes`             | Browse/search a complete stable reference               | Published release/archive                                 |
| `/clans`             | See personal progress through the mnemonic world        | Personal discoveries grouped by clan                      |
| Local workstation    | Create and curate portraits protein-first               | Local authoring/control plane                             |
| Public APIs/releases | Let other clients consume the same canon                | Publish/distribution plane                                |

## Discovery contract

- Extension: a visible hover held for about 900 ms is deliberate enough to
  count. Signed-out discoveries remain in extension-local storage and merge
  after login.
- Website: opening a gene dossier is deliberate enough to count. Signed-out
  dossier visits remain in a compact browser-local shelf that can retain the
  full 19,023-gene catalog. They cost no Worker request. Each authenticated
  page session merges at most 200 pending symbols; only that successful batch
  is cleared locally, and the remainder stays for later sessions.
- The INS/RHO/PRL starter trio is onboarding, not evidence that the guest
  actually discovered those genes. A starter joins the pending login merge only
  if the guest opens its dossier.
- Personal discovery feedback may be immediate. Shared discovery popularity is
  an hourly published overlay and must never be repaired by a reader request.

## Cloudflare account history and current spending boundary

Owner-confirmed on **2026-08-27**: the account was on Free, paid R2 was used,
and then R2 was disabled with an unpaid balance. The owner reports that the
account is now on Free until that debt is repaid. R2 billing and the Workers
subscription are separate: this history does not establish that Workers itself
previously had a paid subscription. Exact transition dates are not established.
An upgrade would require settling the
existing debt (previously described as roughly $70), so even a nominal $5 plan
is not an available engineering option.

Design, test and enforce against **current Free-plan limits**. Old paid-period
usage, billing-cycle allowances, deployment variables or dashboard budgets are
historical evidence, not current entitlements. A working authenticated dashboard
does not restore paid capacity. Conflicting telemetry must be dated and labeled;
never resolve the conflict by silently assuming the larger allowance.

Paid Bunny was deliberately purchased as the alternative to R2. Preserve it on
working networks, including VPNs, with bounded first-party fallback where Bunny
is unreachable. No debt payment, billing upgrade or R2 reactivation is authorized
by a freshness, performance or capacity task. Revisit this boundary only after
an explicit owner decision and a fresh account check.

See `ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` for the configuration
audit; B-716 owns the current Free-plan growth/freshness implementation.

## Priority order and growth contract

Owner clarification (2026-08-27): **scale and smooth reading take priority over
shaving the last minute off image synchronization.** Today's small readership is
not evidence that a per-reader polling or per-vote publishing design is safe.

| Category               | Requirement                                                                                                                    | Decision rule                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Non-negotiable         | Correct images, durable accepted votes/discoveries, usable host article, zero paid Cloudflare requirement, existing paid Bunny | Never spend past a quota, lose accepted user state, invent freshness, or block reading to meet a timer       |
| Growth acceptance gate | Model and test complete reader journeys at growing daily readership, including ordinary voting and signed-in use               | A warm-image benchmark or ten successful readers cannot certify the product                                  |
| Freshness target       | Aim for one minute; two minutes is acceptable for winner changes to reach new loads/reloads under healthy operation            | This is a target, not a strict worldwide deadline; preserve availability and correctness during overload     |
| Reading stability      | An unreloaded article may keep its images indefinitely                                                                         | No continuous open-tab freshness polling is required                                                         |
| Engineering choices    | Storage location, version pointers, caching and publication scheduling                                                         | Preserve current guards until a tested replacement exists; mechanisms are not immutable product requirements |

The working engineering benchmark is **10,000 daily active readers**, not 10,000
simultaneous users or a claim of current capacity. This round-number target and
the following usage mix are explicit modeling assumptions, not owner-provided
traffic estimates:

- Five articles per reader/day, thirty distinct genes encountered across them.
- 20% sign in; each signed-in reader saves ten newly encountered genes/day.
- 5% vote; each voter casts two votes/day. Assume 20% of votes change the winner.
- 2% require first-party delivery because Bunny is unreachable; also test 10%
  and a regional outage, plus higher account/voter participation.
- Test cold/warm caches, concentrated/scattered gene interest, steady activity
  and bursts, and spread across regions. Budget other site/workstation activity
  and retries; do not quietly assume they are zero.

At 10,000 readers this means 50,000 article loads, 1,000 votes, 200 winning-image
changes, and 20,000 newly saved discoveries per day. A winning-image update
distributes the identity of an existing selected image; it does not generate
a new image. Publication frequency depends on when those changes occur, not
the number of readers alone.

The current partial model already rejects a 10,000-reader readiness claim:
discoveries plus votes conservatively require 172,000 D1 write units against
100,000/day. Smaller scenarios fitting these components are not certified
capacity. See `ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md` and the executable
`readerGrowthAssessment`; current implementation and target remain distinct.

Capacity reports must lead with **readers/day, reader actions, supported/failed/
unverified verdict, and keep/change recommendation**. Infrastructure operation
counts are supporting evidence, never a substitute for that answer. Identify
assumptions, measured versus modeled results, freshness percentiles and misses,
regional fallback, and remaining budget headroom. No universal users/day claim
may be inferred from an isolated component ceiling.

## Change and freshness contract

### Extension cache selection migration - 2026-08-28

To remove network waits from saved-card display, the extension now pins the
last-known published epoch at article startup and checks the current head in the
background. That check updates the next article's selection, not the already
open article. With no saved epoch, selection still waits for the head. Explicit
retirement recovers immediately through the existing manifest contract.

This is a deliberate exception to the earlier requirement below to always adopt
the newest head on the first reload: one new article may use a coherent older
snapshot. It preserves the owner's higher priority of scale and smooth reading;
do not describe it as always-latest or as evidence of a worldwide freshness SLA.
See `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` for the retained-cache and delayed-head
tests. Website and publishing freshness behavior are unchanged.

### Owner clarification — 2026-08-27

**Stable while reading; fresh on reload.** This supersedes the former
15-minute convergence allowance and the earlier strict reading of sixty seconds.
Aim for one minute; two minutes is acceptable, subordinate to the growth and
correctness priorities above. This is not a claim of installed runtime compliance.

| Change                       | Current viewer                                     | Other open viewers                                             | New page loads and reloads                                                                                               |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Personal discovery           | Immediate shelf feedback                           | No effect                                                      | Persists after local or signed-in storage succeeds                                                                       |
| Vote                         | Immediate feedback, then authoritative result      | Existing page may keep its snapshot                            | A winning-portrait change follows the publication deadline below                                                         |
| Canonical portrait selection | Do not replace an open hover underneath the reader | An unchanged article may retain its loaded images indefinitely | Check current published version and use its exact portrait; no browser restart, hard refresh, or cache clearing required |
| Shared discovery count       | No interrupt                                       | No mutation                                                    | Next hourly publication                                                                                                  |
| New candidate/request result | Relevant account UI may refresh                    | Unrelated readers do not poll                                  | Account inbox polls only while a request is open                                                                         |

1. **The page load is the freshness boundary.** Opening a new article/document
   or ordinarily reloading it must perform a bounded current-version
   revalidation. An old extension-local timestamp must not skip that check.
   Switching tabs, scrolling, and hovering again on the same unreloaded article
   do not require canon refresh or continuous polling.
2. **Aim for one minute; accept two.** For a successfully accepted vote that
   changes the winner, target availability on fresh site cards and extension
   page loads within one to two minutes end-to-end under healthy operation.
   This includes publication and cache propagation, not a separate allowance
   at each layer. A reload before publication may see the previous complete
   snapshot. Measure and report missed targets; do not cross a quota or harm
   reading to pretend the target is an absolute guarantee. An unchanged winner
   requires no new image publication.
3. **Revalidate identity, reuse bytes.** Check small version metadata, not every
   image or the entire catalog. If unchanged, reuse cached metadata/images.
   If changed, adopt the exact new published snapshot for the newly loaded
   page and reuse unchanged content-addressed objects. Portrait and rich-detail
   lanes must agree. Do not reinterpret immutable old URLs as current canon.
4. **Reading remains usable during failure.** Default offline/error behavior:
   use the last coherent cached snapshot, do not block the host article, and
   expose an unobtrusive freshness failure in extension status. Never present
   an unsuccessful check as verified-current or mix snapshots to hide failure.
   A later page load/reload retries within bounded deadlines.
5. **Cost follows loads and changes, not time spent reading.** No freshness
   heartbeat per open tab, per-hover origin/database query, whole-catalog
   rebuild per vote, or image-byte re-download per reload. Preserve one
   publisher, one version barrier, direct Bunny acceleration and bounded
   first-party fallback. Capacity limits remain real implementation
   constraints; report freshness degradation and recover durably instead of
   exhausting shared capacity. Repeated normal-operation misses require an
   engineering fix, not a silent redefinition to fifteen minutes.

### Acceptance and implementation status

- Leave article A open, change the winning EZH2 candidate elsewhere, and return
  to A without reloading: its old image is permitted, including later hovers.
- Ordinarily reload A (or open article B): target convergence with a freshly
  loaded gene card within one to two minutes after the winner changes. Measure
  latency distribution and misses at the declared growth workloads, not claim
  a strict worldwide deadline. A minutes-old local check cannot bypass refresh.
- Reload without any canon change: unchanged images stay cached. During a
  failed check: the article remains usable and cached status is truthful.
- Verify installed HTML/PDF paths, multiple tabs, unchanged votes, rapid winner
  changes, warm caches, regional fallback and failure recovery. Measure
  publisher work and reload-driven origin traffic before declaring compliance.

Implementation and measured verification are tracked in
[`ICONOPLASM_CARD_PUBLICATION_V2.md`](ICONOPLASM_CARD_PUBLICATION_V2.md) and
[B-716](https://linear.app/brinedew/issue/B-716/revalidate-canonical-portraits-on-page-reload-while-keeping-open).
Completed publication/delivery foundations remain complete; this is the owner
for the newly clarified freshness requirement.

**Not yet certified:** the existing implementation was documented around a
15-minute publisher window, and the extension source has a five-minute
`DATA_REFRESH_TTL_MS`. Those are implementation gaps to evaluate against this
contract, not approved exceptions. Documentation changes alone do not fix or
certify runtime behavior.

## Authority and data flow

1. **Authoring plane:** the local Iconoplasm repo and dataset own Essence,
   Manifestation, Vision, generation, candidate assets, and operator workflow.
2. **Publish plane:** one canonical selection engine owns eligibility,
   vote/tie-break behavior, manual overrides, audit history, and the D1
   authoring pointer. The exact card artifact selected by the durable publication head
   alone owns the public portrait.
3. **Distribution plane:** the Website repo owns public cards, APIs, immutable
   assets, releases, change feeds, extension packaging, and reader interaction.

Readers consume publisher-owned immutable card/portrait metadata. D1 may
legitimately lead while a dirty shard awaits publication, but signed-in cards,
gene detail, public media, metadata, archives, sitemaps, extensions, and
print-copy inputs remain on the selected artifact. A public read must never scan
D1, fall back to its portrait SHA, or mutate shared state to repair publication.

## Cost and resilience rules

- Model costs from user actions and scheduled ownership, not historical traffic
  from a different architecture.
- Anonymous startup is static-first.
- Public reads scale with sessions and published artifacts, not catalog-wide
  relational scans.
- Reads do not write.
- Poll only while a person is waiting for something that can change.
- Every background job has one declared owner and a bounded unit of work.
- Paid capacity is not a substitute for removing accidental work.

The executable envelopes and exact free-plan ceilings live in
`docs/ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md`. Operational fences live in
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

## Known anti-patterns

Treat these as hardening defects, not acceptable shortcuts:

- duplicated cron ownership;
- reader-triggered repair or cache writes;
- whole-list KV read/modify/write;
- per-request whole-catalog scans;
- anonymous requests that cannot persist;
- unbounded server-side guest buffers, queues, retries, polling, or merge loops;
- UI that exposes database/library shape instead of the reader's memory trail;
- separate reconstructions of canon that can disagree.

If code violates one of these rules, record the exact behavior and permanent
fix in Linear. Do not hide it behind a TTL, retry, paid plan, or “cheap enough”
claim.

## Project memory

- Linear project: `Iconoplasm (Gene Mnemonics Extension)`
- Current implementation work belongs in Linear issues with acceptance criteria
  stated as user behavior.
- Historical incident documents explain past failures but do not override this
  product contract.
- Completed issues must be closed; rejected scopes must be canceled and titled
  as such. “Today's work” is reserved for work actually being executed now.
