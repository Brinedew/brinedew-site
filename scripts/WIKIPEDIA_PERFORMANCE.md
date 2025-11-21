# Wikipedia Pageviews - Performance Optimization

## Problem
Making 19,000+ Wikipedia API calls takes **~3 hours** (vs 10 seconds without it).

## Solution
Wikipedia fetching is now **opt-in** via environment variable.

## Usage

### Fast Mode (Default) - Use Cache Only
```powershell
# Normal run - uses cached Wikipedia data, no API calls
python scripts/populate_local_database.py --batch-size 200
```
- **Speed**: ~10 seconds (same as before)
- **Wikipedia Data**: Uses cached values from previous runs
- **New proteins**: Get `wikipedia_pageviews: 0` until cache is populated

### Slow Mode - Fetch Fresh Wikipedia Data
```powershell
# Fetch Wikipedia data for all proteins (SLOW!)
$env:FETCH_WIKIPEDIA="1"
python scripts/populate_local_database.py --batch-size 200
```
- **Speed**: ~3 hours (19k+ API calls with rate limiting)
- **Use When**: You want to refresh Wikipedia data or fetch for new proteins

## Cache Location
`tools/thoteins/data/ncbi_gene_cache/wikipedia_pageviews_2024.json`

## Workflow

1. **Initial Run** (one-time, slow):
   ```powershell
   $env:FETCH_WIKIPEDIA="1"
   python scripts/populate_local_database.py --batch-size 200
   ```
   This populates the cache with Wikipedia data.

2. **Subsequent Runs** (fast):
   ```powershell
   python scripts/populate_local_database.py --batch-size 200
   ```
   Uses cached data, runs in ~10 seconds.

3. **Refresh Wikipedia Data** (occasional):
   ```powershell
   $env:FETCH_WIKIPEDIA="1"
   python scripts/populate_local_database.py --batch-size 200
   ```
   Updates cache with fresh 2024 pageview data.

## What Carmack Would Say

> "Don't make the common case slow. Cache aggressively, fetch lazily, and make expensive operations opt-in. Profile-guided optimization beats premature optimization, but obvious bottlenecks don't need profiling."

## Technical Details

- **Default**: Checks cache only, no network calls
- **With `FETCH_WIKIPEDIA=1`**: Makes API calls for missing/new proteins
- **Cache**: Automatically saved after each API call
- **Rate Limiting**: 100ms between Wikipedia API requests
- **Fallback**: Returns `0` if no cache entry exists
