# Iconoplasm publication aliases

Read this before changing which names the Iconoplasm browser extension, public
search, resolver, or compatibility artifacts recognize.

## Ownership

Iconoplasm has two complementary alias sources:

| Data                                             | Owner                            | Authority                                      | Release path                                    |
| ------------------------------------------------ | -------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Broad biological synonyms                        | Workstation publication pipeline | Generated catalog field `a`                    | Website Ops catalog publication                 |
| Small, observed labels from papers and web pages | Administrator                    | `icono_publication_alias_policy` desired state | Save in `/admin#extension`; Worker publishes KV |
| First-deploy/offline seed                        | Website source                   | `workers/iconoplasm-publication-aliases.js`    | Normal Website deployment                       |

The generated catalog owns broad biological synonym coverage. The curated
policy is for useful page labels that the published scanner does not already
provide correctly. The source dictionary is not the routine editing surface;
it is the revision-1 bootstrap used only before a valid recognition-pair bundle
exists.
The extension consumes both sources and owns neither.

## Desired state and public projection

Migration `0066_publication_alias_policy.sql` seeds the exact existing 45
additions and one ownership-scoped removal. D1 stores one current desired row
plus the newest 100 audit revisions. Every successful save uses
`expected_revision` compare-and-swap and records the exact desired blocklist
revision against which it was validated.

Migration `0067_recognition_policy_validation.sql` adds one singleton
recognition-validation receipt. It records `valid`, `invalid`, or `unvalidated`
for one exact tuple: validator revision, published scanner build, alias
revision/version, and blocklist revision/version. This is bounded control state,
not another history or public projection.

The alias publisher writes immutable, zero-padded revision keys under
`iconoplasm:publication-alias-policy:v1:revision:` and retains at most 100.
Those individual records are publication inputs and audit/history, not the
anonymous read authority. A content-addressed record under
`iconoplasm:publication-alias-policy:v1:version:` gives old immutable
compatibility URLs a one-GET historical alias lookup.

Anonymous manifest, search, and resolver paths select one newest valid atomic
bundle under `iconoplasm:recognition-policy-pair:v1:`. Each bundle contains an
exact six-field alias payload and exact five-field blocklist payload plus
private dependency revisions. One KV value is therefore the cross-region
consistency boundary: a colo can observe the old bundle or the new bundle, but
never a mixed alias/blocklist pair. The normal cold read is one bounded key
list and one value GET, then a five-second isolate cache. It never queries D1.

The source alias seed is used only while the pair namespace is genuinely
empty. During the first deployment, it is combined with the newest retained
legacy blocklist that has no alias dependency. Once any pair key exists,
missing, malformed, or corrupt values fail closed (or retain the isolate's
last-known-good pair); they never reactivate bootstrap state.

The existing public protocol is unchanged:

```json
{
  "publication_aliases": {
    "schema_version": 1,
    "version": "v1-<content hash>",
    "alias_count": 1,
    "removal_count": 1,
    "by_symbol": {
      "CXCL8": ["IL8"]
    },
    "remove_by_symbol": {
      "CDH17": ["cadherin"]
    }
  }
}
```

Revision and dependency metadata are deliberately not added to this object.
The content-derived `version` still participates in the catalog-manifest ETag,
so an alias-only change refreshes the manifest without rebuilding the catalog
or changing the extension protocol.

`by_symbol` is the complete curated addition dictionary. Consumers receive
concrete strings and never interpret spelling rules. `remove_by_symbol`
contains owner-scoped corrections: a removal affects only the named canonical
gene and cannot suppress the same spelling when another gene owns it.

## Cross-policy safety

Publication aliases and the shared extension blocklist are one recognition
system even though their public payloads remain separate. On a true semantic
mutation, the route first normalizes and size-checks the candidate, then reads
the scanner artifact once. One fused traversal builds the canonical, collision,
and published-owner indexes used to validate both the alias candidate and every
desired blocklist term. The route re-reads the small catalog manifest to reject
a scanner flip, and the D1 CAS saves the policy revision and exact `valid`
receipt in the same batch. A purely normalized no-op skips this pre-save scanner
work.

Each saved row persists the exact counterpart dependency revision. An
individual publisher may stage a revision only after that dependency is
visible. Receipt-backed publishers also assert that every D1 row they re-read
still matches the validated tuple; a bare boolean can never bypass validation.
The reconciler re-reads both desired rows and the scanner manifest after
validation and again before pair publication, so a concurrent save or scanner
flip cannot publish under an older proof. It then writes one immutable
recognition-pair bundle. Public readers advance only at that final single-value
boundary.

Reconciliation first directly GETs the exact desired immutable keys. It reads
the current scanner version from the small manifest and accepts scan bypass only
when the singleton receipt is `valid` for that exact scanner and policy tuple.
A missing, stale-validator, or scanner-mismatched receipt claims a bounded lease
and performs one fused revalidation. A deterministic 422 result is stored as
`invalid`, preventing every cron tick from rescanning the same bad tuple; an
active same-target lease returns a retryable 503 without touching the scanner
artifact. Lease claim and completion are SQL-guarded by the current policy rows.

Cleanup mode is explicit. Foreground admin saves call reconciliation with
cleanup disabled, so an unchanged propagation retry never lists retained
history. The default scheduled reconciler owns bounded best-effort cleanup for
all three immutable namespaces. It cleans alias, blocklist, and pair histories
even when the exact desired pair already exists, and it enables pair cleanup
when staging a new bundle. Cleanup never grants scanner-validation authority and
never reads the scanner artifact.

The v1 recognition-pair key and public value deliberately do not encode scanner
version, so an existing exact pair alone is not proof after scanner evolution.
It is accepted only with a valid current-scanner receipt. This preserves the
unchanged public pair, alias, and blocklist schemas without allowing stale
validation to survive a catalog publication.

The scheduled reconciler runs blocklist, aliases, then blocklist once more. This
orders both safe transition shapes in one bounded pass:

- adding an alias before adding that alias to the blocklist; and
- removing a blocklist term before removing the alias that justified it.

A save may therefore succeed while publication remains pending. This is not a
partial write: D1 keeps the durable desired revision and the 15-minute
reconciler retries the dependency-ordered projection. The admin response marks
the saved-but-pending state explicitly.

## Validation

The server enforces all of the following before the D1 CAS:

- uppercase canonical symbols that exist in the published scanner;
- exact normalized aliases, no control characters, and at most 64 characters;
- at most 500 total additions and removals and a public payload below 4 KiB;
- no collision with another canonical symbol or another gene's generated alias;
- a newly added alias already generated for the same target is rejected as
  `already_generated_for_target` (the catalog already provides it);
- a newly introduced removal must currently belong to the named target; and
- every desired shared-blocklist term remains one unambiguous non-canonical
  alias after applying the candidate policy.

Persisted additions and removals are grandfathered when the generated scanner
later evolves. Existing additions that become generated are harmless; an
existing owner-scoped removal that becomes a no-op is also harmless. This lets
an unrelated admin edit succeed without silently deleting historical intent.

The extension independently validates the complete manifest overlay. A bad
refresh never replaces its last-known-good gene map and never triggers a full
catalog download.

## Adding `IL8` to `CXCL8`

1. Open `/admin#extension` and choose **Alias mappings**.
2. Enter `IL8`, search the published canonical-gene picker for `CXCL8`, and add
   the mapping to the draft.
3. Review the draft and publish it. The request sends the complete desired
   `by_symbol` and `remove_by_symbol` dictionaries with `expected_revision`.
4. Confirm that the response is in sync. If it is saved but pending, leave the
   desired policy intact; reconciliation will publish it after its persisted
   dependency becomes visible.
5. Verify a fresh public catalog manifest and public search/resolution after the
   Website deployment containing migration 0066 is live.

Routine mapping changes require no source edit, catalog publication, extension
version bump, package build, or store submission. The installed extension
already understands this unchanged optional manifest object.

## Performance and failure contract

An alias-only revision preserves these properties:

- no additional extension request or polling timer;
- no generated-catalog or scanner rebuild;
- one scanner artifact read and one fused recognition-index build for a true
  mutation or lazy receipt repair, then zero scanner artifact reads on
  matching-receipt publication retries;
- semantic no-op saves do not create another policy revision or audit-history
  row and skip pre-save scanner work;
- reconciler retries directly GET the exact desired alias, blocklist, and pair
  keys, so CPU is O(policy size) and independent of the 1.9 MiB scanner and the
  100-record staging histories;
- the exact-pair path intentionally reads the small manifest twice (initial
  scanner identity and post-receipt TOCTOU check); staging a new pair adds one
  final pre-publication manifest read, never another scanner-artifact read;
- no full-catalog download when the base build remains cached;
- public payload strictly below 4 KiB;
- anonymous reads never use D1;
- immutable KV history and D1 audit history are each bounded to 100 revisions;
- scheduled reconciliation is the eventual cleanup owner for the three KV
  histories, while foreground saved-state retries remain list-free;
- a normal public refresh costs one pair-key list plus one value GET, independent
  of the 100-record individual histories;
- transient KV failure serves last-known-good state; bootstrap is allowed only
  before any pair key exists, while admin and authoritative reads fail loud;
- historical compatibility alias lookup is one content-addressed GET within the
  bounded 100-revision horizon, uses the current pair directly when that bundle
  reached a colo first, and treats a valid but not-yet-visible snapshot as a
  retryable 503 rather than a permanent 404; and
- cold requests for retained compatibility hashes reconstruct from the matching
  alias version and portrait-reference snapshot, not whichever versions are
  current now.

If the curated set no longer fits comfortably, do not raise the limit by
reflex. Move broad biological coverage to the generated catalog or deliberately
version the transport contract.

## Rollback and schema changes

Rollback is another CAS-protected admin revision: restore the prior complete
dictionary from the bounded audit record and publish a new individual revision
and recognition-pair bundle. Never overwrite an immutable KV revision or pair.
Search, resolver, manifest, and extension caches converge on the new content
hash.

Changing mappings is data maintenance. Changing the shape or semantics of
`publication_aliases` is a protocol change and requires Website serialization,
extension validation/cache changes, a schema bump, compatibility tests,
`iconoplasm-extension/API_COMPAT.md`, and a human-authorized extension release
before the new schema becomes mandatory.

## Code map

| Responsibility                                                                                    | File                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bootstrap seed, normalization, effective-gene merge                                               | `workers/iconoplasm-publication-aliases.js`                                                       |
| D1 desired state, individual KV history, content-addressed alias versions, publication validation | `workers/iconoplasm-publication-alias-policy.js`                                                  |
| Authenticated GET/POST route                                                                      | `workers/iconoplasm-admin-publication-alias-routes.js`                                            |
| Cross-policy reconciliation order and atomic public recognition-pair bundle                       | `workers/iconoplasm-recognition-policy-reconciliation.js`                                         |
| Bounded exact validation receipt, leases, and D1 CAS guards                                       | `workers/iconoplasm-recognition-policy-validation.js`                                             |
| Migration and exact revision-1 seed                                                               | `migrations-iconoplasm/0066_publication_alias_policy.sql`                                         |
| Singleton recognition-validation receipt migration                                                | `migrations-iconoplasm/0067_recognition_policy_validation.sql`                                    |
| Manifest, ETag, search/resolve, compatibility projection                                          | `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js` |
| Extension overlay validation/application                                                          | `iconoplasm-extension/publication-alias-overlay.js`                                               |
| Policy, route, race, fallback, and migration tests                                                | `workers/iconoplasm-publication-alias-policy.test.js`                                             |
| Runtime projection tests                                                                          | `workers/iconoplasm.public-media.test.js`, `workers/iconoplasm.search.test.js`                    |
| Live manifest and resolver verification                                                           | `scripts/verify-iconoplasm-publication-aliases.mjs`                                               |
