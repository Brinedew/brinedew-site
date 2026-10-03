# GeneGuessr data owners

This directory is D1 migration **history**, not a current map of every game
write. Start with the live schema and the owners below before adding a table or
another cache. In particular, `001_init.sql` created `games`, but
`0022_drop_dead_games_table.sql` removed it. A new game feature must not revive
that historical table by assuming the first migration is the current schema.

- **Protein catalog and search:** D1 `proteins`, `protein_synonyms`, and
  trigger-maintained `protein_search`; reads go through
  `workers/lib/protein-store.js`. `proteins.uniprot` is `UNIQUE` and holds
  upper-case accessions (19,110 of 19,110 on 2026-10-03). A reader binds an
  upper-cased value and compares the bare column with `=`, so the lookup is one
  index search. Never write `upper(uniprot) = ?` or `lower(uniprot) = ?`: the
  function defeats the index and reads the whole table. The structure-bytes
  route (`/api/structure-cached?key=`) looks a protein up this way on every
  SWISS-MODEL or AlphaFold request, and
  `workers/structure-cached-key-lookup-cost.test.js` pins one row read per
  request. A new importer must write accessions upper-case. `proteins.gene`
  holds upper-case, trimmed symbols made of `A-Z`, `0-9` and `-` (19,110 of
  19,110, all distinct, on 2026-10-03) under `idx_proteins_gene`. The practice
  gene-list resolver (`POST /api/game/practice/resolve`) upper-cases each pasted
  symbol and compares the bare column with `IN`, so a paste costs about three rows
  per symbol. Never write `upper(gene) IN (...)`: it reads the whole table per
  chunk of 100 symbols. A new importer must write genes upper-case, because a
  lower-case stored gene would be invisible to the resolver;
  `workers/practice-resolve-cost.test.js` pins the index search and the rows read.
- **Embeddings:** D1 `protein_embeddings` is independent of the search tables.
  `scripts/load_esm2_embeddings.py` is the checked-in ESM2 loader.
- **Daily answer:** The existing stateful Worker owns the server-side
  `puzzle_actual:YYYY-MM-DD` KV record. D1 `daily_target_availability_pins`
  records structure replacements.
- **Daily selection pool:** D1 `daily_selection_pool` holds the playable surname
  families as one row, kept fresh by triggers on `proteins`. `workers/lib/protein-store.js`
  creates it on first use; no migration here creates or changes it
  (`docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md`, "Pool storage").
- **Practice selection pool:** D1 `practice_selection_pool` holds the practice
  surname families as one row, valid while it matches the `catalog_version` of
  `daily_selection_pool`, so the same triggers keep it fresh.
  `workers/lib/protein-store.js` creates it on first use; no migration here creates
  or changes it (`docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md`, "Practice pool").
- **Game attempt and completed result:** The existing `GameSession` Durable
  Object in `workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js`
  owns game state. `workers/lib/the-only-geneguessr-completed-result-ledger-do-not-duplicate.js`
  retains results pending stats projection. There is no live D1 `games` table.
- **Account stats:** `workers/stats.js` projects durable completed results into
  D1 `stats`.
- **Accounts:** D1 `users` and the existing Worker/auth path own account and
  session state.
- **Failed structure cache:** `workers/lib/protein-store.js` uses D1
  `structure_failures`.

The old `step_4_upload_to_d1.py` and `upload_embeddings.py` named in this README
are not present in this repository. Do not treat their former descriptions,
fixed vector count, or a claimed automatic rebuild as a current operations
contract. Check the live producer and current D1 journal before changing catalog
data. Keep embeddings intact during ordinary protein catalog updates.
