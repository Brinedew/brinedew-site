# B-762 / B-771 V1 retirement inventory

Current source audit: 17 September 2026. B-771 owns final decommissioning;
B-725 (workstation), B-726 (lossless authority transfer), B-749 (exact scoped
workflow) and B-764 (compact discovery) retain their separate acceptance.
The older `B-762-SYSOP-V2-HANDOFF.md` records staged implementation history.
Read current code and Linear before treating one of its checkpoints as current.

Migrated genes must work with superseded writers unavailable. Each row names
retained obligations so cleanup does not erase accepted work. An unrelated
unmigrated gene is not a prerequisite for one healthy V2 operation. Global
unbinding follows reconciliation of the responsibilities still using that
binding. **Bypassed** means source routing avoids it; **retired-pending** means
it still exists; **retired-source** means its executable body is gone on this
review branch. None of these labels proves production activation.

| Obsolete item | Actual callers | Job / binding | Surviving requirement | Replacement | Status / removal proof |
| --- | --- | --- | --- | --- | --- |
| `vote_outbox` table, `deliverOutboxRow`, `drainVoteOutbox` | `IconoplasmVoteCoordinator.alarm`, legacy `/vote/set`/`/vote/import`, routing tests | alarm; `ICONOPLASM_VOTE_PROJECTION_QUEUE` via jobs | Accepted votes for genes not yet migrated must still reach D1 readers | Direct v2 hot authority; no projection needed | Bypassed: v2 route writes zero rows (audit `EXCISION`; native probe `legacyOutboxRows: 0`). Retired-pending last-gene migration |
| `scheduleVoteProjectionRefresh`, `enqueueVoteProjectionRefreshJob`, `sendVoteProjectionRefreshQueueMessage` | `deliverOutboxRow`; `deliverCaretakerSupervoteOutbox` (caretaker recompute); administrator reconciliation handlers | `icono_vote_projection_refresh_jobs`; Queue producer | Same as above for un-migrated genes; admin reconciliation for legacy catalog | Per-gene alarm (`drainGenePublication`) | Bypassed for v2 ordinary votes and v2 caretaker changes; admin reconciliation still enqueues until its consumers migrate; retired-pending |
| `handleIconoplasmVoteProjectionQueue`, drain queue messages | Queue consumer | `ICONOPLASM_VOTE_PROJECTION_QUEUE` consumer + DLQ | Un-migrated genes' projections | None for migrated genes | Retired-pending after last migration; keep DLQ drain until then |
| `projectVoteCoordinatorLedgerRow`, `appendVoteEvent` (D1 `icono_image_votes` projection) | `deliverOutboxRow` | D1 writes | Audit/history for pre-v2 votes | Kept as historical records; no new v2 writes | Bypassed for v2; keep historical rows |
| `deliverCaretakerSupervoteOutbox`, `projectCaretakerSupervoteOutboxToD1` | caretaker alarm drain (`drainOutbox`); caretaker assignment/supervote routes enqueue | D1 `icono_caretaker_*` projections; scheduler on recompute | Caretaker authority projection for un-migrated genes and current admin surfaces | v2 assignment/supervote state commits atomically with publication intent; D1 projection stays for unmigrated genes | Bypassed only for v2 votes; assignment now commits atomically with intent. Retired-pending until caretaker D1 consumers migrate |
| Global finalization barrier (`sync-finalization-publication.js`, `unfinished_count = 0`) | historical singleton helpers; legacy gallery publication | Queue/cron | Accepted pending job obligations and exact job versions | Ordinary scoped finalization obtains a matching per-gene V2 receipt before completing a job; no unrelated-ledger gate or scope broadening | Retired from the ordinary finalization caller in the source patch; historical singleton helpers remain pending B-771 and registered IPD-004/IPD-010 enforcement migration |
| `exportAssetSummaries()` on the vote path | election and `/state` export | hot DO reads | Full export remains for admin observability | `geneAuthoritySummaries()` (bounded to candidates) | Removed from hot path: audit `COST` proves zero exports per duplicate vote, flat 35/31 reads from 2 to 10,000 historical assets |
| Legacy bootstrap import in `ensureBootstrapped` | `/vote/set`, `/vote/import`, `/vote/snapshot(s)`, `/state` | D1 reads (`icono_portrait_assets`, `icono_image_votes`) | One-time import for un-migrated genes | v2 guard returns before any D1 binding is required | Guarded: `authority_epoch === "v2"` exits first; rollback keeps v2 votes because the epoch check precedes the destructive import |
| Global card head / dirty-shard publisher (`/wake`, `publisher.step`) | scheduled publication, vote projection | `ICONOPLASM_CARD_PUBLICATION` + KV manifest | Un-migrated catalog publication | `/materialize-symbol` per-gene immutable objects | Kept for un-migrated genes; v2 genes publish without touching head/watermark |
| KV gallery baseline and V2 advertised delta view | hover delivery and card-publication coordinator | KV baseline/head plus immutable Bunny chain/segments | Exact historical views and fresh-reader resolution | `iconoplasm-card-reader-view.js` resolves `<base>.c<chainHash>`; hover delivery consumes the advertised view | Implemented in source; live acceptance belongs to B-762. Preserve baseline objects and historical chains; remove only superseded executable publication behavior |
| Ordinary `/admin/read-models/sync` empty scope and full flags | workstation/admin HTTP caller | read-model handler | Explicit symbol/vision work and truthful handoff/deferral receipts | Reject empty normalized scope and enabled full-rebuild/full-vision flags before both sync services | Retired-source in PR #153; behavioral direct/publication tests. The generic publication wrapper remains a B-749 scope escape and is not certified bounded |
| `repair-iconoplasm-newer-tie-canon.mjs` | historical May repair entrypoint; no other repository caller found | direct Cloudflare D1 plus empty-scope publication | Preserve historical source, accepted images, selections, votes and receipts | Permanent `LEGACY_GLOBAL_REPAIR_RETIRED` exit without imports/network/D1 | Retired-source in PR #153; executable flag-mode tests with network trap and a source anti-rollback test |
| Manifestation singleton authority cutover | `freezeLegacyManifestationWriter`, `activateManifestationAuthority`, authoring/caretaker consumers | primary and authoring D1 singleton rows; encrypted-body migration | Preserve exact bodies, IDs, ordered snapshots and projection obligations | B-726 must reconcile the current global authoring activation with the per-gene vote epoch | Still global in source. The vote epoch alone does not establish complete manifestation/caretaker migration |
| Recovery continuation/executor, old sync-finalization orchestration and launchers | recovery workflows; workstation/tray/Drain paths | production workflows, Queue/cron, local scheduled jobs | Accepted pending obligations, original operation/scope IDs and uncertain receipts | Exact V2 resumable operation; retain historical receipts read-only | Retired-pending B-725/B-749/B-771. Preserving a continuation record does not preserve permission to execute its V1/global path |

## Temporary migration interfaces

| Interface | Purpose | Retirement condition |
| --- | --- | --- |
| `POST /authority/candidates` | bounded candidate import for one gene (also ordinary canonical-affecting updates) | Stays: it is the authority's candidate writer, not migration-only |
| `POST /authority/activate` | complete-input verification, settled outbox, seeded verified published bytes, then epoch flip | Retire when no un-migrated gene remains and rollback cannot be needed |
| `POST /publication/state` | read-only authority/publication observability | Kept as operational surface |
| `POST /materialize-symbol` | exact single-gene materialization for the coordinator's selection | Kept as the per-gene publication primitive |
| Legacy vote projection Queue + finalization jobs | un-migrated genes only | Remove after the last gene's authority transfer is verified and the affected IPD-004/IPD-010 enforcement points are replaced together |

## Non-negotiable survivors

- One stateful Worker; no second state owner or public proxy.
- IPD-001/IPD-011 image identity: immutable objects are written and verified by
  the existing object store; a cache never elects canon.
- Private authoring ciphertext and exact revision identities.
- Human extension-release gate; no store submission from this work.
- B-742/B-749 original operation/scope identity, continuation records, accepted
  obligations and receipts, including uncertain outcomes. These are retained
  evidence; the V1/global executor is not a permanent survivor.
- Generated image bytes, immutable hashes, provenance, assignments, canonicals,
  user/candidate votes, overrides, supervotes, drafts and saved publication intent.
  Retirement must never regenerate an accepted output or silently discard work.

## Branch verification and remaining runtime work

PR #153 contains route-level negative tests for empty/invalid scope and all
full-flag aliases on both service paths, positive scoped work and receipt tests,
and executable retirement tests for the historical repair. The scoped finalization
implementation in this local patch is present as normal source rather than a CI-only encoded patch.
It preserves exact reset scopes, retains concurrently accepted and previous-day
obligations, checks the per-gene V2 receipt before acknowledgement, and schedules
publication deferrals at their reported deadline. The operation-cost implementation
identity is regenerated. The temporary source-export workflow
used for offline verification is removed by this patch. Remote integration is pending.

No production D1 query, migration, queue release or runtime decommissioning is
proved by these source changes. The ordinary publication wrapper still calls
the generic gallery publisher without propagating exact membership. Current
Wrangler bindings and recovery launchers remain pending reconciliation; remove
their executable behavior together with registered IPD-004/IPD-010 enforcement
points after the surviving consumers pass their own acceptance.

The local source verification record is
`B-749-SCOPED-HANDOFF-VERIFICATION-20260917.md`. Its tests do not establish
remote integration, production activation, complete authoring migration, or
B-742's enabled-day proof. No issue closes from that record alone.
