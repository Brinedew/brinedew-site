# Iconoplasm authoring authority migrations

This migration stream belongs only to the private `ICONOPLASM_AUTHORING_DB`
binding. It stores bounded caretaker, lineage, revision metadata, canonical
selection, idempotency receipts, and replication events. It must never be
pointed at the primary `ICONOPLASM_DB`.

Manifestation prose and derived Tags bodies are encrypted before being written
to the existing Bunny Storage zone. D1 stores plaintext hashes and byte counts
for integrity and quota enforcement, plus the wrapped per-object data key needed
to decrypt an eligible revision. Public CDN access can expose only ciphertext.

Migrations are append-only. Production deploys apply this directory before
uploading a Worker that can accept caretaker commands.

The only valid order is:

1. `0001_caretaker_manifestation_authority.sql` - immutable authority core.
2. `0002_caretaker_server_boundary.sql` - bounded upload, sync, backup, and service state.
3. `0003_manifestation_authority_cutover.sql` - resumable legacy cutover ledger.
4. `0004_caretaker_terms_2026_08_30.sql` - immutable active public terms version.

<!-- ARCHITECTURE FENCE [IPD-012] -->
