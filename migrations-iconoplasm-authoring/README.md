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
For a small, measured schema change, use Cloudflare's standard commands from
the repository root, with the config above:

```sh
pnpm exec wrangler d1 migrations list ICONOPLASM_AUTHORING_DB --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml
pnpm exec wrangler d1 migrations apply ICONOPLASM_AUTHORING_DB --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml
```

The apply command records the pending file in the D1 journal. Do not repeat
the DDL in a Worker or an ad hoc API call. The existing data-maintenance
preflight also reads this journal. A normal deploy verifies that changed SQL
files are already journaled; it does not apply schema changes.

`0018_assignment_manifestation_lookup.sql` indexes only manifestations with
an assignment. The lookup still returns the latest withdrawn caretaker or fork
manifestation; most system-seeded manifestations never enter the index.

`0019_bounded_cutover_backup.sql` backfills the existing backup's progress
once, then lets the owning artifact maintain its counts and indexed resume
cursor. That backup was abandoned unfinished (B-800) and its operator deleted;
off-platform recovery is the nightly `scripts/backup-d1-rotation.mjs` dump (B-830).

<!-- ARCHITECTURE FENCE [IPD-012] -->
