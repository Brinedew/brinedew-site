# Architecture

## Components

### Mapping Studio (`apps/mapping-studio/gui_launcher.pyw`)
**Primary tool for managing mapping.json configuration**

- Run: `python apps/mapping-studio/gui_launcher.pyw`
- Purpose: Discovers field types from CSVs and creates mappings between molecular→persona properties
- Auto-discovers fields: Scans features.csv and persona.csv, infers types (numeric/set/text) from data patterns
- Field type rules:
  - Numeric: All non-empty values parse as floats
  - Set: Contains semicolons, pipes, or slashes (`;|/`) indicating multiple values
  - Text: Everything else
- Autosaves to `data/mapping.json` on any change
- Critical: This is how mapping.json gets edited - not manually

### Local Writer (HTTP server: `apps/protein-portrait-prompter/local_writer.py`)
- Serves Prompter UI at `http://127.0.0.1:8787/`
- Caches UniProt JSONs, provides API endpoints for mapping operations
- Backend for card gallery and protein data fetching

### UniProt helper (`scripts/protein_db.py`)
- Extracts features to CSV and applies mappings to produce personas
- Contains authoritative mapping logic
- Enriches protein data from external sources (MobiDB, RVIS, HPA, KEGG)

### Prompter (browser UI)
- Thin presentation layer for protein data
- Card gallery display, prompt generation
- Calls backend APIs for all data processing

## Data Flow
1) Fetch → Cache: Local Writer saves `data/proteins/uniprot/<id>.json` when Prompter fetches a UniProt ID.
2) Normalize → Features: `protein_db.py rebuild` creates `data/proteins/features.csv` (mass, length, domains, locations, keywords, etc.).
3) Map → Persona: `protein_db.py rebuild-persona` applies `data/mapping.json` to features and writes `data/proteins/persona.csv`.
4) Prompting: Prompter calls `/apply-mapping` API to get persona overrides from backend and produces prompts for copy/export.

## Contracts
- Mapping JSON: Declares `molecular`, `human`, and `mappings` (numeric multiplier/log and categorical bins).
- Features CSV: Canonical extracted features; values form the sources used by mapping.
- Persona CSV: Stable columns `uniprot_id`, `gene_symbol`, `short_name` plus any `human` variables.

## API Endpoints (Local Writer)
- `GET /health`: Server status and configuration
- `GET /mobidb/<id>/percent`: MobiDB disorder percentage data
- `POST /put/<id>`: Store protein JSON and update CSVs
- `POST /apply-mapping`: Apply mapping rules to protein data
  - Body: `{"protein": {...}, "mapping": {...}}`
  - Returns: `{"mapped": {...human attributes...}}`
- `POST /shutdown`: Graceful server shutdown

## Notes
- Writes are cache‑friendly and safe to delete. Rebuilds are deterministic given the same inputs.
- Windows file locks: if `persona.csv` is open, rebuild writes `persona.csv.next` and logs a warning to avoid failures.
- **Single source of truth**: All mapping logic lives in Python backend; frontend calls APIs for consistency.

