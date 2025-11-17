# Data seeding helpers

`load_proteins_from_embeddings.py` is now the one-button task for B-131 Phase 1 and uses the dataset under `tools/thoteins/data/geneguessr/`.

## Local dry run

```bash
python scripts/load_proteins_from_embeddings.py
```

- Rebuilds `proteins`, `protein_synonyms`, and `protein_embeddings` inside the local D1 snapshot.
- Pulls metadata from `tools/thoteins/data/geneguessr/proteins.json` and vectors from `tools/thoteins/data/embeddings/hig2vec_human_200dim.pth`.
- Rejects entries that don’t have a matching embedding and prints a short warning list.
- After inserting, runs validation queries to confirm and prints a stats report:
  - `COUNT(*)` for `proteins` and `protein_embeddings` both match the number of inserted rows.
  - The FGA accession (`P02671`) exists, so we know clues work for canonical samples.
- Extra `[stats]` lines summarize how many metadata rows were matched, which accessions lacked embeddings, the HiG2Vec file hash/size, and the D1 row counts. Keep these logs in release notes if we suspect data drift.

## Embedding token export

- `python scripts/export_embedding_tokens.py` walks `hig2vec_human_200dim.pth`, skips GO terms, and writes `tools/thoteins/data/geneguessr/embedding_tokens.json` (currently 19,622 unique protein tokens). This file is the canonical roster before we fetch metadata in later phases.
- `python scripts/map_embedding_tokens.py` joins that roster against our Thoteins mappings (features.csv + existing metadata) and emits `embedding_token_mappings.json` (resolved tokens) plus `embedding_tokens_needing_mapping.json` (unresolved).
- `python scripts/build_embedding_metadata.py` consumes the resolved mappings, pulls metadata directly from the raw Thoteins datasets (features.csv + UniProt JSON snapshots), and produces `embedding_proteins.json`, which is the new vector-driven metadata payload.

## Remote seeding

```bash
python scripts/load_proteins_from_embeddings.py --remote
```

- Skips the wrapping transaction (unnecessary for remote D1) but otherwise performs the same logic.
- Validation still runs against the remote database, so if either count check fails or `P02671` is missing the script exits non-zero.

## CI integration

- `.github/workflows/deploy-quartz.yml` installs the loader prerequisites and, on `main`, runs `python scripts/load_proteins_from_embeddings.py --remote` before building the static site. It relies on the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets so every production deploy refreshes D1 automatically.
- After the loader runs, update `tools/thoteins/data/geneguessr/version.json` with the stats it prints (timestamp, embedding hash/size, metadata rows, D1 rows). This manifest is the audit log for Phase 6.

## Legacy scripts

- `seed_proteins_d1.py` and `load_hig2vec_embeddings.py` still exist for debugging, but the combined loader supersedes them. Use them only if you need to inspect individual SQL statements.
