# Iconoplasm Extension/API Compatibility

For publication-alias ownership, performance invariants, maintenance, and rollback, read `../docs/ICONOPLASM_PUBLICATION_ALIASES.md`.

## Canonical ID policy

- Canonical app key is **gene symbol** (`s` in artifact, `canonical_symbol` in API).
- UniProt (`u`) is optional metadata only.
- User-facing page routes are symbol-first: `/gene/<SYMBOL>`.

## Compatibility matrix

| Extension version | Expected manifest route           | Artifact schema                                       | Publication aliases                 | Gene page links  |
| ----------------- | --------------------------------- | ----------------------------------------------------- | ----------------------------------- | ---------------- |
| `0.4.0`–`0.4.7`   | `/api/public/v1/catalog/manifest` | v4 (`s`,`c?`,`n`,`u`,`a?`,`tmh`,`pt?`,`ph?`)          | Generated artifact aliases only     | `/gene/<symbol>` |
| `0.4.8+`          | `/api/public/v1/catalog/manifest` | v4 base artifact + optional manifest overlay schema 1 | Tracked, versioned manifest overlay | `/gene/<symbol>` |

## API surface (public cutover)

- `GET /health`
- `GET /api/public/v1/metadata`
- `GET /api/public/v1/schema`
- `GET /api/public/v1/catalog/manifest`
- `GET /api/public/v1/catalog/catalog.<hash>.json`
- `GET /api/public/v1/dumps/catalog.<hash>.jsonl`
- `GET /api/public/v1/genes/:symbol` (symbol canonical only)
- `POST /api/public/v1/genes/batch`
- `POST /api/public/v1/resolve`
- `GET /api/public/v1/changes?since=<ISO timestamp>`
- `GET /api/public/v1/genes/search`
- `GET /api/public/v1/gallery`
- `GET /gene/:symbol`

## Cache behavior

- Metadata + catalog manifest: short cache + ETag (`max-age=300`)
- Gene API + batch + change feed: short cache (`max-age=120`)
- Catalog artifact, JSONL dump, and portraits: immutable long cache (hash-addressed keys)
- Human-curated publication aliases are inlined in the catalog manifest. Alias-only releases reuse the cached base artifact and do not add a request or download the full catalog again.
