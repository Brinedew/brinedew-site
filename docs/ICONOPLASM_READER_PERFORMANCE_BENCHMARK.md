# Reader performance acceptance

ARCHITECTURE FENCE [IPD-008]. Owner correction, B-716, 2026-08-27:
"eventually shows one card" is a smoke test, not a performance benchmark.

Use `scripts/lib/iconoplasm-reader-benchmark.mjs` with **Playwright MCP's
existing Page**, with the actual packaged extension. The MCP VM does not support
Node `require` or dynamic `import`: the tool orchestrator reads this standalone
module, removes its top-level `export` keywords, and includes the function source
in `browser_run_code_unsafe` before calling `runReaderJourney`. Do not interpret
that VM limitation as a reason to launch a different browser. Never launch a hidden
replacement profile, change the user's preferred card style, or convert a failed
browser test into a skip. The CLI matcher benchmark requires `--lexical-only` and
does not certify reader performance.

## Measurements

`scripts/lib/iconoplasm-startup-benchmark.mjs` supplies a separate adversarial
pending-image fixture through the same existing Playwright page. Hold `load` for
20 seconds: a valid warm scanner must highlight without waiting, and no card
network should start until load or explicit hover. Do not call this synthetic
case a real-site latency result. Capture navigation-to-highlight and
FCP/DOMContentLoaded-to-highlight too; after-load timing alone conceals a
20-second resource stall. The diagnostics include bounded startup timestamps
for runtime injection, idle initialization, settings, scanner payload, matcher
completion and first anchor. These are observation-only, not a second scheduler.

PDF acceptance must include Form-XObject-clipped duplicate text, ordinary text,
zoom/rotation, and search splitting text spans. Anchor-to-text-layer alignment
alone cannot pass: invisible extracted text can be perfectly aligned yet wrong.
Visually compare the affected passage and the undecorated PDF; count rejected
clipped copies separately from valid visible matches.

Start observation before navigation, not after highlights appear. Preserve every
sample, timeout and missing diagnostic. Record host load/FCP, highlight arrival,
readiness immediately before pointer entry, pointer-to-image and pointer-to-detail
paint opportunities, long tasks, frame gaps and network requests. Image success
requires visible, loaded pixels for the expected gene and immutable portrait SHA;
a title, placeholder or previous gene's image is not success. Frame measurements
must be gated by the visible parent tooltip. Timing measures browser paint
opportunities, not physical display scanout.

A cold foreground hover may create the renderer iframe and select the article's
snapshot only after pointer entry. The observer follows newly created renderer
frames without restarting the pointer clock or deadline. Image-source validation
uses that selected snapshot while preserving the empty pre-hover revision in the
readiness record. Otherwise the observer can incorrectly report a loaded card as
an eight-second timeout.

Read-only `IconoplasmReaderDiagnostics.inspect(symbol)` is available in the
extension's isolated world and its own PDF page. It exposes public epoch and
readiness booleans only; it must never fetch, promote requests, update LRU order,
read private storage or start background work. `prepared` is scheduler state,
**not** proof of a decoded portrait; inspect `portraitReady` independently.

Prepared-image paint must be <=50 ms; 200 ms is not an acceptable saved-image
success threshold (owner correction, 2026-08-28). Other engineering budgets:
foreground recovery <=1,000 ms (cold first-hover delays remain failures);
highlight arrival <=1,500 ms after host load; examine prediction readiness after
a fixed 2,000 ms near-viewport lead. Do not wait for readiness and then start the
stopwatch. Immediate jumps, pre-load hovers, Data Saver and 2G are separate
recovery populations, not unfair prediction failures. Record actual lead time.
Slow networks remain visible in their own population; do not silently relax a
budget to make a run pass. At least 20 samples per population are needed for even
the initial p50/p95 screen; retain maximum and failure count. No p99 from five
samples. Five reloads and many repeats must never be pooled to hide five slow
first hovers.

## Required journeys

Unfamiliar-gene acceptance must include successive distinct genes on an ordinary
article, not many repeats of one prepared gene. Record the queued/in-flight state
before every pointer entry. A timeout on the first gene gives later genes extra
preparation time; those later successes cannot certify normal reading cadence.
Cross-site reuse is a separate journey with the same installation and storage
retained. Reinstalling between pages invalidates that reuse test.

Run unfamiliar-gene pages twice as distinct populations: hover immediately after
recognition, and hover after exactly 10 seconds from the host `load` event. Record
which exact metadata/image keys existed before navigation. Do not wait for cache
readiness, select genes because they are ready, or pool cold first-page startup
with a settled page. A cold network delay at immediate first use and an unprepared
gene after ten idle seconds are different failures. Sequential next-gene and repeat
timings must remain separate from both.

1. First use/cold catalog, ordinary reload with persistent cache, new article,
   background-worker restart, and an extension-update/reload cycle. Explicitly
   establish each cache state; an old browser profile is not "cold". Never clear
   the owner's collections/settings to create a cold case.
2. First hover on every article, repeated same gene, next unique gene, near-viewport
   reading at fixed lead times, fast jump to an unprepared section, reverse scroll,
   more than 48 distinct portraits (eviction), and return to a prior section.
3. HTML dynamic text and PDF new-page/zoom replacement. PDF anchors intentionally
   sit under selectable text: move the real pointer to their observed geometry;
   do not force-hover the invisible hit anchor or invoke its bridge directly.
4. Working Bunny, bounded delayed/failed Bunny, slow detail with working portrait,
   CPU contention, Data Saver and low bandwidth. Controlled fault tests must label
   the injected fault and restore interception in `finally`. Faults in a page
   alone do not prove service-worker request behavior. No synthetic public votes.
5. Identical host-page journey with highlighting off/on in an isolated test
   setting, comparing load/FCP, long tasks and frame gaps. Disclose observer
   overhead and background tabs. No claim that all host long tasks are ours.

The basic `runReaderJourney(page, {url, rounds, symbols})` covers repeated page
reload/first/repeat/next-predicted populations. An explicit `navigate(page, round)`
callback supports local PDF selection without uploading it. Additional fault,
restart, eviction and host-control cases require explicit setup; a basic run does
**not** certify the full matrix. Network observations can include other tabs'
service-worker traffic and do not establish origin billing. Report available
response body byte sizes, retaining unsupported measurements as null, not zero.
Save raw reports under the issue's project artifact folder.

For a reproducible long read, pass `rounds: 1` and explicit
`steps: [{symbol: "EZH2", kind: "forward-predicted", leadMs: 2000}, ...]`.
Steps retain their own kind (including fast jump, reverse and return-after-eviction)
and may use a different occurrence of the same gene. The runner caps total
attempts at 160 and each lead time at ten seconds. Highlight acquisition has its
own 15-second ceiling; a two-second image screen must not accidentally become a
two-second deadline for loading the entire host article. Missing metadata counts
as failed prediction readiness, not a canonically absent portrait.

## Diagnostic interpretation

### Retained-install cache verification - 2026-08-28

DEV runtime fingerprint `f4ed0831338aa0e363392fbc64594ce1971b7c1caf4cf5d6c5b82a5118f17826`,
normal HTTP caching, no route interception, the reader's chosen `simple` layout:

| Population                                                                                                                |                                Samples | Measured result                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------: | ------------------------------------------------------------------------- |
| Saved BRCA1, alternating Wikipedia and PMC395646                                                                          |                        20 first hovers | p50 15.4 ms, p95 19.6 ms, maximum 23.4 ms                                 |
| Same-page BRCA1 repeats, kept separate                                                                                    |                                     20 | p50 3.4 ms, p95 5.9 ms, maximum 7 ms                                      |
| After an actual extension-runtime restart                                                                                 |                         2 first hovers | 21 / 14 ms, no BRCA1 image or metadata requests                           |
| Exactly ten seconds after host load: interleukin-1 family, matrix metalloproteinase, integrin, cadherin, nuclear receptor | 25 hovers, 22 previously unsaved genes | all decoded before pointer entry; 8–18.9 ms                               |
| Freshly loaded, previously unseen connexin article                                                                        |                     2 successive genes | first 1,000.3 ms, next 8.4 ms; cold startup remains a separate population |

Across the twenty saved first hovers and twenty repeats there were zero BRCA1
portrait or card-metadata requests. A native Chrome IndexedDB test retained the
first of 160 forty-KiB records across a new cache instance; this is a storage
test, not a claim that 160 real cards were visually inspected. The actual reader
store held 97 portraits (4.55 MB) and 623 metadata records (0.82 MB), including
BRCA1. Upgrade removed the old whole-cache metadata keys only after migration.
The 50 ms prepared-image criterion passed; the earlier 200 ms criterion is retired.

Raw observations, including earlier failed iterations, remain in
`artifacts/hover-recovery-audit-20260828/`. This verifies the reported HTML hover
regression in this browser/network; it does not certify Vietnam ISP reachability,
the full PDF/low-bandwidth matrix, store propagation, or 10,000-reader capacity.

- No highlight: separate host-load gate, scanner response, matching and scan work.
- Highlighted but not ready after lead: inspect speculation policy/gate, queue,
  in-flight state and individual detail/locator/image readiness.
- Ready image but slow hover: inspect frame startup, decode, fonts and rendering.
- Fast repeats but slow first hover after **each** reload: suspect page-scoped
  initialization/hydration, not only first-ever cold cache.

Keep the deterministic first-ten/near-viewport windows, host idle gate, Data Saver
policy, bounded concurrency and canonical epoch fences. Do not improve scores by
preloading the entire article, stealing host rendering turns, restoring pointer
trajectory prediction, or bypassing Bunny with unlimited Worker reads.

Record findings in B-716. Passing local latency tests does not establish 10,000
reader capacity, global CDN freshness, Firefox store propagation or debt-free
Cloudflare headroom; those have independent acceptance evidence.
