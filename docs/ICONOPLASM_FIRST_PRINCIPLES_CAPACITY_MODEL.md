# Iconoplasm product and first-principles capacity model

This is the launch model for Iconoplasm. It deliberately does **not** extrapolate
historical Cloudflare counters: the routing, publication, extension cache, and
discovery-write architecture changed too much for old traffic to be a useful
denominator.

The model starts with what a person is trying to do, maps each action to the
shipped request path, and then asks which independent free-tier allowance fails
first.

## Product model

Iconoplasm is a mnemonic world for human genes, inspired by extreme mnemonics.
It is for life-science students and preclinical researchers who can remember a
character, story, and social relationship more easily than an isolated molecular
fact.

The important surfaces are not interchangeable:

1. **Extension tooltip:** recognition while reading a paper or biology database.
   It must appear quickly, stay visually stable while the reader is on that page,
   and link to the deeper dossier.
2. **Gene dossier:** explanation, candidate comparison, and canon selection. It
   is the one passive page where live vote state belongs.
3. **Personal Archive and Clans:** the reader's memory trail and progress through
   the world. A discovery belongs here only when it can actually be retained.
4. **Shared discoveries:** a social overlay showing which genes other people
   encountered. It is not the user's personal shelf and need not update within a
   single hover.
5. **Authoring:** a signed-in researcher brings their own model/API access,
   creates or edits a character interpretation, publishes it as a candidate, and
   lets the community compare it.
6. **Frozen gene archive:** a stable reference and crawl path over the 19,023
   complete human-gene profiles. It is not an infinite activity feed.

## When a viewer should see something change

| Event                    | Person who caused it                   | Other open gene pages                           | Archive / extension / new visits                         |
| ------------------------ | -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Vote button pressed      | Optimistic score immediately           | Dossier projection converges in seconds         | Next published snapshot, at most about 15 minutes        |
| Candidate wins canon     | Dossier follows the projected winner   | Fresh dossier reads see the winner              | Archive and extension move together at the next snapshot |
| New personal discovery   | Personal shelf can update immediately  | Not applicable                                  | Persists for the signed-in person                        |
| New shared discovery     | No need to interrupt the reader        | No need to mutate an open page                  | Shared overlay updates at the next hourly publication    |
| Catalog/card publication | Current reading context stays coherent | Existing page is not rewritten under the viewer | New page contexts use the new immutable version          |

This separation is intentional. Immediate feedback is for a person's own action.
Passive pages should not swap portraits under somebody who is trying to memorize
one. Global readers converge at an explicit publication boundary.

## Provider ceilings

As of 2026-07-24, the independent Workers Free daily ceilings used by the model
are:

| Resource                           | Free allowance |
| ---------------------------------- | -------------: |
| Worker / Pages Function requests   |    100,000/day |
| Workers KV reads                   |    100,000/day |
| Workers KV writes                  |      1,000/day |
| D1 rows read                       |  5,000,000/day |
| D1 rows written                    |    100,000/day |
| Durable Object requests            |    100,000/day |
| SQLite Durable Object rows read    |  5,000,000/day |
| SQLite Durable Object rows written |    100,000/day |
| Queue operations                   |     10,000/day |

Static asset requests are free and unlimited when they do not invoke Worker
code. A Queue message normally costs three operations: write, read, and delete.
On the free plan, exceeding one of these product-specific allowances causes that
operation to fail until the 00:00 UTC reset; it does not create a surprise
overage charge.

Sources:

- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/kv/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/queues/platform/pricing/>

## Action-derived costs

The executable model is
`scripts/iconoplasm-first-principles-capacity.mjs`.

### Homepage visit

A browser that runs the current homepage application loads the published card
manifest and the three starter-card shards:

- 1 Worker request;
- 5 KV reads.

The HTML, CSS, JavaScript, fonts, and images are static assets and do not spend
Worker requests.

### Curious website explorer

The representative explorer opens the homepage, performs five searches, and
opens three gene dossiers:

- 15 Worker requests;
- 32 KV reads;
- 3 Durable Object snapshot requests;
- about 21 D1 rows read at the average 2.958 candidates per gene, or 144 at the
  shipped maximum of 44 candidates.

Snapshot reads no longer rewrite Durable Object summary rows. A signed-out gene
page keeps its dossier visit in a compact browser-local shelf and spends no
discovery request. The website shelf can retain all 19,023 deliberately visited
genes.

When that reader later signs in, each authenticated page session performs at
most one 200-symbol merge. One maximum batch therefore adds:

- 1 Worker request;
- at most 200 discovery upserts;
- at most about 1,600 conservatively modeled D1 write units.

The merge is a bounded conversion of retained user intent, not anonymous
background traffic. A failed merge leaves the local shelf intact for retry. An
extreme full-catalog guest shelf takes 96 page sessions to drain at
this conservative batch size; it never becomes a single 19,023-row write burst.

The first lifetime read of a gene's vote coordinator is different: it imports
that gene's existing assets and votes into the Durable Object once. With one
vision per candidate, the conservative write shape is `2 + 2*candidates`
(symbol/bootstrap metadata plus asset and vision summaries). At the catalog
average, a completely cold sweep crosses the 100,000 Durable Object row-write
allowance around gene 12,633. Repeated views of already-bootstrapped genes do not
repeat these writes.

### Extension reader

Extension cost is a function of behavior, not elapsed wall-clock time:

```text
manifest refreshes = min(page loads, five-minute windows)
auth/discovery checks = min(qualified 900 ms hovers, five-minute windows)
projection requests = 2 * unique prepared genes

Worker requests =
  manifest refreshes + auth checks + projection requests
  + signed-in encounters + canonical portrait fallbacks

conservative cold-isolate KV reads =
  3 * manifest refreshes + 3 * projection requests

KV list operations = 0 on every public request path
```

There is no five-minute idle timer. A long-open page with no new content-script
request does not manufacture 96 manifest requests.

Two deliberately different eight-hour assumptions are retained:

- **Dense-paper reader:** 32 content pages, 32 qualified hover windows, 512
  unique prepared genes.
- **Maximally scattered reader:** 512 one-gene page contexts, 512 qualified
  hover windows, 512 unique prepared genes. This is a stress
  boundary, not a normal scientist.

### Signed-in discovery

A signed-in encounter performs indexed point reads and constant-time writes:

- personal discovery insert/update;
- one atomic shared-rollup increment.

The model conservatively counts eight D1 write units for a new discovery and
seven for a repeat because D1 also counts affected index rows. Discovery does
**not** use a Durable Object.

The previous implementation re-aggregated every discoverer of the same gene on
every encounter. For `n` people discovering TP53 together, that produced roughly
`n(n+1)/2` rollup rows read. It has been replaced with an O(1) increment.

The shared symbol list is now published on the hour by the existing control
plane. At the full 19,023-gene end state, its deliberate upper bound is 456,552
D1 rows read/day plus 24 KV reads/day; it writes KV only when the symbol set
changed. User hovers no longer race through a whole-list KV read/modify/write.

### Request inbox

An idle signed-in tab performs one initial notification read, plus explicit
focus/visibility refreshes. Minute polling runs only while the account actually
has an open generation request, preserving the expected one-to-two-minute
fulfilment feedback without charging a forgotten tab all day.

### Voting

For a conservative independent upper envelope, one vote is modeled as:

- 1 Worker request;
- 1 Durable Object request;
- up to 8 Durable Object row writes;
- up to 12 indexed D1 projection writes;
- 3 Queue operations.

Production batching can make this cheaper. The capacity decision uses the
unbatched boundary so it does not depend on lucky coalescing.

## What breaks first

All counts below are the **first user whose full daily behavior crosses a free
allowance**, starting from zero unless the row names the 10,000-visitor base.

| Independent behavior                                  | First allowance to fail     | First user over |
| ----------------------------------------------------- | --------------------------- | --------------: |
| Homepage only                                         | KV reads                    |          20,001 |
| Curious website explorer                              | KV reads                    |           3,126 |
| Dense-paper extension reader, signed out              | KV reads                    |              32 |
| Same, after 10,000 homepage visitors                  | KV reads                    |              16 |
| Maximally scattered extension reader                  | KV reads                    |              30 |
| Signed-in dense-paper reader with 512 new discoveries | D1 rows written             |              25 |
| Contributor casting 100 votes/day                     | Queue operations            |              34 |
| One visible tab with an open request for eight hours  | Worker requests             |             208 |
| Completely cold, disjoint gene coordinator bootstraps | Durable Object rows written |     gene 12,633 |

### Scott Alexander shoutout shapes

These are not forecasts. They are envelopes that make the hidden assumption
visible:

| Audience behavior                                     | Result                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| 10,000 people open the homepage once                  | 10,000 Worker requests and 50,000 KV reads; safe |
| Those 10,000 also behave like curious explorers       | KV reads fail around explorer 3,126              |
| 10,000 homepage visitors plus dense extension readers | reader 68 crosses the remaining KV allowance     |
| 25 signed-in readers each discover 512 new genes      | the 25th crosses the D1 write allowance          |
| 34 contributors each cast 100 votes                   | the 34th crosses the Queue allowance             |

The hot take is simple: anonymous shoutout traffic is not intrinsically scary.
Deep extension use, signed-in discovery writes, and heavy voting are separate
failure domains and fail at much smaller engaged-user counts. “Upgrade Workers”
would mask these shapes, not correct them.

## Independent maximum-strain assumptions

### Portrait accelerator failure

If Bunny fails for a reader, each unique portrait may add one first-party Worker
request. The dense 512-gene extension shape adds up to 512 Worker requests per
reader. KV still fails before Workers in the current dense and scattered
scenarios, but the Worker margin becomes much smaller.

### Dynamic crawler

Training crawlers are blocked before Worker execution. An allowed search or
user-directed crawler that intentionally opens dynamic gene dossiers behaves
like dossier traffic, not free static traffic. At the 44-candidate boundary,
25,000 anonymous dossier views consume about 75,000 Worker requests and all
100,000 KV reads. A first-ever sweep across distinct gene coordinators can fail
earlier on Durable Object row writes, around 12,633 average-shaped genes; that
cost is one-time per gene, not per crawler revisit.

### Other applications on the account

The 100,000 Worker limit is account-wide. Other Workers and Pages Functions can
be represented as an explicit base vector in `firstUserOverLimit`; they are not
silently inferred from yesterday's counter. This is the only honest use of
current account data in a first-principles launch decision.

## Hardening decisions closed in B-673

Portrait fingerprint and reference metadata are now publisher-owned immutable
artifacts. Public readers never reconstruct them from D1. Missing or corrupt
publication returns a retryable 503 instead of turning a visitor into an
infrastructure repair job.

### R-1 — nightly maintenance has one declared owner

The 23:55 UTC trigger is the sole full Iconoplasm maintenance owner. The 00:03
trigger remains configured because it owns GeneGuessr recap/catch-up delivery,
but it no longer runs Iconoplasm maintenance. The runtime set, Wrangler comment,
and test all enforce that separation.

### R-2 — website guest discovery is browser-local until login

The website now keeps deliberately visited dossiers in a compact local shelf
that can retain all 19,023 catalog genes. Starter genes remain onboarding
examples; only actually visited dossiers enter the pending merge. Each
authenticated page session merges at most 200 pending symbols and clears
only that successful batch locally. Signed-out browsing never spends a
discovery Worker request.

## Rule for future recommendations

Historical counters may validate that a modeled path is occurring and reveal
unmodeled traffic. They may not be used to extrapolate launch capacity across an
architecture change. Any recommendation to pay, raise a limit, or change a
publication cadence must name:

1. the user behavior;
2. the requests and storage operations caused by that behavior;
3. the first independent allowance to fail;
4. the first user/action count over that allowance;
5. what the viewer sees when it fails; and
6. whether payment fixes a legitimate workload or merely subsidizes a kludge.
