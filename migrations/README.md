# GeneGuessr data owners

This directory is D1 migration **history**, not a current map of every game
write. Start with the live schema and the owners below before adding a table or
another cache. In particular, `001_init.sql` created `games`, but
`0022_drop_dead_games_table.sql` removed it. A new game feature must not revive
that historical table by assuming the first migration is the current schema.

- **Protein catalog and search:** D1 `proteins`, `protein_synonyms`, and
  trigger-maintained `protein_search`; reads go through
  `workers/lib/protein-store.js`.
- **Embeddings:** D1 `protein_embeddings` is independent of the search tables.
  `scripts/load_esm2_embeddings.py` is the checked-in ESM2 loader.
- **Daily answer:** The existing stateful Worker owns the server-side
  `puzzle_actual:YYYY-MM-DD` KV record. D1 `daily_target_availability_pins`
  records structure replacements.
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
