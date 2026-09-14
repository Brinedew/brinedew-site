# B-762 deletion inventory

Short-lived companion to `B-762-SYSOP-V2-HANDOFF.md`. Migrated genes must work
with these entrypoints unavailable; each row names the surviving requirement so
nothing is removed before its replacement is verified. Status values:
**bypassed** (v2 path never calls it), **retired-pending** (remove after the
last legacy gene migrates), **kept** (surviving interface).

| Obsolete item | Actual callers | Job / binding | Surviving requirement | Replacement | Status / removal proof |
| --- | --- | --- | --- | --- | --- |
| `vote_outbox` table, `deliverOutboxRow`, `drainVoteOutbox` | `IconoplasmVoteCoordinator.alarm`, legacy `/vote/set`/`/vote/import`, routing tests | alarm; `ICONOPLASM_VOTE_PROJECTION_QUEUE` via jobs | Accepted votes for genes not yet migrated must still reach D1 readers | Direct v2 hot authority; no projection needed | Bypassed: v2 route writes zero rows (audit `EXCISION`; native probe `legacyOutboxRows: 0`). Retired-pending last-gene migration |
| `scheduleVoteProjectionRefresh`, `enqueueVoteProjectionRefreshJob`, `sendVoteProjectionRefreshQueueMessage` | `deliverOutboxRow` only | `icono_vote_projection_refresh_jobs`; Queue producer | Same as above for un-migrated genes | Per-gene alarm (`drainGenePublication`) | Bypassed for v2; retired-pending |
| `handleIconoplasmVoteProjectionQueue`, drain queue messages | Queue consumer | `ICONOPLASM_VOTE_PROJECTION_QUEUE` consumer + DLQ | Un-migrated genes' projections | None for migrated genes | Retired-pending after last migration; keep DLQ drain until then |
| `projectVoteCoordinatorLedgerRow`, `appendVoteEvent` (D1 `icono_image_votes` projection) | `deliverOutboxRow` | D1 writes | Audit/history for pre-v2 votes | Kept as historical records; no new v2 writes | Bypassed for v2; keep historical rows |
| Global finalization barrier (`sync-finalization-publication.js`, `unfinished_count = 0`) | scheduled finalization job, gallery publication | Queue/cron | Nothing for v2: one gene must publish while others sleep | Per-gene `publication_pending` + alarm retry | Bypassed for v2 publication; retire only with IPD-004/IPD-010 enforcement updates together |
| `exportAssetSummaries()` on the vote path | election and `/state` export | hot DO reads | Full export remains for admin observability | `geneAuthoritySummaries()` (bounded to candidates) | Removed from hot path: audit `COST` proves zero exports per duplicate vote, flat 35/31 reads from 2 to 10,000 historical assets |
| Legacy bootstrap import in `ensureBootstrapped` | `/vote/set`, `/vote/import`, `/vote/snapshot(s)`, `/state` | D1 reads (`icono_portrait_assets`, `icono_image_votes`) | One-time import for un-migrated genes | v2 guard returns before any D1 binding is required | Guarded: `authority_epoch === "v2"` exits first; rollback keeps v2 votes because the epoch check precedes the destructive import |
| Global card head / dirty-shard publisher (`/wake`, `publisher.step`) | scheduled publication, vote projection | `ICONOPLASM_CARD_PUBLICATION` + KV manifest | Un-migrated catalog publication | `/materialize-symbol` per-gene immutable objects | Kept for un-migrated genes; v2 genes publish without touching head/watermark |
| KV gallery barrier projection (`KV_GALLERY_VERSION`) | readers and publisher | KV | Fresh-reader resolution for un-migrated genes | Per-gene read pointer (next slice; not built yet) | Kept: do not remove until the per-gene reader pointer is verified |

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
- B-742/B-749 recovery executor, continuation and receipts.
