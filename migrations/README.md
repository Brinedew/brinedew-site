# GeneGuessr Migrations

## Table ownership

| Table | Owner | Notes |
|-------|-------|-------|
| `proteins` | step_4_upload_to_d1.py | Rebuilt on every pipeline run |
| `protein_synonyms` | step_4_upload_to_d1.py | Rebuilt on every pipeline run |
| `protein_embeddings` | upload_embeddings.py | **Static reference data - upload once** |
| `users`, `games`, `stats` | Worker runtime | User/game state, never touch in migrations |
| `structure_failures` | Worker runtime | Cache of failed structure fetches |

## Critical rule

**Never drop `protein_embeddings` in a migration.**

The embeddings are 19,622 gene vectors from HiG2Vec (200 dimensions each). They're keyed by gene symbol and don't change when the protein list changes. Uploading them takes time and bandwidth - they should be uploaded once and left alone.

If you need to change the embeddings schema:
1. Create a new migration that preserves the data
2. Or re-run `upload_embeddings.py --remote` after the migration

## How it works

- `proteins` and `protein_synonyms` are rebuilt from scratch on each pipeline run
- `protein_embeddings` is independent - keyed by gene symbol, not protein ID
- The worker joins proteins to embeddings via gene symbol for similarity scoring
