// B-987: what a verified erasure does to every row keyed by a person's Discord id.
//
// The rule (owner decision, 3 Oct 2026, modelled on Stack Exchange, GitHub and iNaturalist):
// keep the content, cut the person off it, and delete the personal records that have no public
// value. Published portraits, blots, cards, generated text, CC0 manifestations and public gene
// comments stay. What ties them to the person is replaced by the erased account's own opaque
// id (`acct_...`) or by its stable anonymous label. Votes are dissociated, not revoked, so the
// counts and the winning portrait of every gene stay exactly as they were: the vote row moves to
// the erased account's id, one UPDATE per slice, and no election, summary or republish is needed.
//
// "Delete" means the row is personal and nothing public needs it: discoveries and discovery
// state, favourites, emulsions and provider keys, the inbox, unpublished or pending generation
// and edit jobs (with their result images in the portrait storage) and requests, the caretaker
// delivery outbox, GeneGuessr stats and the leaderboard row. Every step is one bounded slice
// repeated by the runner (erase-account-data.js).
//
// Adding a table that holds a Discord id, a username or an avatar? The integration test fails
// until the table is listed here (a step, or EXEMPT_COLUMNS with the reason), so a new feature
// cannot quietly leave a person behind.

// Where each database lives on `env`.
export const ERASURE_DATABASES = Object.freeze({
  iconoplasm: "ICONOPLASM_DB",
  accounts: "DB",
  audit: "ICONOPLASM_AUDIT_DB",
})

export const ERASURE_SLICE_ROWS = 100

// Every step is `{ id, database, table, action: "delete" | "update", key, where, set?, weight,
// covers, scan? }`. Two custom actions have their own runner and no `where`: "comments" (public
// comments and their Discord posts) and "job_images" (an unpublished job's stored images, then its
// row; deleting a row weighs like "delete").
//   key     "rowid", or the primary key columns of a WITHOUT ROWID table; the slice picks at most
//           ERASURE_SLICE_ROWS rows by it, so one statement never touches more.
//   weight  the most D1 rows one changed row can write: the row, every index entry the statement
//           touches (an update of an indexed column writes the old and the new entry) and what
//           the table's triggers write. One test checks the index part against the real schema,
//           another compares the rows D1 reports written with the weights.
//   scan    the column has no index: slices walk the table once by rowid instead of rescanning
//           it from the start every time.
// `?` placeholders in `where` and `set` take the values `whereBinds` and `setBinds` return, in
// order. U is the Discord id, A the erased account's id, L its anonymous label.
const U = (context) => context.userId
const A = (context) => context.accountId
const L = (context) => context.label

export const ERASURE_STEPS = Object.freeze(
  [
    // The inbox first. The three rollup tables carry no trigger on delete, and deleting them
    // before their members and notifications leaves those triggers nothing to update.
    {
      id: "inbox_summary",
      database: "iconoplasm",
      table: "icono_request_inbox_summary",
      action: "delete",
      key: ["requester_user_id"],
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 1,
      covers: ["icono_request_inbox_summary.requester_user_id"],
    },
    {
      id: "inbox_groups",
      database: "iconoplasm",
      table: "icono_request_inbox_groups",
      action: "delete",
      key: ["requester_user_id", "group_key"],
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 1,
      covers: ["icono_request_inbox_groups.requester_user_id"],
    },
    {
      id: "delivery_ready_groups",
      database: "iconoplasm",
      table: "icono_request_delivery_ready_groups",
      action: "delete",
      key: ["requester_user_id", "fulfillment_publication_id", "gene_symbol"],
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 2,
      covers: ["icono_request_delivery_ready_groups.requester_user_id"],
    },
    {
      id: "inbox_members",
      database: "iconoplasm",
      table: "icono_request_inbox_members",
      action: "delete",
      key: "rowid",
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 2,
      covers: ["icono_request_inbox_members.requester_user_id"],
    },
    {
      // Carries the Discord DM channel and message ids of the person's request deliveries.
      id: "request_notifications",
      database: "iconoplasm",
      table: "icono_request_notifications",
      action: "delete",
      key: "rowid",
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 8,
      covers: ["icono_request_notifications.requester_user_id"],
    },
    {
      // A request that never produced an image: nothing public to keep. Quarantined rows are
      // immutable parents (foreign key RESTRICT), so they are dissociated below instead.
      id: "requests_without_output",
      database: "iconoplasm",
      table: "icono_generation_requests",
      action: "delete",
      key: "rowid",
      where: `requester_user_id = ?
        AND request_origin = 'user'
        AND status IN ('open', 'cancelled')
        AND fulfilled_asset_sha256 = ''
        AND NOT EXISTS (
          SELECT 1 FROM icono_generation_request_quarantine quarantine
          WHERE quarantine.request_row_id = icono_generation_requests.id
        )`,
      whereBinds: [U],
      weight: 12,
      covers: [],
    },
    {
      // A request that produced a published image stays as that image's provenance; only the
      // person is cut off it.
      id: "requests_with_output",
      database: "iconoplasm",
      table: "icono_generation_requests",
      action: "update",
      key: "rowid",
      set: "requester_user_id = ?, requester_username = ''",
      setBinds: [A],
      where: "requester_user_id = ?",
      whereBinds: [U],
      weight: 8,
      covers: [
        "icono_generation_requests.requester_user_id",
        "icono_generation_requests.requester_username",
      ],
    },
    {
      // B-993: an unpublished job's result images are deleted from the portrait storage before the
      // job row goes (job-result-images.js). A custom step that runs before every other step of the
      // Iconoplasm database, so no unpublished job that wrote an image is ever deleted by the
      // generic steps below without its objects.
      id: "candidate_job_images",
      database: "iconoplasm",
      table: "icono_candidate_generation_jobs",
      action: "job_images",
      geneColumn: "gene_symbol",
      weight: 6,
      covers: [],
    },
    {
      id: "edit_job_images",
      database: "iconoplasm",
      table: "icono_image_edit_jobs",
      action: "job_images",
      geneColumn: "source_gene_symbol",
      weight: 5,
      covers: [],
    },
    {
      id: "candidate_jobs_unpublished",
      database: "iconoplasm",
      table: "icono_candidate_generation_jobs",
      action: "delete",
      key: "rowid",
      where: "user_id = ? AND published_at IS NULL",
      whereBinds: [U],
      weight: 6,
      covers: [],
    },
    {
      id: "candidate_jobs_published",
      database: "iconoplasm",
      table: "icono_candidate_generation_jobs",
      action: "update",
      key: "rowid",
      set: "user_id = ?",
      setBinds: [A],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 6,
      covers: ["icono_candidate_generation_jobs.user_id"],
    },
    {
      // The person's emulsion ids are built from their username ("ALICE-1"). A published
      // portrait or job that used one keeps its provenance, under a neutral label.
      id: "portrait_emulsion_labels",
      database: "iconoplasm",
      table: "icono_portrait_assets",
      action: "update",
      key: "rowid",
      set: "emulsion_id = ?",
      setBinds: [(context) => context.emulsionLabel],
      where: "emulsion_id IN (SELECT value FROM json_each(?))",
      whereBinds: [(context) => JSON.stringify(context.emulsionIds)],
      weight: 8,
      needsEmulsionIds: true,
      covers: ["icono_portrait_assets.emulsion_id"],
    },
    {
      id: "candidate_job_emulsion_labels",
      database: "iconoplasm",
      table: "icono_candidate_generation_jobs",
      action: "update",
      key: "rowid",
      set: "requested_emulsion_id = ?, requested_emulsion_label = ?",
      setBinds: [(context) => context.emulsionLabel, (context) => context.emulsionLabel],
      where: `user_id = ?
        AND (requested_emulsion_id IN (SELECT value FROM json_each(?))
          OR requested_emulsion_label IN (SELECT value FROM json_each(?)))`,
      whereBinds: [
        A,
        (context) => JSON.stringify(context.emulsionIds),
        (context) => JSON.stringify(context.emulsionIds),
      ],
      weight: 1,
      needsEmulsionIds: true,
      covers: [
        "icono_candidate_generation_jobs.requested_emulsion_id",
        "icono_candidate_generation_jobs.requested_emulsion_label",
      ],
    },
    {
      id: "edit_jobs_unpublished",
      database: "iconoplasm",
      table: "icono_image_edit_jobs",
      action: "delete",
      key: "rowid",
      where: "user_id = ? AND published_at IS NULL",
      whereBinds: [U],
      weight: 5,
      covers: [],
    },
    {
      id: "edit_jobs_published",
      database: "iconoplasm",
      table: "icono_image_edit_jobs",
      action: "update",
      key: "rowid",
      set: "user_id = ?",
      setBinds: [A],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 4,
      covers: ["icono_image_edit_jobs.user_id"],
    },
    {
      id: "image_provider_keys",
      database: "iconoplasm",
      table: "icono_user_image_provider_keys",
      action: "delete",
      key: "rowid",
      where: "user_id = ?",
      whereBinds: [U],
      weight: 4,
      covers: ["icono_user_image_provider_keys.user_id"],
    },
    {
      id: "emulsion_favourites",
      database: "iconoplasm",
      table: "icono_user_emulsion_favorites",
      action: "delete",
      key: ["user_id", "emulsion_family_id"],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 2,
      covers: ["icono_user_emulsion_favorites.user_id"],
    },
    {
      // Other people's favourites of the erased person's emulsions: the family id is the
      // emulsion's public id, which is built from the person's username.
      id: "favourites_of_erased_emulsions",
      database: "iconoplasm",
      table: "icono_user_emulsion_favorites",
      action: "delete",
      key: ["user_id", "emulsion_family_id"],
      where: "emulsion_family_id IN (SELECT value FROM json_each(?))",
      whereBinds: [(context) => JSON.stringify(context.emulsionIds)],
      weight: 2,
      needsEmulsionIds: true,
      covers: ["icono_user_emulsion_favorites.emulsion_family_id"],
    },
    {
      id: "rollup_of_erased_emulsions",
      database: "iconoplasm",
      table: "icono_user_emulsion_option_rollup",
      action: "delete",
      key: ["emulsion_id"],
      where: "emulsion_id IN (SELECT value FROM json_each(?))",
      whereBinds: [(context) => JSON.stringify(context.emulsionIds)],
      weight: 3,
      needsEmulsionIds: true,
      covers: ["icono_user_emulsion_option_rollup.emulsion_id"],
    },
    {
      id: "votes",
      database: "iconoplasm",
      table: "icono_image_votes",
      action: "update",
      key: "rowid",
      set: "user_id = ?",
      setBinds: [A],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 8,
      covers: ["icono_image_votes.user_id"],
    },
    {
      id: "vote_events",
      database: "iconoplasm",
      table: "icono_vote_events",
      action: "update",
      key: "rowid",
      set: "user_id = ?",
      setBinds: [A],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 3,
      covers: ["icono_vote_events.user_id"],
    },
    {
      // Public comments stay under the anonymous label; a comment its author had already removed
      // is hidden, not gone (the body is still in the row), so it is deleted. A custom step
      // (runCommentsStep): each slice first drops the gene's cached comment list from KV, which
      // carries the old name and avatar, and then fixes the comment's copy in the public Discord
      // channel (B-992): the post's author becomes the label, or the post goes when the comment was
      // removed. The rows change only after their Discord post has been dealt with.
      id: "comments",
      database: "iconoplasm",
      table: "icono_gene_comments",
      action: "comments",
      set: "user_id = ?, username = ?, avatar_url = ''",
      weight: 4,
      covers: [
        "icono_gene_comments.user_id",
        "icono_gene_comments.username",
        "icono_gene_comments.avatar_url",
      ],
    },
    {
      id: "discovery_state",
      database: "iconoplasm",
      table: "icono_discovery_user_state_v2",
      action: "delete",
      key: ["user_id"],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 1,
      covers: ["icono_discovery_user_state_v2.user_id"],
    },
    {
      id: "discovery_chronology",
      database: "iconoplasm",
      table: "icono_discovery_chronology_v2",
      action: "delete",
      key: ["user_id", "chunk_seq"],
      where: "user_id = ?",
      whereBinds: [U],
      weight: 1,
      covers: ["icono_discovery_chronology_v2.user_id"],
    },
    {
      // delivery_id is "<user id>:<batch id>", the primary key: the range is a key lookup, the
      // table has no index on user_id.
      id: "discovery_delivery_outbox",
      database: "iconoplasm",
      table: "icono_discovery_shared_delivery_outbox_v2",
      action: "delete",
      key: ["delivery_id"],
      where: "delivery_id >= ? || ':' AND delivery_id < ? || ';' AND user_id = ?",
      whereBinds: [U, U, U],
      weight: 2,
      covers: ["icono_discovery_shared_delivery_outbox_v2.user_id"],
    },
    {
      id: "discovery_delivery_receipts",
      database: "iconoplasm",
      table: "icono_discovery_shared_delivery_receipts_v2",
      action: "delete",
      key: ["delivery_id"],
      where: "delivery_id >= ? || ':' AND delivery_id < ? || ';' AND user_id = ?",
      whereBinds: [U, U, U],
      weight: 1,
      covers: ["icono_discovery_shared_delivery_receipts_v2.user_id"],
    },
    {
      // The first-generation table, read only by the one-time compact migration. Still full of
      // personal rows (5,541 on 3 Oct 2026).
      id: "discovery_legacy_rows",
      database: "iconoplasm",
      table: "icono_gene_discoveries",
      action: "delete",
      key: "rowid",
      where: "user_id = ?",
      whereBinds: [U],
      weight: 6,
      covers: ["icono_gene_discoveries.user_id"],
    },
    {
      // The migration's resume cursor is the last migrated user's id. Once the migration is
      // complete the cursor is inert and safe to blank.
      id: "discovery_migration_cursor",
      database: "iconoplasm",
      table: "icono_discovery_compact_activation_v2",
      action: "update",
      key: ["singleton"],
      set: "cursor_user_id = ''",
      setBinds: [],
      where: "cursor_user_id = ? AND status = 'complete'",
      whereBinds: [U],
      weight: 1,
      covers: ["icono_discovery_compact_activation_v2.cursor_user_id"],
    },
    {
      // The caretaker's delivery outbox holds their raw Discord id and DM channel id.
      id: "caretaker_comment_deliveries",
      database: "iconoplasm",
      table: "icono_caretaker_comment_notifications",
      action: "delete",
      key: "rowid",
      where: "caretaker_account_id = ?",
      whereBinds: [A],
      scan: true,
      weight: 3,
      covers: [
        "icono_caretaker_comment_notifications.caretaker_discord_user_id",
        "icono_caretaker_comment_notifications.caretaker_account_id",
      ],
    },
    {
      // A caretaker was notified of this person's public comment: the comment stays, so does the
      // delivery, under the anonymous label.
      id: "caretaker_comment_author_names",
      database: "iconoplasm",
      table: "icono_caretaker_comment_notifications",
      action: "update",
      key: "rowid",
      set: "comment_author_name = ?",
      setBinds: [L],
      where: "comment_author_account_id = ? AND comment_author_name <> ?",
      whereBinds: [A, L],
      scan: true,
      weight: 1,
      covers: [
        "icono_caretaker_comment_notifications.comment_author_account_id",
        "icono_caretaker_comment_notifications.comment_author_name",
      ],
    },
    {
      id: "caretaker_supervote_deliveries",
      database: "iconoplasm",
      table: "icono_caretaker_supervote_notifications",
      action: "delete",
      key: "rowid",
      where: "caretaker_account_id = ?",
      whereBinds: [A],
      scan: true,
      weight: 3,
      covers: ["icono_caretaker_supervote_notifications.caretaker_account_id"],
    },
    {
      // Published portraits keep their provenance; the creator is the opaque account id.
      id: "portrait_creators",
      database: "iconoplasm",
      table: "icono_portrait_assets",
      action: "update",
      key: "rowid",
      set: "created_by = ?",
      setBinds: [A],
      where: "created_by = ?",
      whereBinds: [U],
      scan: true,
      weight: 1,
      covers: ["icono_portrait_assets.created_by"],
    },
    {
      id: "publish_event_actors",
      database: "iconoplasm",
      table: "icono_publish_events",
      action: "update",
      key: "rowid",
      set: "actor = ?",
      setBinds: [A],
      where: "actor = ?",
      whereBinds: [U],
      scan: true,
      weight: 1,
      covers: ["icono_publish_events.actor"],
    },
    {
      // The cold copy of the same events. Created by code on first archive: absent is fine.
      id: "archived_publish_event_actors",
      database: "audit",
      table: "icono_publish_events",
      action: "update",
      key: "rowid",
      set: "actor = ?",
      setBinds: [A],
      where: "actor = ?",
      whereBinds: [U],
      scan: true,
      weight: 1,
      covers: ["audit.icono_publish_events.actor"],
    },
    // GeneGuessr and the account's own emulsions, in the accounts database. After every
    // Iconoplasm step, so the emulsion ids those steps need are still readable.
    {
      id: "emulsion_public_slots",
      database: "accounts",
      table: "iconoplasm_user_emulsion_public_slots",
      action: "delete",
      key: "rowid",
      where: "user_id = ?",
      whereBinds: [U],
      weight: 3,
      covers: ["iconoplasm_user_emulsion_public_slots.user_id"],
    },
    {
      id: "emulsion_versions",
      database: "accounts",
      table: "iconoplasm_user_emulsion_versions",
      action: "delete",
      key: "rowid",
      where: "user_id = ?",
      whereBinds: [U],
      weight: 5,
      covers: [
        "iconoplasm_user_emulsion_versions.user_id",
        "iconoplasm_user_emulsion_versions.username",
        "iconoplasm_user_emulsion_versions.public_id",
      ],
    },
    {
      // The trigger on `stats` deletes the person's leaderboard row too (leaderboard_streaks is a
      // projection of `stats` and `users`, kept by triggers; the test proves the row goes).
      id: "geneguessr_stats",
      database: "accounts",
      table: "stats",
      action: "delete",
      key: "rowid",
      where: "user_id = ?",
      whereBinds: [U],
      weight: 4,
      covers: ["stats.user_id"],
    },
  ].map((step) => Object.freeze(step)),
)

// Columns whose name looks like a person (PERSON_COLUMN_PATTERN) that no step touches, each with
// the reason. The integration test reads the migrated schemas and fails on a person-shaped column
// that is neither covered by a step nor listed here, and on a listed column that no longer
// exists.
export const PERSON_COLUMN_PATTERN =
  /user_id|discord_(user_)?id|username|avatar|email|created_by|updated_by|requested_by|(^|_)actor|lease_owner|account_id|author_(name|label|account)|provider_subject/i

export const EXEMPT_COLUMNS = Object.freeze({
  // The account row and its lifecycle: eraseBrinedewAccount (the identity module) deletes
  // `users` and the provider link and scrubs the fingerprints, in one transaction, last.
  "users.discord_id": "deleted with the users row by eraseBrinedewAccount",
  "users.username": "deleted with the users row by eraseBrinedewAccount",
  "users.email": "deleted with the users row by eraseBrinedewAccount",
  "users.avatar_url": "deleted with the users row by eraseBrinedewAccount",
  "users.account_id": "deleted with the users row by eraseBrinedewAccount",
  "brinedew_account_identities.provider_subject": "deleted by eraseBrinedewAccount",
  "brinedew_account_identities.account_id": "deleted by eraseBrinedewAccount",
  "brinedew_account_identity_events.provider_subject_fingerprint":
    "rewritten to an opaque marker by eraseBrinedewAccount",
  // Opaque account ids (acct_ and a random uuid, derived from nothing about the person): retained
  // authorship and audit history under the anonymous label. Once the erasure completes nothing
  // links an account id to a Discord id.
  "leaderboard_streaks.user_id": "projection of stats, its row goes with the stats row by trigger",
  "brinedew_accounts.account_id": "opaque account id, retained",
  "brinedew_accounts.author_label": "the anonymous label itself",
  "brinedew_account_lifecycle_events.account_id": "opaque account id, retained",
  "brinedew_account_lifecycle_events.author_label": "the anonymous label itself",
  "brinedew_account_lifecycle_events.actor_account_id": "opaque account id, retained",
  "brinedew_account_identity_events.account_id": "opaque account id, retained",
  "brinedew_account_identity_events.actor_account_id": "opaque account id, retained",
  "brinedew_authority_account_projection_outbox.account_id": "opaque account id, retained",
  "icono_caretaker_assignment_notifications.account_id":
    "opaque account id; the authority ends the assignment from the account projection",
  "icono_taggerizer_daily_calls.account_id":
    "opaque account id on a per-day call count (B-995); it holds no content, one row a caretaker a day",
  "icono_caretaker_supervote_events.caretaker_account_id":
    "opaque account id; signed vote history, retained like the caretaker's manifestations",
  "icono_caretaker_supervote_projection.caretaker_account_id": "opaque account id, retained",
  "icono_caretaker_vote_assignment_projection.caretaker_account_id": "opaque account id, retained",
  "icono_manifestation_projection_authority.changed_by_account_id": "opaque account id, retained",
  // Administrator and workstation provenance: the owner's own id or a constant, never an ordinary
  // signed-in person's (checked in the callers on 3 Oct 2026).
  "icono_artist_blacklist_submissions.requested_by":
    "'admin_artist_blacklist' or an IP-derived guest id, never an account",
  "icono_artist_style_blacklist.created_by": "administrator only",
  "icono_local_removal_requests.requested_by": "administrator only",
  "icono_diagnostic_matrix_runs.created_by": "administrator only",
  "icono_extension_blocklist_policy.updated_by": "administrator only",
  "icono_factory_active_recipe.updated_by": "administrator only",
  "icono_factory_pipeline_vision_recommendations.updated_by": "administrator only",
  "icono_gene_catalog.updated_by": "administrator only",
  "icono_gene_essence.updated_by": "administrator only",
  "icono_image_edit_prompt_templates.updated_by": "administrator only",
  "icono_publication_alias_policy.updated_by": "administrator only",
  "icono_publish_state.updated_by":
    "'vote_authority', 'caretaker_assignment' or an administrator, never a voter",
  "icono_sync_finalization_jobs.actor_id": "'workstation_sync' or an administrator",
  "icono_generation_execution_leases.lease_owner_id": "a workstation executor uuid, never a person",
})
