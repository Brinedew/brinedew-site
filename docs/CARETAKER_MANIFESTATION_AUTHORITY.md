# Caretaker manifestation authority

Status: implementation contract for IPD-012 / B-705. The words **caretaker** and
**manifestation** are product language. Do not reintroduce `curator`, `latest`
manifestation, or a second command authority in code or UI.

## Ownership boundary

The Website is the only command authority for caretaker tenure, immutable prose
revisions, lifecycle changes, accepted Tags derivatives, and the canonical
manifestation selected for a gene. The workstation keeps an exact local replica,
durable offline drafts, and an idempotent outgoing command ledger. It may generate
Tags and images from an exact revision document, but it cannot impersonate a
caretaker or choose a canonical revision locally.

The public catalog and primary Iconoplasm D1 are read projections. A projection
lag or failure never rolls back an accepted authoring command. Generation refuses
an unresolved source; it never substitutes whichever manifestation is newest when
the job happens to run.

### Service bearer audiences

No general manifestation-authority service bearer exists. Five independent Worker
secrets enforce least privilege, and a token is valid only for its named routes:

- `ICONOPLASM_AUTHORITY_REPLICA_TOKEN`: events, snapshots, exact material reads,
  and Tags enrichment submission/selection;
- `ICONOPLASM_AUTHORITY_GENERATION_TOKEN`: generation lease claim, renew, fail,
  and complete;
- `ICONOPLASM_AUTHORITY_MAINTENANCE_TOKEN`: explicitly exposed bounded retention,
  purge, receipt, tombstone, and event-compaction maintenance;
- `ICONOPLASM_AUTHORITY_BACKUP_TOKEN`: backup capability, export, restore, and
  verification;
- `ICONOPLASM_AUTHORITY_CUTOVER_TOKEN`: the one-time cutover plan, freeze,
  materialize, verify, activate, backup-for-cutover, and plaintext retirement.

Scheduled maintenance calls domain functions internally instead of sending a
bearer request back through the public route. Secrets must contain different
values; admin credentials and the retired generic service token are never
fallbacks.

## Stable identities

- `account_id` is permanent and provider-independent. Discord subject, username,
  avatar, role, and access token are mutable identity projections.
- `gene_id` is permanent. Symbols are aliases that may be renamed or merged.
- `caretaker_assignment_id`, `manifestation_id`, `manifestation_revision_id`, and
  `canonical_selection_id` are opaque. Labels and hashes are not identities.
- A successful self-claim creates an `active` assignment immediately. Its bounded
  state machine is `active` <-> `suspended` -> `ended`; `ended` is terminal and a
  later tenure receives a new ID. `pending_acceptance` is legacy history, not a
  product action, invitation, or sidebar state.
- Any active Brinedew account authenticated through Discord may self-claim an
  available gene. Membership in the Brinedew Discord server is not an entitlement
  gate. One account may have at most one active or suspended gene tenure at a time.
- Gene-page comments are the first caretaker coordination channel. The caretaker
  sidebar shows only the current gene and its unread comment count. New comments
  are durably queued for a Discord DM to the active caretaker; a Discord failure
  never rolls back the comment and an author's own comment never notifies them.
- A user command derives its actor from the authenticated session. Actor IDs in a
  request body are rejected or ignored; they are never trusted.

## Revision and canonical semantics

A manifestation is an authored lineage. Saving edits appends an immutable revision
and advances the lineage head; it does not update old prose. Selecting canonical
appends an immutable selection and advances the gene head with compare-and-swap.
Selecting an older active revision is the supported rollback operation.

Canonical eligibility requires all of the following:

1. the manifestation, revision, and verified encrypted body are present;
2. the manifestation and revision are active and belong to the same gene;
3. the requested head version still matches;
4. the actor has a current active assignment for that gene, unless the command is
   an explicit administrator, migration, moderation, or service operation.

An author may withdraw only a lineage they authored. System seed lineages are not
withdrawable. A withdrawn canonical lineage walks the append-only selection history
backward to the most recent explicit selection that is still eligible and does not
belong to the withdrawn lineage; the system seed is the terminal fallback. It never
picks by ambiguous row order or by whichever revision was merely saved most recently.
If no eligible revision exists, the command fails before changing anything.

## Caretaker departure

The leave policy is an explicit, versioned choice: `retain` keeps the caretaker's
lineage eligible; `withdraw` withdraws it and applies canonical fallback. The UI
must show the consequences and obtain a final confirmation. The policy is frozen
inside the same atomic command that ends the assignment; a retry cannot reinterpret
the choice. Suspension is read-only and does not silently end or withdraw tenure.

## Body storage and deletion

Plaintext does not live in D1, logs, events, or the public catalog. Each prose or
Tags body uses a random AES-256-GCM data key. The data key is wrapped by a
versioned server secret; authenticated encryption binds revision, gene, plaintext
hash, and byte length. The encrypted object is read back, hash checked, and
decrypted before its metadata becomes authoritative.

Object locators are independent random secrets and never appear in browser or
replica payloads. Upload-before-commit orphans are recorded/reconciled. A normal
withdrawal preserves revision history and ciphertext. A hard purge first removes
the wrapped key (cryptographic erasure), then deletes and verifies the object;
legal hold blocks purge. Every admitted byte is counted against a bounded quota.
Bodies live only in the dedicated private `iconoplasm-authoring` Bunny Storage
zone. It has no connected Pull Zone, and the code must fail closed when its
authoring-specific zone or credential is missing; portrait storage is never a
fallback.

Withdrawal immediately removes the lineage from canonical eligibility. Its
encrypted body becomes hard-purge eligible exactly 30 days later unless an
active legal hold applies. The purge transaction queues the opaque ciphertext
locator and erases the wrapped data key before the separately retryable object
DELETE. Retained lineages have no withdrawal deadline and are never swept.

Legacy plaintext retirement is gated by one real multipart artifact per cutover
run in the distinct private `iconoplasm-authoring-backup` Bunny Storage zone,
also with no Pull Zone. Each bounded package contains ciphertext plus the
minimum immutable metadata and envelope needed for recovery. Manifests of at
most 250 packages form an actual-LF SHA-256 chain; a verified root object binds
the run, source snapshot, entry count, private part locators, and chain root.
Retirement accepts only the opaque artifact ID and independently re-reads,
hashes, and parses that root. A caller-supplied digest cannot unlock deletion.

That artifact contains only the original system revisions and Tags moved by
the cutover plan; it never admits a post-cutover caretaker revision. Verified
legacy plaintext retirement starts an exact 30-day retention clock. A bounded
service sweep then inventories every package, manifest part, and root object,
rechecks legal holds immediately before each authenticated DELETE+GET proof,
and records a locator-free deletion receipt before removing the inventory
locators from D1. An active legal hold pauses the deadline; the sweep resumes
after the final hold is released. Deleted-object audit rows are removed after a
seven-day audit window, while the artifact ID, root digest, count, deletion
receipt digest, and deletion timestamp remain as bounded proof.

Production uses `iconoplasm-authoring` and
`iconoplasm-authoring-backup`; staging uses the credential-isolated
`iconoplasm-authoring-staging` and
`iconoplasm-authoring-backup-staging`. All four are private Storage zones with
no Pull Zone. A Worker fails closed when the body and backup zone names match;
staging never receives either production zone password.

## Exact generation contract

Every Image API and Free queue request captures an immutable source envelope at
acceptance:

- gene ID and symbol projection;
- canonical selection ID, manifestation ID, and manifestation revision ID;
- plaintext SHA-256 and byte length;
- accepted Tags derivative ID/hash when Tags are used;
- generation request/idempotency ID;
- prompt recipe ID/version/hash, provider, exact model, and effective settings.

Workers consume that envelope. A canonical change, caretaker departure, rename,
or new revision after enqueue does not alter it. A revoked or purged source causes
an explicit terminal/refusal result according to policy; no `latest_sample`, newest
row, or current-head fallback is permitted.

## Workstation replica contract

Replication is at-least-once and event application is idempotent. Cursors are
opaque at the HTTP boundary. Events apply in the authoritative order supplied by
the Website. A gap, expired cursor, or authority epoch change forces an immutable
watermarked snapshot; it never edits local rows until the snapshot validates and
swaps atomically.

Snapshot transport v2 (migration `0012`) streams directly from a pinned authority
epoch, event watermark, baseline rowid ceiling and checkpoint. GET pages are
read-only and contain at most 250 parts; no per-consumer D1 payload copy or build
poller exists. Each signed continuation binds the cumulative part count and SHA-256
chain. `total_parts` and `manifest_sha256` describe the prefix through that page;
only a terminal signed `completion_cursor` can complete the lease. The event
`resume_cursor` always names the original watermark. Leases expire within one hour.
Database triggers forbid baseline updates and deletion. VACUUM and table rebuilds
are unsupported while any lease is open: maintenance must first expire all leases
and prevent new leases until it finishes. There is no automatic VACUUM path.
Database triggers also arbitrate snapshot creation against checkpoint activation;
every open lease whose source floor precedes a checkpoint blocks activation,
including a lease with a newer event watermark than the checkpoint.

The workstation durably caches validated metadata pages and revalidates them after
restart, downloading only the missing suffix. It verifies the completion receipt
before atomically replacing the replica, then deletes its download cache. An empty
replica reports `initializing`, and an unfinished download reports `snapshot_staging`.
The first sync always downloads the complete baseline before reading incremental
events. An invalidated lease clears only its download cache so the next attempt
can obtain a fresh lease; it never advances the last verified replica.
Private prose and Tags are fetched only when opening the selected gene, with at
most 128 revisions and 128 derivatives held in process memory. Sync never fetches
the catalogue's private bodies. Legacy snapshot cleanup deletes at most 250 copied
parts per maintenance call and retains each lease until its copied parts are gone.

Deploy order: apply authoring migration `0012` and publish the v2 Worker through the
normal Website pipeline, then restart the workstation with local schema v9 and the
v2 client. Old clients reject the explicit version change; their last verified state
remains intact. Generation continues through its independent exact-lease endpoint.

Offline edits remain drafts. Reconnection submits each durable command with its
original command ID and expected entity version. Conflict preserves the draft,
shows the remote head, and requires a human rebase/retry. Local candidates without
an exact source binding remain `legacy_unbound`; migration never guesses by gene or
timestamp.

Event retention advances only through a verified normalized checkpoint at a
fixed event watermark. The checkpoint keeps every immutable revision, canonical
selection, Tags derivative, alias/tombstone, and the current mutable heads needed
for history and rollback. Its bounded builder can resume after interruption; it
must finish its manifest hash and pass active-consumer, open-snapshot, and pending
projection guards before becoming the bootstrap baseline. Only then may a bounded
service page delete the replaced event prefix. An older cursor receives an
explicit snapshot-required response, and a fresh replica receives the checkpoint
entities followed only by events strictly after its watermark.

Full command response receipts remain replayable for at least 90 days. After the
accepted event is safely checkpointed and physically pruned, maintenance may
replace a receipt atomically with a request/response hash tombstone that preserves
the accepted event UUID, sequence, and gene revision. The tombstone makes the same
command fail closed instead of reapplying with missing response data. It remains
for a further 365-day tamper-audit window and is deleted only when the monotonic
authority state proves the original command cannot apply again.

## Hostile acceptance matrix

Each item needs a behavior test at the owning layer and an end-to-end certification
case where it crosses Website/workstation boundaries.

| Case                                                 | Required result                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Duplicate save/select/withdraw delivery              | Same receipt and one event; no duplicate revision or selection                            |
| Same command ID arrives with different bytes         | Refused as replay tampering; original receipt remains authoritative                       |
| Concurrent saves from two tabs                       | One wins CAS; loser keeps text and gets a refreshable conflict                            |
| Two accounts simultaneously claim one gene           | One active assignment is committed; the loser gets a conflict                             |
| One account simultaneously claims two genes          | One active assignment is committed; the loser gets a conflict                             |
| Self-claim targets a gene without a verified seed    | Refused; claim never invents source prose                                                 |
| Comment arrives while caretaker assignment ends      | Comment persists; queued DM revalidates tenure and is suppressed if no longer active      |
| Caretaker comments on their own gene                 | Comment persists and appears unread nowhere; no self-DM is queued                         |
| Discord is unavailable after a comment               | Comment succeeds; durable outbox retries without duplicate ambiguous POSTs                |
| Canonical changes after generation enqueue           | Job uses the captured revision and hashes                                                 |
| Queued source is withdrawn or purged                 | Fulfilment fails closed; cache/current-canon text is never substituted                    |
| Author withdraws the canonical lineage               | Atomic withdrawal plus deterministic fallback                                             |
| Author attempts to withdraw another user's lineage   | `403`; no state, event, or object change                                                  |
| Author attempts to withdraw the system seed          | Refused; seed stays eligible                                                              |
| Author restores an own withdrawn lineage             | New lifecycle and selection events restore it without rewriting history                   |
| Retention expires after withdrawal                   | Legal-hold-aware purge destroys keys/bodies but keeps bounded tombstones                  |
| Leave with `retain`                                  | Tenure ends; lineage remains eligible and readable                                        |
| Leave with `withdraw`                                | Tenure and lineage change atomically; fallback is recorded                                |
| Repeated leave request with a different policy       | Original receipt wins; policy cannot flip                                                 |
| Command receipt source event is checkpointed/pruned  | Hash tombstone keeps replay fail-closed; leave/delete policy cannot reinterpret           |
| Suspension during an open editor                     | New save is refused; local draft survives                                                 |
| Assignment ends between save and select              | Select is refused without changing the head                                               |
| Gene symbol renamed                                  | Stable gene ID retains assignment, history, and queued sources                            |
| Gene merge                                           | Explicit merge event and deterministic head policy; no orphan assignment                  |
| Old alias is opened after merge                      | Read-only dossier resolves the stable gene and names the surviving record                 |
| Browser sends another account ID                     | Session actor wins; body identity is never authority                                      |
| Cross-origin or ambiguous browser mutation           | Refused before parsing a command; no permissive missing-Origin path                       |
| Disabled/erased account presents an old session      | Session is invalidated and every caretaker mutation is refused                            |
| Provider identity is unlinked then relinked          | Stable account ownership survives; link history prevents identity theft                   |
| Erased former author is displayed                    | Stable anonymous attribution appears; provider subject never leaks                        |
| Missing/corrupt encrypted object                     | Revision is ineligible and an integrity alert is emitted                                  |
| D1 fails after object upload                         | No revision commits; orphan is recoverable and later deleted                              |
| Object delete fails after key erasure                | Plaintext stays unrecoverable; purge retry remains durable                                |
| Legal hold plus purge                                | Purge is refused before key erasure                                                       |
| Key rotation races a read or backup                  | Versioned wrapped key decrypts exactly; body and AAD hashes still verify                  |
| Backup restore targets merged/retired history        | Exact immutable ID/hash returns at a fresh locator without changing canon                 |
| Backup capability is replayed or expires             | One-shot token is unusable; storage credentials/object locators stay secret               |
| Cutover backup reaches 30 days without legal hold    | Bounded retry deletes and GET-verifies every package, part, and root object               |
| Cutover backup reaches 30 days under legal hold      | No object is deleted; release resumes the same verified deletion inventory                |
| Event delivered twice/out of order                   | Replica converges once without rewinding a gene                                           |
| Cursor expired or event gap                          | Replica replaces state from a validated watermarked snapshot                              |
| Malformed/foreign snapshot or cursor                 | Replica rejects it and preserves its last verified local state                            |
| Offline save conflicts on reconnect                  | Draft remains readable; no silent overwrite or auto-merge                                 |
| Legacy candidate lacks a revision                    | Mark `legacy_unbound`; never bind it to current canonical                                 |
| Accepted Tags arrive for an old revision             | Attach to that revision only; do not move canonical                                       |
| Account provider rename/token expiry                 | Ownership remains on the same stable account                                              |
| Account erasure request                              | Tenure ends by explicit policy; audit tombstones remain bounded                           |
| Quota exhausted                                      | Command refuses before metadata commit and preserves the draft                            |
| Very long history is paged                           | Opaque cursor yields stable event order with no duplicate or missing rows                 |
| HTML/script text in prose                            | Rendered as text under CSP; never interpreted as markup                                   |
| 4,001 code points or more than 16 KiB                | Validation refuses consistently in browser and authority                                  |
| Public/anonymous gene view                           | Zero caretaker-authority requests and no private metadata                                 |
| Workstation admin credential                         | Can replicate/service commands; cannot forge caretaker actor                              |
| Legacy writer runs after freeze                      | Primary trigger and route both refuse it; authority mode never rewinds                    |
| Staging authoring or backup storage is compromised   | Distinct staging zones and environment secrets grant no production-zone access            |
| Recovery mode is entered                             | Reads/repair continue while all authority mutations remain disabled                       |
| Signed caretaker 10x vote is replayed or tenure ends | Separate receipt/outbox stays idempotent; ranking recomputes without FIT mutation         |
| Caretaker moves +10 to -10 or another candidate      | One CAS head transfers atomically; no ordinary FIT/MISFIT row is rewritten                |
| Preferred +10 candidate loses canon                  | One transition-keyed Discord DM is queued; stale preference or ended tenure suppresses it |

## Release gate

Cutover is allowed only after existing Website manifestations are seeded with
verified bodies and canonical selections, the public projection matches every
seed hash, the workstation completes a full snapshot plus incremental replay, and
shadow comparison reports no unexplained difference. Deployment is not proof:
fresh logged-in browser tests must cover edit, version rollback, own-only deletion,
both leave policies, exact generation, and one conflict/retry path on two gene
pages. The signed 10x authority also requires short-click isolation, pointer and
keyboard long-press assignment, positive/negative ranking, transfer/recall,
sidebar unspent guidance, tenure cleanup, and deduplicated Discord delivery. The
old mutable publication and destructive schema-rebuild paths are then
deleted, not retained as fallback behavior.
