# Data seeding helpers

`upload_local_database.py` is now the one-button task for B-131 Phase 1 and uses the dataset under `tools/thoteins/data/geneguessr/`.

## Local dry run

```bash
# Default: seeds from tools/thoteins/data/geneguessr/embedding_proteins.json
python scripts/upload_local_database.py
```

- Rebuilds `proteins`, `protein_synonyms`, and `protein_embeddings` inside the local D1 snapshot.
- Pulls metadata from `tools/thoteins/data/geneguessr/embedding_proteins.json` (default) and vectors from `tools/thoteins/data/embeddings/hig2vec_human_200dim.pth`.
- Rejects entries that don’t have a matching embedding and prints a short warning list.
- After inserting, runs validation queries to confirm and prints a stats report:
  - `COUNT(*)` for `proteins` and `protein_embeddings` both match the number of inserted rows.
  - The FGA accession (`P02671`) exists, so we know clues work for canonical samples.
- Extra `[stats]` lines summarize how many metadata rows were matched, which accessions lacked embeddings, the HiG2Vec file hash/size, and the D1 row counts. Keep these logs in release notes if we suspect data drift.

## Embedding token export

- `python scripts/export_embedding_tokens.py` walks `hig2vec_human_200dim.pth`, skips GO terms, and writes `tools/thoteins/data/geneguessr/embedding_tokens.json` (currently 19,622 unique protein tokens). This file is the canonical roster before we fetch metadata in later phases.
- `python scripts/map_embedding_tokens.py` joins that roster against our Thoteins mappings (features.csv + existing metadata) and emits `embedding_token_mappings.json` (resolved tokens) plus `embedding_tokens_needing_mapping.json` (unresolved).
- `python scripts/build_embedding_metadata.py` consumes the resolved mappings, pulls metadata directly from the raw Thoteins datasets (features.csv + UniProt JSON snapshots), and produces `embedding_proteins.json`, which is the new vector-driven metadata payload.

## Remote seeding (manual)

Seeding the D1 database is a manual step and is not run as part of CI by default. If you'd like to seed the *full embedding roster* instead of the curated Geneguessr dataset, follow these steps:

```bash
# Export tokens from the embedding file (writes embedding_tokens.json)
python scripts/export_embedding_tokens.py

# Map those tokens to metadata (writes embedding_token_mappings.json + unresolved list)
python scripts/map_embedding_tokens.py

# Build a metadata file for the embedded roster (writes embedding_proteins.json)
python scripts/build_embedding_metadata.py

```bash
# Build site payload from the full embedding roster (default)
python scripts/populate_local_database.py

Note: The populate script now builds directly from the embedding roster and does
not enforce length or domain filters — vectors are the ground truth for the
Geneguessr payload.

# Seed the remote D1 using the full embedding metadata (defaults to embedding_proteins.json)
python scripts/upload_local_database.py --metadata-file tools/thoteins/data/geneguessr/embedding_proteins.json --remote
```
```
- Seeding large datasets may be slow and may require network/Cloudflare credentials.
- The loader will skip entries without a matching embedding; it validates counts and exits non-zero on failure.


## CI integration

- CI does not automatically seed D1. The `deploy-quartz.yml` workflow installs the loader prerequisites but *does not* run `upload_local_database.py`. Database seeding is manual to avoid accidental overwrites; see the `Remote seeding (manual)` section above for the safe sequence.
- After the loader runs, update `tools/thoteins/data/geneguessr/version.json` with the stats it prints (timestamp, embedding hash/size, metadata rows, D1 rows). This manifest is the audit log for Phase 6.

## Legacy scripts

- `seed_proteins_d1.py` and `load_hig2vec_embeddings.py` still exist for debugging, but the combined loader supersedes them. Use them only if you need to inspect individual SQL statements.
