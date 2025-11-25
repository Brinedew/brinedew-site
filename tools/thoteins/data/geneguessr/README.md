# GeneGuessr Data Directory

## Data Flow (so future-you doesn't get confused)

This directory contains the source data for GeneGuessr:

### `proteins.json` - THE source of truth
- Contains all protein metadata: clans, domain_names, domains, pathways, tissue, etc.
- **NOT** deployed via normal GitHub Pages / Quartz build
- Must be uploaded to Cloudflare D1 manually

### How to deploy protein data changes

After updating `proteins.json`:

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
