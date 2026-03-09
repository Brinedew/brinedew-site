# Iconoplasm Extension/API Compatibility

## Canonical ID policy
- Canonical app key is **gene symbol** (`s` in artifact, `canonical_symbol` in API).
- UniProt (`u`) is optional metadata only.
- User-facing page routes are symbol-first: `/gene/<SYMBOL>`.

## Compatibility matrix
| Extension version | Expected manifest route | Artifact schema | Gene page links |
|---|---|---|---|
| `0.3.x` | `/api/manifest` | v3 (`s`,`c?`,`n`,`u`,`tmh`,`pt?`,`ph?`) | `/gene/<symbol>` |

## API surface (Phase 2 gate)
- `GET /health`
- `GET /api/manifest`
- `GET /api/catalog/catalog.<hash>.json`
- `GET /api/gene/:symbol` (symbol canonical only)
- `GET /gene/:symbol`

## Cache behavior
- Manifest: short cache + ETag (`max-age=300`)
- Gene API: short cache + ETag (`max-age=120`)
- Artifact and portraits: immutable long cache (hash-addressed keys)
