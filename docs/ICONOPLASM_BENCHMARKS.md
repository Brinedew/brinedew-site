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
