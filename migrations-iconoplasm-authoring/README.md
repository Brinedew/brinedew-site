# Iconoplasm authoring authority migrations

This migration stream belongs only to the private `ICONOPLASM_AUTHORING_DB`
binding. It stores bounded caretaker, lineage, revision metadata, canonical
selection, idempotency receipts, and replication events. It must never be
pointed at the primary `ICONOPLASM_DB`.

Manifestation prose and derived Tags bodies are encrypted before being written
to the existing Bunny Storage zone. D1 stores plaintext hashes and byte counts
for integrity and quota enforcement, plus the wrapped per-object data key needed
to decrypt an eligible revision. Public CDN access can expose only ciphertext.

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

<!-- ARCHITECTURE FENCE [IPD-012] -->
