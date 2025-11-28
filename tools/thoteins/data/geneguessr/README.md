# GeneGuessr Data Directory

## Data Flow (so future-you doesn't get confused)

This directory contains metadata and indexes for GeneGuessr. The actual protein database is too large for GitHub.

### Where's `proteins.json`?

**NOT HERE.** Large data files live at `D:\Coding\Datasets\geneguessr\proteins.json` — we don't put giant databases in a GitHub repo.

The file contains all protein metadata: clans, domain_names, domains, pathways, tissue, structure info, etc.

### How to deploy protein data changes

After updating the proteins.json in `D:\Coding\Datasets\geneguessr\`:

```bash
cd Website
python tools/thoteins/scripts/upload_local_database.py --remote
```

This uploads the data to the production Cloudflare D1 database.

### Full data flow

1. **Source**: `proteins.json` (this directory)
2. **Upload**: `upload_local_database.py --remote` → Cloudflare D1
3. **Worker**: `workers/index.js` serves `/api/protein` from D1
4. **Frontend**: `quartz/static/geneguessr/app.js` fetches and renders

### Other files

- `version.json` - Tracks last refresh timestamp and stats
- `index.json` - Protein index for search
- `embedding_*.json` - Embedding-related metadata
