# Website Scripts

## Other scripts

- `generate-protein-pages.py` - Creates new protein wiki pages
- `analyze-protein-pages.py` - Analyzes existing protein pages
- `uniprot-fetcher.py` - Fetches data from UniProt API
- `clean_tags.py` - Tag cleanup utilities
- `generate_favicon.py` - Generates all favicon assets from `quartz/static/logo-mask.png`
- `manage-quickadd-content-vault.ps1` - Hard-cutover QuickAdd setup for `content/` vault

## GeneGuessr pipeline

The GeneGuessr data pipeline is in `D:\Coding\Datasets\GeneGuessr\` (separate project).

Scripts in that pipeline:

- `step_0_build_index.py` through `step_4_upload_to_d1.py`
- Generates `proteins.json` for production D1

## Embedding/similarity tools

- `load_esm2_embeddings.py` - ESM-2 embedding loader
