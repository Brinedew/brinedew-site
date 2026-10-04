# Iconoplasm authoring authority migrations

This migration stream belongs only to the private `ICONOPLASM_AUTHORING_DB`
binding. It stores bounded caretaker, lineage, revision metadata, canonical
selection, idempotency receipts, and replication events. It must never be
pointed at the primary `ICONOPLASM_DB`.

Manifestation prose and derived Tags bodies are plain-text objects in the
existing private Bunny Storage zone, which has no Pull Zone. D1 stores their
hashes and byte counts for integrity and quota enforcement.

The storage tables keep the columns of an older envelope format
(`ciphertext_sha256`, `ciphertext_bytes`, `body_iv_base64`, `wrapped_dek_base64`,
`wrap_iv_base64`, `key_version`, `aad_version`). A plain body fills them like
this: `ciphertext_sha256` is the object's hash, `ciphertext_bytes` is the text
length plus 16 (the table's `>= 17` check and the revision insert trigger need
exactly that), the three key fields are empty, and both versions are 1. Older
rows hold real envelope values. A reader tells the two apart by hashing the
object, never by a flag (`workers/lib/iconoplasm-manifestation-body-reader.js`).

The numbered SQL files here are the complete, append-only migration history;
the production D1 migration journal records what has actually run. Use the
`ICONOPLASM_AUTHORING_DB` binding in
`wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml`.
A schema change reaches production only through the release, never from a
laptop or an agent shell, which have no production D1 credential (B-1002).
A reviewed online migration (marked `"online": true` in
`cloudflare/operation-cost-migration-plan.json`) is applied by
`scripts/apply-online-d1-migrations.mjs` on the ordinary push to `main`, with
the CI Cloudflare token and the config above; any other migration runs in a
`workflow_dispatch` of the production deploy with `data_maintenance=true`.
Either way `wrangler d1 migrations apply` records the file in the D1 journal.
Do not repeat the DDL in a Worker or an ad hoc API call. The data-maintenance
preflight also reads this journal, and a deploy that finds changed SQL files
the journal does not hold refuses with `CODE_RELEASE_REQUIRES_MAINTENANCE`.

`0018_assignment_manifestation_lookup.sql` indexes only manifestations with
an assignment. The lookup still returns the latest withdrawn caretaker or fork
manifestation; most system-seeded manifestations never enter the index.

`0019_bounded_cutover_backup.sql` backfills the existing backup's progress
once, then lets the owning artifact maintain its counts and indexed resume
cursor. That backup was abandoned unfinished (B-800) and its operator deleted;
off-platform recovery is the nightly `scripts/backup-d1-rotation.mjs` dump (B-830).

<!-- ARCHITECTURE FENCE [IPD-012] -->
