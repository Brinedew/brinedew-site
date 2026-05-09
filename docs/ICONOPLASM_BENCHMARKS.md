# Iconoplasm Benchmark Ledger

This file records live timing checkpoints for Iconoplasm surfaces that users wait on. Keep raw benchmark JSON and Playwright screenshots under `artifacts/`, then summarize the result here so future optimization work has a stable baseline.

## 2026-05-09 - B-510 Live UI Validation

Context: after B-507/B-509, the live page still failed under Playwright because guest browsing first entered signed-in account-window loading, then the strict card manifest path sometimes loaded the whole published card artifact for small requests.

Raw evidence:

- Before auth-window fix: `artifacts/b-510-live-ui-benchmarks/benchmarks-2026-05-09/live-baseline-before-auth-window-fix.json`
- After shard-selective manifest read: `artifacts/b-510-live-ui-benchmarks/benchmarks-2026-05-09/live-baseline-after-shard-selective-manifest.json`
- Playwright screenshots: `artifacts/b-510-live-ui-benchmarks/playwright-2026-05-09/`

Live Playwright result after fixes:

- URL: `https://iconoplasm.brinedew.bio/?b510=shardfix`
- Cards rendered: 6
- Data failure cards: 0
- Guest path no longer calls the signed-in account gallery window before auth resolves.

Five-sample live endpoint timings after shard-selective manifest reads:

| Surface | Median | Worst Sample | Status |
| --- | ---: | ---: | --- |
| Home HTML | 138 ms | 474 ms | 200 |
| Public gallery, votes, 24 genes | 108 ms | 2,001 ms | 200 |
| Mobile card manifest, 5 genes | 228 ms | 733 ms | 200 |
| Account window, guest newest | 54 ms | 101 ms | 200 |
| Account window, unsupported heaviest | 52 ms | 96 ms | 409 expected |

Known remaining timing risk:

- Public gallery had one 2,001 ms outlier in this sample. It rendered successfully, but it should be tracked in the next optimization pass because users feel multi-second waits.

## 2026-05-09 - Signed-In Account Scroll, B-510 Follow-Up

Context: the first B-510 Playwright check only proved the guest/starter collection. The signed-in `brinedew` account had 218 discovered genes, so it needed a separate Playwright pass.

Raw evidence:

- `artifacts/b-510-live-ui-benchmarks/benchmarks-2026-05-09/playwright-signed-in-account-scroll-after-retry.json`

Live Playwright result after `542de930` and `c1daceac`:

- URL: `https://iconoplasm.brinedew.bio/?b510=retry-settled`
- Signed-in account: `brinedew`
- Discovered genes: 218
- Cards rendered after stress scroll: 218
- Data failure cards: 0
- Console errors: 0
- Total stress-scroll time: 26,723 ms

Account-window timing during the successful full-account pass:

| Window | Duration | Transfer |
| ---: | ---: | ---: |
| 1 | 1,082 ms | 8,718 bytes |
| 2 | 762 ms | 8,802 bytes |
| 3 | 599 ms | 8,177 bytes |
| 4 | 518 ms | 8,689 bytes |
| 5 | 442 ms | 8,738 bytes |
| 6 | 524 ms | 8,482 bytes |
| 7 | 398 ms | 7,457 bytes |
| 8 | 537 ms | 8,483 bytes |
| 9 | 514 ms | 8,737 bytes |

What changed:

- Mobile signed-in account windows now request 24 cards instead of 12.
- Desktop signed-in account windows request 48 cards.
- Published card artifact shard reads happen in parallel.
- `items[]` no longer duplicates each rich card payload already present in `cards[]`.
- Account-window transport failures retry once on the same endpoint with `cache: "no-store"`. This is not an alternate data path; it preserves the one true path and recovers from transient worker misses observed in Playwright.

Remaining timing risk:

- The full 218-card stress scroll succeeds, but 26.7 seconds is still too long as a total traversal time. The next pass should reduce perceived wait by loading the next account window before the user is pinned at the bottom, or by changing how much DOM is kept/rendered during long account traversals.
