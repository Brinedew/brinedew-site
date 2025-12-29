# Website Scripts

## Protein data enrichment

`enrich-proteins.py` - Enriches protein wiki pages with data from Cellulore.
- Source: `../Datasets/cellulore/proteins_with_demographics.json`
- Updates frontmatter in `content/wiki/*.md` files tagged as proteins
- Generates image prompts for missing protein portraits

## Other scripts

- `generate-protein-pages.py` - Creates new protein wiki pages
- `analyze-protein-pages.py` - Analyzes existing protein pages
- `uniprot-fetcher.py` - Fetches data from UniProt API
- `clean_tags.py` - Tag cleanup utilities
- `generate_favicon.py` - Generates site favicon

## GeneGuessr pipeline

The GeneGuessr data pipeline is in `D:\Coding\Datasets\GeneGuessr\` (separate project).

Scripts in that pipeline:
- `step_0_build_index.py` through `step_4_upload_to_d1.py`
- Generates `proteins.json` for production D1

## Embedding/similarity tools

- `load_esm2_embeddings.py` - ESM-2 embedding loader
- `precompute_topk_ladder.py` - Precomputes similarity ladders
- `upload_ladder_to_kv.py` - Uploads ladders to Cloudflare KV
- `similarity_toolkit.py` - Similarity computation utilities
