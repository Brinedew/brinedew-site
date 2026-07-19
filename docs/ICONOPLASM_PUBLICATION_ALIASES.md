# Iconoplasm publication aliases

Read this before changing which names the Iconoplasm browser extension recognizes.

## Ownership

Iconoplasm has two complementary alias sources:

| Data                                                       | Owner                            | Source                                      | Release path                     |
| ---------------------------------------------------------- | -------------------------------- | ------------------------------------------- | -------------------------------- |
| Broad biological synonyms from the approved gene authority | Workstation publication pipeline | Generated catalog field `a`                 | Website Ops catalog publication  |
| Small, human-curated labels seen in papers and web pages   | Website runtime                  | `workers/iconoplasm-publication-aliases.js` | Normal Website commit and deploy |

Use the generated catalog for authoritative biological synonym coverage. Use the curated overlay when a real page uses a useful label that the generated catalog does not recognize correctly.

The browser extension is a consumer of both sources. It does not own either alias list.

## Runtime contract

The Website publishes the curated aliases inside the existing catalog manifest:

```json
{
  "publication_aliases": {
    "schema_version": 1,
    "version": "v1-<content hash>",
    "alias_count": 45,
    "removal_count": 1,
    "by_symbol": {
      "RELA": ["p65"]
    },
    "remove_by_symbol": {
      "CDH17": ["cadherin"]
    }
  }
}
```

`by_symbol` is the complete effective addition dictionary. Source code may use the generic Cartesian-product helper to keep a spelling family readable, but expansion happens before validation and publication. The manifest, server cache, extension cache, and live verifier all contain the concrete strings; consumers never interpret spelling rules.

`remove_by_symbol` contains ownership-scoped retractions from the generated catalog. A retraction removes a string only when the named canonical gene currently owns it. It cannot globally block that spelling or erase a mapping owned by another gene.

The overlay version is derived from the validated payload. The catalog-manifest ETag contains both the generated catalog build version and the overlay version, so either kind of change invalidates the short-lived manifest cache without changing the immutable catalog artifact URL.

The stateful Website runtime merges the overlay into its in-memory gene views so public search and identifier resolution use the same curated labels as the extension. The cache key includes the overlay version.

The current extension validates and applies the overlay to its locally cached projection of the generated catalog. It records exact additions and retractions separately. On the next manifest refresh it reverses only the prior policy operations, applies the new concrete dictionary, and preserves unrelated generated aliases.

## Performance contract

An alias-only release must preserve all of these properties:

- no additional network request; the overlay stays in the catalog manifest
- no new generated catalog build
- no change to the immutable catalog artifact URL or base build version
- no full catalog download when the base build version is already cached
- overlay payload below 4 KiB
- five-minute manifest refresh timestamp advances even when neither the catalog nor overlay changed
- server cache rebuild merges only affected genes after indexing the generated catalog

If the curated set can no longer fit comfortably under the payload limit, do not raise the limit by reflex. Reassess whether the entries belong in the generated biological catalog or whether the transport contract needs a deliberately versioned redesign.

## Validation and failure behavior

The overlay validator enforces:

- uppercase canonical symbols
- non-empty alias arrays
- exact, normalized alias strings of at most 64 characters
- at most 500 total additions and retractions in the overlay
- no alias shared by two canonical symbols after case and dash normalization
- no collision with a different canonical symbol when the catalog symbols are available

The server checks curated aliases against generated canonical symbols and generated alias ownership while warming its catalog cache. A symbol that is not present in the current generated catalog is omitted from the server-side merge so a catalog deployment window does not take down the public API. A collision with an existing canonical symbol or another gene's generated alias fails loudly.

The extension is stricter because it owns a complete local catalog snapshot: an unknown target, ambiguity, or canonical collision rejects that overlay update. The previously stored gene map remains available, the contract error is surfaced, and retrying the overlay does not trigger a full catalog download.

## Adding or changing a mapping

1. Confirm the canonical target symbol exists in the published catalog.
2. Edit `RAW_PUBLICATION_ALIASES_BY_SYMBOL` in `workers/iconoplasm-publication-aliases.js`.
3. Preserve every spelling, case, punctuation mark, Greek letter, and spacing form that should match on real pages. When several independent choices produce a spelling family, use `expandIconoplasmPublicationAliasForms`; its returned strings become ordinary dictionary entries in the published manifest.
4. Run the focused contract tests:

   ```powershell
   node --test workers/iconoplasm.publication-aliases.test.js iconoplasm-extension/publication-alias-overlay.test.js iconoplasm-extension/service-worker.test.js workers/iconoplasm.public-media.test.js workers/iconoplasm.search.test.js
   ```

5. Run the repository gates:

   ```powershell
   pnpm check
   pnpm test
   pnpm build
   ```

6. Commit and push through the normal Website deployment pipeline.
7. Verify the live manifest payload and every curated alias through the public resolver:

   ```powershell
   pnpm run verify:iconoplasm-publication-aliases
   ```

The production deployment runs the same verifier after assigning the live Worker routes. It gives both the manifest and resolver a bounded propagation window, then fails the deployment run if the manifest payload differs from the tracked configuration or any alias resolves to the wrong canonical symbol.

After extension 0.5.0 is installed, an alias-policy change does not require Website Ops, an extension version bump, a new package, or a browser-store submission. Clients receive the concrete dictionary from the manifest.

## Retracting an incorrect generated mapping

Add the alias under its current canonical owner in `RAW_PUBLICATION_ALIAS_REMOVALS_BY_SYMBOL`. Do not add the same spelling to a blocklist: retractions are data corrections, and the spelling may later be valid for a different gene.

If the label should resolve to another canonical gene, add that concrete mapping to `RAW_PUBLICATION_ALIASES_BY_SYMBOL` in the same release. Validation and live verification ensure that the old ownership is removed before the new ownership is applied.

## Rollback

Revert the curated mapping change and deploy the Website normally. The overlay content hash and manifest ETag change automatically. On its next manifest refresh, the extension removes the reverted overlay aliases without downloading the base catalog again. Server search and resolution rebuild against the reverted overlay version.

## Changing the schema

Changing mappings is ordinary data maintenance. Changing the shape or semantics of `publication_aliases` is a protocol change.

For a protocol change:

1. update Website serialization and validation
2. update the extension overlay validator and cache bookkeeping
3. bump the overlay schema version
4. add compatibility tests for the previous and new extension behavior
5. update `iconoplasm-extension/API_COMPAT.md`
6. bump, package, and release the extension before making the new schema mandatory

## Code map

| Responsibility                                          | File                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Curated mappings, validation, content hash              | `workers/iconoplasm-publication-aliases.js`                                                       |
| Manifest publication, ETag, server search/resolve merge | `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js` |
| Extension overlay validation and reversible application | `iconoplasm-extension/publication-alias-overlay.js`                                               |
| Extension manifest refresh and cache decisions          | `iconoplasm-extension/service-worker.js`                                                          |
| Website validation and payload-size tests               | `workers/iconoplasm.publication-aliases.test.js`                                                  |
| Extension matching and rollback tests                   | `iconoplasm-extension/publication-alias-overlay.test.js`                                          |
| No-refetch and retry tests                              | `iconoplasm-extension/service-worker.test.js`                                                     |
| Live manifest and resolver verification                 | `scripts/verify-iconoplasm-publication-aliases.mjs`                                               |
| API compatibility boundary                              | `iconoplasm-extension/API_COMPAT.md`                                                              |
