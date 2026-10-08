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
  19,110, all distinct, on 2026-10-03) under `idx_proteins_gene`. Never write
  `upper(gene) = ?` or `upper(gene) IN (...)`: the function defeats the index and
  reads the whole table. A new importer must write genes upper-case. The practice
  gene-list box does not query this table: it resolves in the browser from
  `protein-index.json`.
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
- **Leaderboard:** D1 `leaderboard_streaks` holds exactly the accounts the "Top Streaks"
  box can show (public, streak above 0), with one covering index that starts with the played
  day, so a read takes about 4 x limit + 8 rows whatever the number of accounts (26 at limit 5
  on 2026-10-03, against 29,585 for the join over 100,000 accounts). Four triggers on `stats`
  and on `users.leaderboard_opt_in` keep it equal to that join.
  `workers/lib/leaderboard-streaks.js` creates the table, the index and the triggers on first use
  and fills it from `stats` and `users` (37,428 rows read at 100,000 accounts, once, with the
  join order pinned); no migration here creates or changes it. A new writer of `stats` or of
  `users.leaderboard_opt_in` needs nothing: the triggers see it. A table rebuild that drops
  `stats` or `users` drops the triggers; drop `leaderboard_streaks` too and the next read
  rebuilds it. The page reads the board from the object `leaderboard/v1/top.json` on the CDN, which
  `workers/lib/leaderboard-publication.js` rebuilds from this table every ten minutes or so;
  `GET /api/stats/leaderboard` is its fallback. Migration 0016's index on
  `users.leaderboard_opt_in` is not part of the schema: nothing reads it, and production no longer
  has it (B-966, B-975).
- **Guess aggregates:** D1 `daily_guess_aggregate` is created on first use by
  `workers/lib/guess-aggregates.js`, which keeps its primary key `(day, guess_uniprot)` as the
  only index (production no longer has the second one, B-964, B-975); a guess writes 1 row, 2 for
  a protein's first of the day.
- **Failed session writes:** D1 `game_session_write_failures_do_not_delete` holds only failed
  Durable Object session writes: one row for each day, operation, session kind and error class,
  with a count that is a lower bound and the first message as the example. D1 takes at most one
  write a key every five minutes, so a day costs a bounded number of rows whatever the number of
  failures (B-963). A successful write records nothing.
  `workers/lib/game-session-write-evidence.js` creates the table on the first failure or the first
  `GET /api/admin/status` read, prunes it after 14 days, and drops the two per-minute tables an
  earlier version wrote.
- **Failed structure cache:** `workers/lib/protein-store.js` uses D1
  `structure_failures`.

The old `step_4_upload_to_d1.py` and `upload_embeddings.py` named in this README
are not present in this repository. Do not treat their former descriptions,
fixed vector count, or a claimed automatic rebuild as a current operations
contract. Check the live producer and current D1 journal before changing catalog
data. Keep embeddings intact during ordinary protein catalog updates.
