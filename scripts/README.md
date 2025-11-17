# Data seeding helpers

`load_proteins_from_embeddings.py` is now the one-button task for B-131 Phase 1.

## Local dry run

```bash
python scripts/load_proteins_from_embeddings.py
```

- Rebuilds `proteins`, `protein_synonyms`, and `protein_embeddings` inside the local D1 snapshot.
- Pulls metadata from `workers/data/proteins.json` and vectors from `tools/thoteins/data/embeddings/hig2vec_human_200dim.pth`.
- Rejects entries that don’t have a matching embedding and prints a short warning list.
- After inserting, runs validation queries to confirm:
  - `COUNT(*)` for `proteins` and `protein_embeddings` both match the number of inserted rows.
  - The FGA accession (`P02671`) exists, so we know clues work for canonical samples.

## Remote seeding

```bash
python scripts/load_proteins_from_embeddings.py --remote
```

- Skips the wrapping transaction (unnecessary for remote D1) but otherwise performs the same logic.
- Validation still runs against the remote database, so if either count check fails or `P02671` is missing the script exits non‑zero.

## Legacy scripts

- `seed_proteins_d1.py` and `load_hig2vec_embeddings.py` still exist for debugging, but the combined loader supersedes them. Use them only if you need to inspect individual SQL statements.
