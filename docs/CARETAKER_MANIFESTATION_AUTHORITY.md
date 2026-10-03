# Caretaker manifestation authority

**Caretaker** and **manifestation** are product words. Do not use `curator`, a `latest`
manifestation, or a second command authority in code or UI. Storage and key plumbing live in
the IPD-012 fence in `AGENTS.md`; this page holds the rules a caretaker feels.

The Website is the only command authority for tenure, prose revisions, lifecycle, accepted Tags
derivatives and each gene's canonical manifestation. The workstation keeps an exact replica,
offline drafts and an idempotent outgoing command ledger. It may generate Tags and images from
an exact revision, but it cannot act as a caretaker or choose canon. The public catalog and the
primary D1 are projections; a projection that lags never rolls back an accepted command.

## The caretaker stewards the gene; the writer owns nothing

- No one owns a manifestation. The active caretaker of a gene may edit, show or hide, withdraw,
  restore and select any lineage on it, whoever wrote it. History names each version's writer.
- A former caretaker has no say over text they left, and a stranger has none: both are refused
  (`403 ACTIVE_ASSIGNMENT_REQUIRED` on withdraw and restore) and nothing changes. Leaving always
  keeps what was written.
- The system seed is the gene's first lineage. It cannot be withdrawn and is the last fallback.
- Any active Brinedew account signed in through Discord may claim an available gene (server
  membership is no gate); an account holds one active or suspended gene and a gene has one
  caretaker. An administrator may offer a gene instead, and the account accepts or declines.
  Tenure runs `pending_acceptance` -> `active` or `ended`, and `active` <-> `suspended` ->
  `ended`; `ended` is final, a later tenure gets a new ID, and suspension is read-only.
- An active caretaker's supervote on a candidate image of their gene weighs 10, up or down. A new
  gene-page comment queues a Discord DM to the active caretaker; a Discord failure never rolls
  the comment back, and nobody is told of their own comment.

## History is append-only; rollback selects an older version

- Saving appends an immutable revision and advances the lineage head; nothing edits old prose.
- Selecting canonical appends an immutable selection and advances the gene head. Selecting an
  older active revision is the rollback. The revision and manifestation must be active, belong to
  the gene and have a verified body, and the actor needs a current active assignment on it.
- Withdrawing hides a lineage from public view and canonical eligibility; restoring brings it
  back. Withdrawal is not a purge and does not touch backups. An erasure request arrives by
  email and the operator runs the account erase command in `docs/ICONOPLASM_OPERATIONS.md`.
- If the canonical lineage is withdrawn, canon walks the selection history back to the latest
  explicit selection that is still eligible and outside that lineage; the seed ends the walk. If
  nothing is eligible the command fails before changing anything.
- Prose shows under the gene card only while its manifestation is shown on the page (hidden by
  default) and renders as text under CSP, never as markup.

## Conflicts are compare-and-swap; the actor comes from the session

- Every command carries the versions it saw: assignment, lineage head, gene head and canonical
  revision. A mismatch is `409 STALE_AUTHORITY_STATE` and writes nothing. The loser keeps their
  text, sees the current head and rebases by hand; nothing merges silently. Two accounts claiming
  one gene, or one account claiming two, commit one and conflict the other.
- A command ID is an idempotency key: the same ID and bytes return the original response, and the
  same ID with different bytes is refused (`409 IDEMPOTENCY_KEY_REUSED`). A receipt older than 30
  days that no event references may be deleted (`scripts/reap-authoring-residue.mjs`); one an
  event references lives as long as the event. A retry after that runs as a new command and its
  expected versions make it an ordinary conflict.
- A user command takes its actor from the authenticated session; an actor ID in a body is ignored
  or refused, and a cross-origin or ambiguous browser mutation is refused before parsing. A
  disabled or erased account is refused on every mutation, even with an old session.
- `account_id` and `gene_id` are permanent. Symbols are aliases that can be renamed or merged, and
  tenure and history follow the gene ID. An erased author shows as a stable anonymous name.

## The size limit

Prose is at most 4,000 code points and 16 KiB, checked the same way in the browser and in the
authority. A caretaker's lineage holds at most 256 revisions, 512 Tags derivatives and 2 MiB of
bodies, and the store admits at most 350 MB of bodies in all. Admission counts every byte before
metadata commits, so a refused save keeps the draft.

## Images and the replica use exact sources, and releases are proven in a browser

An image request captures its source at acceptance: gene, canonical selection, manifestation and
revision IDs, plaintext SHA-256 and length, accepted Tags derivative, recipe and model. A later
canonical change, departure or new revision does not alter it, and a withdrawn source fails closed;
no newest-row fallback exists. Replication is at-least-once and idempotent; a gap or expired cursor
forces a validated snapshot swap. Offline edits stay drafts, resubmit with their command ID and
expected versions, and on conflict keep the draft beside the remote head. Deployment is not
proof: fresh logged-in browser tests cover edit, rollback, a handover (hide and restore the
predecessor's text), leaving, an exact image source and a conflict retry, on two genes.
