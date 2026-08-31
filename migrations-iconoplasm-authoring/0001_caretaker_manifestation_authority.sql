-- ARCHITECTURE FENCE [IPD-012]: one private transactional authority owns
-- caretaker assignments, immutable manifestation lineage, canonical selection,
-- idempotent commands, and the ordered workstation replication stream.
PRAGMA foreign_keys = ON;

CREATE TABLE icono_authority_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 1),
  authority_mode TEXT NOT NULL CHECK (authority_mode IN ('shadow', 'authoritative', 'read_only')),
  event_retention_floor INTEGER NOT NULL DEFAULT 0 CHECK (event_retention_floor >= 0),
  body_admitted_bytes INTEGER NOT NULL DEFAULT 0 CHECK (body_admitted_bytes >= 0),
  body_reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (body_reserved_bytes >= 0),
  body_admitted_limit_bytes INTEGER NOT NULL DEFAULT 350000000 CHECK (body_admitted_limit_bytes > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO icono_authority_state (
  singleton, schema_version, authority_epoch, authority_mode
) VALUES (1, 1, 1, 'shadow');

CREATE TRIGGER icono_authority_state_no_rewind
BEFORE UPDATE OF authority_epoch, authority_mode, event_retention_floor ON icono_authority_state
BEGIN
  SELECT case WHEN NEW.authority_epoch < OLD.authority_epoch
    THEN RAISE(ABORT, 'authority_epoch_cannot_rewind') end;
  SELECT case WHEN NEW.event_retention_floor < OLD.event_retention_floor
    THEN RAISE(ABORT, 'event_retention_floor_cannot_rewind') end;
  SELECT case WHEN OLD.authority_mode IN ('authoritative', 'read_only')
    AND NEW.authority_mode = 'shadow'
    THEN RAISE(ABORT, 'authority_mode_cannot_rewind_to_shadow') end;
  SELECT case WHEN NEW.authority_epoch > OLD.authority_epoch
    AND (
      OLD.authority_mode <> 'shadow' OR NEW.authority_mode <> 'shadow'
      OR EXISTS (SELECT 1 FROM icono_manifestation_events LIMIT 1)
    )
    THEN RAISE(ABORT, 'authority_epoch_must_advance_before_cutover_events') end;
end;

CREATE TABLE icono_authority_accounts (
  account_id TEXT PRIMARY KEY,
  public_credit_label TEXT NOT NULL CHECK (
    length(public_credit_label) BETWEEN 3 AND 64
    AND public_credit_label NOT GLOB '*[' || char(0) || '-' || char(31) || ']*'
  ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'erasure_pending', 'tombstoned')),
  identity_version INTEGER NOT NULL DEFAULT 1 CHECK (identity_version >= 1),
  source_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (source_event_sequence >= 0),
  source_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT,
  erasure_requested_at TEXT,
  tombstoned_at TEXT,
  CHECK (
    (status = 'active' AND disabled_at IS NULL AND erasure_requested_at IS NULL AND tombstoned_at IS NULL)
    OR (status = 'disabled' AND disabled_at IS NOT NULL AND erasure_requested_at IS NULL AND tombstoned_at IS NULL)
    OR (status = 'erasure_pending' AND erasure_requested_at IS NOT NULL AND tombstoned_at IS NULL)
    OR (status = 'tombstoned' AND erasure_requested_at IS NOT NULL AND tombstoned_at IS NOT NULL)
  )
);

CREATE TABLE icono_caretaker_terms_versions (
  terms_version_id TEXT PRIMARY KEY,
  terms_sha256 TEXT NOT NULL CHECK (length(terms_sha256) = 64),
  document_url TEXT NOT NULL CHECK (
    length(document_url) BETWEEN 12 AND 500 AND document_url GLOB 'https://*'
  ),
  display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 3 AND 120),
  effective_at TEXT NOT NULL,
  retired_at TEXT,
  created_by_actor_kind TEXT NOT NULL DEFAULT 'account'
    CHECK (created_by_actor_kind IN ('account', 'administrator', 'service', 'migration')),
  created_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (created_by_actor_kind IN ('account', 'administrator') AND created_by_account_id IS NOT NULL)
    OR
    (created_by_actor_kind IN ('service', 'migration') AND created_by_account_id IS NULL)
  )
);

CREATE TABLE icono_gene_identities (
  gene_id TEXT PRIMARY KEY,
  canonical_symbol TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'retired')),
  merged_into_gene_id TEXT REFERENCES icono_gene_identities(gene_id),
  identity_version INTEGER NOT NULL DEFAULT 1 CHECK (identity_version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'merged') = (merged_into_gene_id IS NOT NULL)),
  CHECK (merged_into_gene_id IS NULL OR merged_into_gene_id <> gene_id)
);

CREATE TABLE icono_gene_aliases (
  alias_symbol TEXT PRIMARY KEY COLLATE NOCASE,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('canonical', 'previous', 'synonym', 'merge_source')),
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TEXT
);

CREATE INDEX idx_icono_gene_aliases_gene
  ON icono_gene_aliases (gene_id, retired_at, alias_kind);

-- Immutable registration baseline lets a later paged snapshot replay gene
-- history exactly even after the live identity has been renamed or merged.
CREATE TABLE icono_gene_identity_baselines (
  gene_id TEXT PRIMARY KEY REFERENCES icono_gene_identities(gene_id),
  canonical_symbol TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE TABLE icono_manifestation_heads (
  gene_id TEXT PRIMARY KEY REFERENCES icono_gene_identities(gene_id),
  canonical_manifestation_id TEXT,
  canonical_revision_id TEXT,
  canonical_selection_id TEXT,
  head_version INTEGER NOT NULL DEFAULT 0 CHECK (head_version >= 0),
  gene_revision INTEGER NOT NULL DEFAULT 0 CHECK (gene_revision >= 0),
  last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (canonical_manifestation_id IS NULL AND canonical_revision_id IS NULL AND canonical_selection_id IS NULL)
    OR
    (canonical_manifestation_id IS NOT NULL AND canonical_revision_id IS NOT NULL AND canonical_selection_id IS NOT NULL)
  )
);

CREATE TABLE icono_caretaker_assignments (
  caretaker_assignment_id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  account_id TEXT NOT NULL REFERENCES icono_authority_accounts(account_id),
  status TEXT NOT NULL CHECK (status IN ('pending_acceptance', 'active', 'suspended', 'ended')),
  assignment_version INTEGER NOT NULL DEFAULT 1 CHECK (assignment_version >= 1),
  terms_version_id TEXT REFERENCES icono_caretaker_terms_versions(terms_version_id),
  terms_accepted_at TEXT,
  entitlement_policy_version TEXT NOT NULL,
  entitlement_grace_ends_at TEXT,
  relinquish_policy TEXT CHECK (relinquish_policy IN ('retain', 'withdraw')),
  invited_by_account_id TEXT NOT NULL REFERENCES icono_authority_accounts(account_id),
  ended_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  end_reason TEXT,
  started_at TEXT,
  suspended_at TEXT,
  suspension_reason TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'pending_acceptance'
      AND terms_accepted_at IS NULL AND started_at IS NULL
      AND relinquish_policy IS NULL)
    OR (status IN ('active', 'suspended')
      AND terms_accepted_at IS NOT NULL AND started_at IS NOT NULL
      AND relinquish_policy IS NOT NULL)
    OR (status = 'ended' AND (
      (terms_accepted_at IS NULL AND started_at IS NULL AND relinquish_policy IS NULL)
      OR (terms_accepted_at IS NOT NULL AND started_at IS NOT NULL
        AND relinquish_policy IS NOT NULL)
    ))
  ),
  CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  CHECK (status <> 'ended' OR end_reason IS NOT NULL),
  CHECK (
    (status = 'suspended' AND suspended_at IS NOT NULL
      AND length(trim(suspension_reason)) BETWEEN 1 AND 500)
    OR (status <> 'suspended' AND suspended_at IS NULL AND suspension_reason IS NULL)
  )
);

CREATE UNIQUE INDEX uq_icono_open_caretaker_gene
  ON icono_caretaker_assignments (gene_id)
  WHERE status IN ('pending_acceptance', 'active', 'suspended');

CREATE UNIQUE INDEX uq_icono_open_caretaker_account
  ON icono_caretaker_assignments (account_id)
  WHERE status IN ('pending_acceptance', 'active', 'suspended');

CREATE INDEX idx_icono_caretaker_account_history
  ON icono_caretaker_assignments (account_id, status, created_at DESC);

CREATE TABLE icono_manifestations (
  manifestation_id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  author_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  caretaker_assignment_id TEXT REFERENCES icono_caretaker_assignments(caretaker_assignment_id),
  origin TEXT NOT NULL CHECK (origin IN ('system_seed', 'caretaker', 'service', 'fork')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'moderated', 'purged')),
  manifestation_head_revision_id TEXT,
  source_manifestation_id TEXT REFERENCES icono_manifestations(manifestation_id),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  non_withdrawable INTEGER NOT NULL DEFAULT 0 CHECK (non_withdrawable IN (0, 1)),
  withdrawn_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  withdrawn_at TEXT,
  purge_eligible_at TEXT,
  withdrawal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((origin = 'system_seed') = (non_withdrawable = 1)),
  CHECK (origin = 'system_seed' OR author_account_id IS NOT NULL),
  CHECK (origin NOT IN ('caretaker', 'fork') OR caretaker_assignment_id IS NOT NULL),
  CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CHECK (status = 'withdrawn' OR purge_eligible_at IS NULL)
);

CREATE UNIQUE INDEX uq_icono_open_caretaker_lineage
  ON icono_manifestations (caretaker_assignment_id)
  WHERE caretaker_assignment_id IS NOT NULL
    AND origin IN ('caretaker', 'fork')
    AND status = 'active';

CREATE UNIQUE INDEX uq_icono_active_system_seed
  ON icono_manifestations (gene_id)
  WHERE origin = 'system_seed' AND status = 'active';

CREATE INDEX idx_icono_manifestations_gene_history
  ON icono_manifestations (gene_id, created_at DESC, manifestation_id);

CREATE TABLE icono_manifestation_revisions (
  manifestation_revision_id TEXT PRIMARY KEY,
  manifestation_id TEXT NOT NULL REFERENCES icono_manifestations(manifestation_id),
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  parent_revision_id TEXT REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  source_revision_id TEXT REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  base_canonical_selection_id TEXT,
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  body_bytes INTEGER NOT NULL CHECK (body_bytes BETWEEN 1 AND 16384),
  sample_label TEXT,
  sample_number INTEGER CHECK (sample_number IS NULL OR sample_number >= 0),
  sample_text_sha256 TEXT CHECK (
    sample_text_sha256 IS NULL OR (
      length(sample_text_sha256) = 64 AND sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  author_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  caretaker_assignment_id TEXT REFERENCES icono_caretaker_assignments(caretaker_assignment_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (manifestation_id, revision_number)
);

CREATE INDEX idx_icono_revisions_manifestation_history
  ON icono_manifestation_revisions (manifestation_id, revision_number DESC);

CREATE INDEX idx_icono_revisions_body_hash
  ON icono_manifestation_revisions (body_sha256);

CREATE TABLE icono_manifestation_revision_storage_secrets (
  manifestation_revision_id TEXT PRIMARY KEY REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL CHECK (length(ciphertext_sha256) = 64),
  ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes >= 17),
  body_iv_base64 TEXT NOT NULL,
  wrapped_dek_base64 TEXT NOT NULL,
  wrap_iv_base64 TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  aad_version INTEGER NOT NULL DEFAULT 1 CHECK (aad_version = 1),
  object_etag TEXT,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE icono_manifestation_revision_lifecycle (
  manifestation_revision_id TEXT PRIMARY KEY REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'withdrawn', 'moderated', 'quarantined', 'purged')),
  lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version >= 1),
  changed_by_account_id TEXT,
  change_reason TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE icono_manifestation_derivatives (
  manifestation_derivative_id TEXT PRIMARY KEY,
  manifestation_revision_id TEXT NOT NULL REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  derivative_kind TEXT NOT NULL CHECK (derivative_kind IN ('tags')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed', 'superseded', 'purged')),
  source_body_sha256 TEXT NOT NULL CHECK (length(source_body_sha256) = 64),
  body_sha256 TEXT CHECK (body_sha256 IS NULL OR length(body_sha256) = 64),
  body_bytes INTEGER CHECK (body_bytes IS NULL OR body_bytes BETWEEN 1 AND 32768),
  tags_sha256 TEXT CHECK (
    tags_sha256 IS NULL OR (length(tags_sha256) = 64 AND tags_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  tags_bytes INTEGER CHECK (tags_bytes IS NULL OR tags_bytes BETWEEN 1 AND 32767),
  fields_sha256 TEXT CHECK (
    fields_sha256 IS NULL OR (length(fields_sha256) = 64 AND fields_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  fields_bytes INTEGER CHECK (fields_bytes IS NULL OR fields_bytes BETWEEN 2 AND 32766),
  recipe_id TEXT,
  recipe_version TEXT,
  provider_id TEXT,
  model_id TEXT,
  tagger_config_sha256 TEXT CHECK (
    tagger_config_sha256 IS NULL OR (
      length(tagger_config_sha256) = 64 AND tagger_config_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  provenance_status TEXT NOT NULL DEFAULT 'generated'
    CHECK (provenance_status IN ('generated', 'legacy_unknown')),
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  CHECK ((status IN ('complete', 'superseded', 'purged')) = (
    body_sha256 IS NOT NULL AND body_bytes IS NOT NULL
    AND tags_sha256 IS NOT NULL AND tags_bytes IS NOT NULL
    AND fields_sha256 IS NOT NULL AND fields_bytes IS NOT NULL
    AND body_bytes = tags_bytes + 1 + fields_bytes
  )),
  CHECK (
    (provenance_status = 'legacy_unknown' AND recipe_id IS NULL
      AND recipe_version IS NULL AND provider_id IS NULL AND model_id IS NULL
      AND tagger_config_sha256 IS NULL)
    OR
    (provenance_status = 'generated' AND recipe_id IS NOT NULL
      AND recipe_version IS NOT NULL AND provider_id IS NOT NULL
      AND model_id IS NOT NULL AND tagger_config_sha256 IS NOT NULL)
  )
);

CREATE INDEX idx_icono_derivatives_revision
  ON icono_manifestation_derivatives (manifestation_revision_id, created_at DESC);

CREATE TABLE icono_manifestation_derivative_storage_secrets (
  manifestation_derivative_id TEXT PRIMARY KEY REFERENCES icono_manifestation_derivatives(manifestation_derivative_id),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL CHECK (length(ciphertext_sha256) = 64),
  ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes >= 17),
  body_iv_base64 TEXT NOT NULL,
  wrapped_dek_base64 TEXT NOT NULL,
  wrap_iv_base64 TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  aad_version INTEGER NOT NULL DEFAULT 1 CHECK (aad_version = 1),
  object_etag TEXT,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE icono_manifestation_derivative_heads (
  manifestation_revision_id TEXT PRIMARY KEY REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  accepted_derivative_id TEXT REFERENCES icono_manifestation_derivatives(manifestation_derivative_id),
  derivative_head_version INTEGER NOT NULL DEFAULT 0 CHECK (derivative_head_version >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE icono_manifestation_canonical_selections (
  canonical_selection_id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  previous_selection_id TEXT REFERENCES icono_manifestation_canonical_selections(canonical_selection_id),
  previous_revision_id TEXT REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  selected_manifestation_id TEXT NOT NULL REFERENCES icono_manifestations(manifestation_id),
  selected_revision_id TEXT NOT NULL REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  actor_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  caretaker_assignment_id TEXT REFERENCES icono_caretaker_assignments(caretaker_assignment_id),
  reason TEXT NOT NULL CHECK (reason IN (
    'seed', 'save', 'select', 'restore', 'fork', 'withdrawal_fallback',
    'assignment_end_fallback', 'moderation_fallback', 'moderation_reinstate',
    'integrity_fallback', 'purge_fallback', 'migration'
  )),
  command_id TEXT NOT NULL UNIQUE,
  head_version INTEGER NOT NULL CHECK (head_version >= 1),
  gene_revision INTEGER NOT NULL CHECK (gene_revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (gene_id, head_version),
  UNIQUE (gene_id, gene_revision)
);

CREATE INDEX idx_icono_canonical_selection_history
  ON icono_manifestation_canonical_selections (gene_id, head_version DESC);

CREATE TABLE icono_authoring_command_receipts (
  command_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('account', 'administrator', 'service', 'migration')),
  actor_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  gene_id TEXT REFERENCES icono_gene_identities(gene_id),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  accepted_event_sequence INTEGER,
  accepted_event_uuid TEXT,
  accepted_gene_revision INTEGER CHECK (
    accepted_gene_revision IS NULL OR accepted_gene_revision >= 1
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (accepted_event_sequence IS NULL AND accepted_event_uuid IS NULL
      AND accepted_gene_revision IS NULL)
    OR (accepted_event_sequence IS NOT NULL AND accepted_event_uuid IS NOT NULL
      AND accepted_gene_revision IS NOT NULL)
  )
);

CREATE TABLE icono_manifestation_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL UNIQUE REFERENCES icono_authoring_command_receipts(command_id),
  event_type TEXT NOT NULL,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  gene_revision INTEGER NOT NULL CHECK (gene_revision >= 1),
  manifestation_id TEXT REFERENCES icono_manifestations(manifestation_id),
  manifestation_revision_id TEXT REFERENCES icono_manifestation_revisions(manifestation_revision_id),
  canonical_selection_id TEXT REFERENCES icono_manifestation_canonical_selections(canonical_selection_id),
  caretaker_assignment_id TEXT REFERENCES icono_caretaker_assignments(caretaker_assignment_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  projection_status TEXT NOT NULL DEFAULT 'pending' CHECK (projection_status IN ('pending', 'published', 'failed', 'not_required')),
  projection_attempts INTEGER NOT NULL DEFAULT 0 CHECK (projection_attempts >= 0),
  projection_next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (gene_id, gene_revision)
);

CREATE INDEX idx_icono_events_cursor
  ON icono_manifestation_events (event_sequence);

CREATE INDEX idx_icono_events_projection_due
  ON icono_manifestation_events (projection_status, projection_next_attempt_at, event_sequence);

CREATE TABLE icono_manifestation_consumer_cursors (
  consumer_id TEXT PRIMARY KEY,
  last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE icono_manifestation_snapshot_leases (
  snapshot_id TEXT PRIMARY KEY,
  consumer_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 1),
  watermark_event_sequence INTEGER NOT NULL CHECK (watermark_event_sequence >= 0),
  source_checkpoint_id TEXT,
  source_checkpoint_watermark_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (source_checkpoint_watermark_sequence >= 0),
  status TEXT NOT NULL CHECK (status IN ('building', 'open', 'completed', 'expired')),
  build_phase TEXT NOT NULL DEFAULT 'baselines'
    CHECK (build_phase IN ('baselines', 'checkpoint_entities', 'events', 'ready')),
  build_after_key TEXT,
  next_part_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (next_part_ordinal >= 1),
  build_chain_sha256 TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
    CHECK (length(build_chain_sha256) = 64 AND build_chain_sha256 NOT GLOB '*[^0-9a-f]*'),
  total_parts INTEGER CHECK (total_parts IS NULL OR total_parts >= 0),
  manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL OR (
      length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  completed_at TEXT,
  CHECK (
    (status IN ('open', 'completed') AND total_parts IS NOT NULL AND manifest_sha256 IS NOT NULL)
    OR (status = 'building' AND total_parts IS NULL AND manifest_sha256 IS NULL)
    OR status = 'expired'
  )
);

CREATE TABLE icono_manifestation_legal_holds (
  legal_hold_id TEXT PRIMARY KEY,
  manifestation_id TEXT NOT NULL REFERENCES icono_manifestations(manifestation_id),
  reason TEXT NOT NULL,
  placed_by_account_id TEXT NOT NULL,
  placed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by_account_id TEXT,
  released_at TEXT
);

CREATE UNIQUE INDEX uq_icono_active_manifestation_legal_hold
  ON icono_manifestation_legal_holds (manifestation_id)
  WHERE released_at IS NULL;

CREATE TABLE icono_manifestation_object_purge_queue (
  purge_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative', 'orphan')),
  entity_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  ciphertext_sha256 TEXT NOT NULL CHECK (length(ciphertext_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'held', 'processing', 'deleted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  requested_by_actor_kind TEXT NOT NULL
    CHECK (requested_by_actor_kind IN ('account', 'administrator', 'service', 'migration')),
  requested_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE (object_key)
);

-- Domain commands insert a row with a computed guard value as the first
-- statement in their D1 batch and delete it as the final statement. A stale
-- expectation produces zero, violates this CHECK, and rolls the entire D1
-- batch back rather than letting later statements partially commit.
CREATE TABLE icono_authority_command_guards (
  command_id TEXT PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK (guard_value = 1)
);

CREATE TRIGGER icono_manifestation_revisions_immutable_update
BEFORE UPDATE ON icono_manifestation_revisions
BEGIN
  SELECT RAISE(ABORT, 'manifestation_revisions_are_immutable');
end;

CREATE TRIGGER icono_manifestation_revisions_immutable_delete
BEFORE DELETE ON icono_manifestation_revisions
BEGIN
  SELECT RAISE(ABORT, 'manifestation_revisions_are_immutable');
end;

CREATE TRIGGER icono_canonical_selections_validate
BEFORE INSERT ON icono_manifestation_canonical_selections
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1
    FROM icono_manifestations m
    JOIN icono_manifestation_revisions r
      ON r.manifestation_id = m.manifestation_id
    JOIN icono_manifestation_revision_lifecycle l
      ON l.manifestation_revision_id = r.manifestation_revision_id
    WHERE m.manifestation_id = NEW.selected_manifestation_id
      AND m.gene_id = NEW.gene_id
      AND m.status = 'active'
      AND r.manifestation_revision_id = NEW.selected_revision_id
      AND l.status = 'active'
      AND EXISTS (
        SELECT 1 FROM icono_manifestation_revision_storage_secrets s
        WHERE s.manifestation_revision_id = r.manifestation_revision_id
      )
  ) THEN RAISE(ABORT, 'canonical_revision_is_not_eligible') end;
  SELECT case WHEN (
    SELECT canonical_selection_id FROM icono_manifestation_heads WHERE gene_id = NEW.gene_id
  ) IS NOT NEW.previous_selection_id THEN RAISE(ABORT, 'stale_canonical_selection') end;
  SELECT case WHEN (
    SELECT head_version FROM icono_manifestation_heads WHERE gene_id = NEW.gene_id
  ) <> NEW.head_version - 1 THEN RAISE(ABORT, 'stale_manifestation_head_version') end;
  SELECT case WHEN (
    SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = NEW.gene_id
  ) <> NEW.gene_revision - 1 THEN RAISE(ABORT, 'stale_gene_revision') end;
end;

CREATE TRIGGER icono_canonical_selections_apply
AFTER INSERT ON icono_manifestation_canonical_selections
BEGIN
  UPDATE icono_manifestation_heads
     SET canonical_manifestation_id = NEW.selected_manifestation_id,
         canonical_revision_id = NEW.selected_revision_id,
         canonical_selection_id = NEW.canonical_selection_id,
         head_version = NEW.head_version,
         gene_revision = NEW.gene_revision,
         updated_at = CURRENT_TIMESTAMP
   WHERE gene_id = NEW.gene_id;
end;

CREATE TRIGGER icono_canonical_selections_immutable_update
BEFORE UPDATE ON icono_manifestation_canonical_selections
BEGIN
  SELECT RAISE(ABORT, 'canonical_selections_are_immutable');
end;

CREATE TRIGGER icono_canonical_selections_immutable_delete
BEFORE DELETE ON icono_manifestation_canonical_selections
BEGIN
  SELECT RAISE(ABORT, 'canonical_selections_are_immutable');
end;

CREATE TRIGGER icono_events_validate_gene_revision
BEFORE INSERT ON icono_manifestation_events
BEGIN
  SELECT case WHEN (
    SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = NEW.gene_id
  ) <> NEW.gene_revision THEN RAISE(ABORT, 'event_gene_revision_mismatch') end;
end;

CREATE TRIGGER icono_events_apply_receipt_and_head
AFTER INSERT ON icono_manifestation_events
BEGIN
  UPDATE icono_authoring_command_receipts
     SET accepted_event_sequence = NEW.event_sequence,
         accepted_event_uuid = NEW.event_uuid,
         accepted_gene_revision = NEW.gene_revision
   WHERE command_id = NEW.command_id;
  UPDATE icono_manifestation_heads
     SET last_event_sequence = NEW.event_sequence,
         updated_at = CURRENT_TIMESTAMP
   WHERE gene_id = NEW.gene_id;
end;

CREATE TRIGGER icono_events_immutable_update
BEFORE UPDATE OF event_uuid, command_id, event_type, gene_id, gene_revision,
  manifestation_id, manifestation_revision_id, canonical_selection_id,
  caretaker_assignment_id, payload_json, created_at
ON icono_manifestation_events
BEGIN
  SELECT RAISE(ABORT, 'manifestation_events_are_immutable');
end;

CREATE TRIGGER icono_events_immutable_delete
BEFORE DELETE ON icono_manifestation_events
BEGIN
  SELECT RAISE(ABORT, 'manifestation_events_are_immutable');
end;

CREATE TRIGGER icono_revision_body_quota_validate
BEFORE INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT case WHEN (
    SELECT body_admitted_bytes + r.body_bytes
    FROM icono_authority_state s
    JOIN icono_manifestation_revisions r
      ON r.manifestation_revision_id = NEW.manifestation_revision_id
    WHERE s.singleton = 1
  ) > (
    SELECT body_admitted_limit_bytes FROM icono_authority_state WHERE singleton = 1
  ) THEN RAISE(ABORT, 'authoring_body_quota_exceeded') end;
end;

CREATE TRIGGER icono_revision_body_quota_add
AFTER INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  UPDATE icono_authority_state
     SET body_admitted_bytes = body_admitted_bytes + (
           SELECT body_bytes FROM icono_manifestation_revisions
           WHERE manifestation_revision_id = NEW.manifestation_revision_id
         ),
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_revision_body_quota_remove
AFTER DELETE ON icono_manifestation_revision_storage_secrets
BEGIN
  UPDATE icono_authority_state
     SET body_admitted_bytes = MAX(0, body_admitted_bytes - (
           SELECT body_bytes FROM icono_manifestation_revisions
           WHERE manifestation_revision_id = OLD.manifestation_revision_id
         )),
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_derivative_body_quota_validate
BEFORE INSERT ON icono_manifestation_derivative_storage_secrets
BEGIN
  SELECT case WHEN (
    SELECT body_admitted_bytes + derivative.body_bytes
      FROM icono_authority_state state
      JOIN icono_manifestation_derivatives derivative
        ON derivative.manifestation_derivative_id = NEW.manifestation_derivative_id
     WHERE state.singleton = 1
  ) > (
    SELECT body_admitted_limit_bytes FROM icono_authority_state WHERE singleton = 1
  ) THEN RAISE(ABORT, 'authoring_body_quota_exceeded') end;
end;

CREATE TRIGGER icono_derivative_body_quota_add
AFTER INSERT ON icono_manifestation_derivative_storage_secrets
BEGIN
  UPDATE icono_authority_state
     SET body_admitted_bytes = body_admitted_bytes + (
           SELECT body_bytes FROM icono_manifestation_derivatives
            WHERE manifestation_derivative_id = NEW.manifestation_derivative_id
         ),
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_derivative_body_quota_remove
AFTER DELETE ON icono_manifestation_derivative_storage_secrets
BEGIN
  UPDATE icono_authority_state
     SET body_admitted_bytes = MAX(0, body_admitted_bytes - (
           SELECT body_bytes FROM icono_manifestation_derivatives
            WHERE manifestation_derivative_id = OLD.manifestation_derivative_id
         )),
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_gene_identity_create_head
AFTER INSERT ON icono_gene_identities
BEGIN
  INSERT INTO icono_manifestation_heads (gene_id) VALUES (NEW.gene_id);
  INSERT INTO icono_gene_aliases (alias_symbol, gene_id, alias_kind)
  VALUES (NEW.canonical_symbol, NEW.gene_id, 'canonical');
  INSERT INTO icono_gene_identity_baselines (gene_id, canonical_symbol, registered_at)
  VALUES (NEW.gene_id, NEW.canonical_symbol, NEW.created_at);
end;

CREATE TRIGGER icono_nonwithdrawable_manifestation_guard
BEFORE UPDATE OF status ON icono_manifestations
WHEN OLD.non_withdrawable = 1 AND NEW.status <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'system_seed_cannot_be_withdrawn');
end;

CREATE TRIGGER icono_manifestation_hard_purge_legal_hold_guard
BEFORE UPDATE OF status ON icono_manifestations
WHEN NEW.status = 'purged'
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_legal_holds h
    WHERE h.manifestation_id = NEW.manifestation_id AND h.released_at IS NULL
  ) THEN RAISE(ABORT, 'manifestation_is_under_legal_hold') end;
end;

CREATE TRIGGER icono_caretaker_assignments_validate_insert
BEFORE INSERT ON icono_caretaker_assignments
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_gene_identities g
     WHERE g.gene_id = NEW.gene_id AND g.status = 'active'
  ) THEN RAISE(ABORT, 'caretaker_assignment_gene_is_not_active') end;
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_authority_accounts a
     WHERE a.account_id = NEW.account_id AND a.status = 'active'
  ) THEN RAISE(ABORT, 'caretaker_assignment_account_is_not_active') end;
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_authority_accounts a
     WHERE a.account_id = NEW.invited_by_account_id AND a.status = 'active'
  ) THEN RAISE(ABORT, 'caretaker_assignment_inviter_is_not_active') end;
end;

CREATE TRIGGER icono_caretaker_assignments_terminal
BEFORE UPDATE ON icono_caretaker_assignments
WHEN OLD.status = 'ended'
BEGIN
  SELECT RAISE(ABORT, 'ended_caretaker_assignment_is_terminal');
end;

CREATE TRIGGER icono_caretaker_assignments_validate_update
BEFORE UPDATE ON icono_caretaker_assignments
BEGIN
  SELECT case WHEN OLD.status = 'ended'
  THEN RAISE(ABORT, 'ended_caretaker_assignment_is_terminal') end;
  SELECT case WHEN NEW.gene_id IS NOT OLD.gene_id
    OR NEW.account_id IS NOT OLD.account_id
    OR NEW.invited_by_account_id IS NOT OLD.invited_by_account_id
  THEN RAISE(ABORT, 'caretaker_assignment_identity_is_immutable') end;
  SELECT case WHEN NOT (
       (OLD.status = 'pending_acceptance' AND NEW.status IN ('pending_acceptance', 'active', 'ended'))
    OR (OLD.status = 'active' AND NEW.status IN ('active', 'suspended', 'ended'))
    OR (OLD.status = 'suspended' AND NEW.status IN ('suspended', 'active', 'ended'))
  ) THEN RAISE(ABORT, 'invalid_caretaker_assignment_transition') end;
  SELECT case WHEN OLD.status IN ('active', 'suspended')
    AND NEW.status IN ('active', 'suspended')
    AND NEW.relinquish_policy IS NOT OLD.relinquish_policy
  THEN RAISE(ABORT, 'relinquish_policy_changes_only_at_terminal_end') end;
  SELECT case WHEN OLD.status IN ('active', 'suspended') AND NEW.status = 'ended'
    AND NEW.relinquish_policy IS NULL
  THEN RAISE(ABORT, 'terminal_end_requires_relinquish_policy') end;
  SELECT case WHEN OLD.status = 'pending_acceptance' AND NEW.status = 'ended'
    AND (NEW.relinquish_policy IS NOT NULL OR NEW.terms_accepted_at IS NOT NULL
      OR NEW.started_at IS NOT NULL)
  THEN RAISE(ABORT, 'unaccepted_invitation_end_cannot_claim_acceptance') end;
  SELECT case WHEN OLD.terms_accepted_at IS NOT NULL
    AND (NEW.terms_version_id IS NOT OLD.terms_version_id
      OR NEW.terms_accepted_at IS NOT OLD.terms_accepted_at)
  THEN RAISE(ABORT, 'accepted_caretaker_terms_are_immutable') end;
  SELECT case WHEN (NEW.status IN ('active', 'suspended')
      OR (NEW.status = 'ended' AND NEW.terms_accepted_at IS NOT NULL)) AND NOT EXISTS (
    SELECT 1 FROM icono_caretaker_terms_versions t
     WHERE t.terms_version_id = NEW.terms_version_id
       AND (t.retired_at IS NULL OR NEW.terms_accepted_at < t.retired_at)
  ) THEN RAISE(ABORT, 'caretaker_assignment_terms_are_invalid') end;
end;

CREATE TRIGGER icono_manifestations_validate_insert
BEFORE INSERT ON icono_manifestations
BEGIN
  SELECT case WHEN NEW.origin = 'system_seed'
    AND (NEW.author_account_id IS NOT NULL OR NEW.caretaker_assignment_id IS NOT NULL)
  THEN RAISE(ABORT, 'system_seed_has_no_account_authority') end;
  SELECT case WHEN NEW.origin IN ('caretaker', 'fork') AND NOT EXISTS (
    SELECT 1 FROM icono_caretaker_assignments a
     WHERE a.caretaker_assignment_id = NEW.caretaker_assignment_id
       AND a.gene_id = NEW.gene_id
       AND a.account_id = NEW.author_account_id
       AND a.status = 'active'
  ) THEN RAISE(ABORT, 'manifestation_assignment_authority_mismatch') end;
  SELECT case WHEN NEW.source_manifestation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM icono_manifestations source
     WHERE source.manifestation_id = NEW.source_manifestation_id
       AND source.gene_id = NEW.gene_id
  ) THEN RAISE(ABORT, 'source_manifestation_gene_mismatch') end;
end;

CREATE TRIGGER icono_manifestations_identity_immutable
BEFORE UPDATE OF gene_id, author_account_id, caretaker_assignment_id, origin,
  source_manifestation_id, non_withdrawable
ON icono_manifestations
BEGIN
  SELECT case WHEN NEW.gene_id IS NOT OLD.gene_id
    OR NEW.author_account_id IS NOT OLD.author_account_id
    OR NEW.caretaker_assignment_id IS NOT OLD.caretaker_assignment_id
    OR NEW.origin IS NOT OLD.origin
    OR NEW.source_manifestation_id IS NOT OLD.source_manifestation_id
    OR NEW.non_withdrawable IS NOT OLD.non_withdrawable
  THEN RAISE(ABORT, 'manifestation_identity_is_immutable') end;
end;

CREATE TRIGGER icono_manifestation_head_revision_validate
BEFORE UPDATE OF manifestation_head_revision_id ON icono_manifestations
WHEN NEW.manifestation_head_revision_id IS NOT NULL
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_revisions r
    JOIN icono_manifestation_revision_lifecycle l
      ON l.manifestation_revision_id = r.manifestation_revision_id
    JOIN icono_manifestation_revision_storage_secrets s
      ON s.manifestation_revision_id = r.manifestation_revision_id
    WHERE r.manifestation_revision_id = NEW.manifestation_head_revision_id
      AND r.manifestation_id = NEW.manifestation_id
      AND l.status = 'active'
  ) THEN RAISE(ABORT, 'manifestation_head_revision_is_not_eligible') end;
end;

CREATE TRIGGER icono_manifestation_revisions_validate_insert
BEFORE INSERT ON icono_manifestation_revisions
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestations m
     WHERE m.manifestation_id = NEW.manifestation_id
       AND NEW.author_account_id IS m.author_account_id
       AND NEW.caretaker_assignment_id IS m.caretaker_assignment_id
  ) THEN RAISE(ABORT, 'revision_authority_mismatch') end;
  SELECT case WHEN (NEW.revision_number = 1) <> (NEW.parent_revision_id IS NULL)
  THEN RAISE(ABORT, 'revision_parent_shape_is_invalid') end;
  SELECT case WHEN NEW.parent_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM icono_manifestation_revisions parent
    JOIN icono_manifestations m ON m.manifestation_id = NEW.manifestation_id
    WHERE parent.manifestation_revision_id = NEW.parent_revision_id
      AND parent.manifestation_id = NEW.manifestation_id
      AND parent.revision_number = NEW.revision_number - 1
      AND m.manifestation_head_revision_id = parent.manifestation_revision_id
  ) THEN RAISE(ABORT, 'revision_parent_is_not_lineage_head') end;
  SELECT case WHEN NEW.source_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM icono_manifestation_revisions source_revision
      JOIN icono_manifestations source_manifestation
        ON source_manifestation.manifestation_id = source_revision.manifestation_id
      JOIN icono_manifestations target_manifestation
        ON target_manifestation.manifestation_id = NEW.manifestation_id
     WHERE source_revision.manifestation_revision_id = NEW.source_revision_id
       AND source_manifestation.gene_id = target_manifestation.gene_id
  ) THEN RAISE(ABORT, 'source_revision_gene_mismatch') end;
  SELECT case WHEN NEW.base_canonical_selection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM icono_manifestation_canonical_selections selection
      JOIN icono_manifestations target
        ON target.manifestation_id = NEW.manifestation_id
     WHERE selection.canonical_selection_id = NEW.base_canonical_selection_id
       AND selection.gene_id = target.gene_id
  ) THEN RAISE(ABORT, 'base_selection_gene_mismatch') end;
end;

CREATE TRIGGER icono_revision_storage_validate_insert
BEFORE INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT case WHEN NEW.object_key LIKE '%/' || NEW.manifestation_revision_id || '.bin'
  THEN RAISE(ABORT, 'predictable_manifestation_object_key') end;
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_revisions r
     WHERE r.manifestation_revision_id = NEW.manifestation_revision_id
       AND NEW.ciphertext_bytes = r.body_bytes + 16
  ) THEN RAISE(ABORT, 'manifestation_ciphertext_size_mismatch') end;
end;

CREATE TRIGGER icono_canonical_manifestation_reselect_before_ineligible
BEFORE UPDATE OF status ON icono_manifestations
WHEN OLD.status = 'active' AND NEW.status <> 'active'
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_heads h
     WHERE h.canonical_manifestation_id = OLD.manifestation_id
  ) THEN RAISE(ABORT, 'canonical_manifestation_must_be_reselected_first') end;
end;

CREATE TRIGGER icono_canonical_revision_reselect_before_ineligible
BEFORE UPDATE OF status ON icono_manifestation_revision_lifecycle
WHEN OLD.status = 'active' AND NEW.status <> 'active'
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_heads h
     WHERE h.canonical_revision_id = OLD.manifestation_revision_id
  ) THEN RAISE(ABORT, 'canonical_revision_must_be_reselected_first') end;
end;

CREATE TRIGGER icono_canonical_storage_reselect_before_delete
BEFORE DELETE ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_heads h
     WHERE h.canonical_revision_id = OLD.manifestation_revision_id
  ) THEN RAISE(ABORT, 'canonical_revision_storage_must_be_reselected_first') end;
end;

CREATE TRIGGER icono_command_receipts_validate_json
BEFORE INSERT ON icono_authoring_command_receipts
BEGIN
  SELECT case WHEN json_type(NEW.response_json) <> 'object'
  THEN RAISE(ABORT, 'command_response_must_be_json_object') end;
end;

CREATE TRIGGER icono_events_validate_snapshot
BEFORE INSERT ON icono_manifestation_events
BEGIN
  SELECT case WHEN json_type(NEW.payload_json) <> 'object'
    OR json_type(NEW.payload_json, '$.schema_version') <> 'integer'
    OR json_type(NEW.payload_json, '$.cause') <> 'text'
    OR json_type(NEW.payload_json, '$.gene') <> 'object'
    OR json_type(NEW.payload_json, '$.assignment') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.manifestation') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.canonical') <> 'object'
    OR json_type(NEW.payload_json, '$.changed_revision') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.changed_selection') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.changed_aliases') <> 'array'
    OR json_type(NEW.payload_json, '$.gene.aliases') <> 'array'
    OR json_type(NEW.payload_json, '$.tombstones') <> 'array'
  THEN RAISE(ABORT, 'event_payload_is_not_complete_snapshot') end;
  SELECT case WHEN json_extract(NEW.payload_json, '$.gene.gene_id') IS NOT NEW.gene_id
    OR json_extract(NEW.payload_json, '$.canonical.gene_revision') IS NOT NEW.gene_revision
  THEN RAISE(ABORT, 'event_payload_head_mismatch') end;
  SELECT case WHEN json_type(NEW.payload_json, '$.changed_selection') = 'object'
    AND (
      json_extract(NEW.payload_json, '$.changed_selection.canonical_selection_id')
        IS NOT NEW.canonical_selection_id
      OR json_extract(NEW.payload_json, '$.changed_selection.head_version')
        IS NOT json_extract(NEW.payload_json, '$.canonical.head_version')
      OR json_extract(NEW.payload_json, '$.changed_selection.gene_revision')
        IS NOT NEW.gene_revision
    )
  THEN RAISE(ABORT, 'event_changed_selection_mismatch') end;
  SELECT case WHEN
    (NEW.canonical_selection_id IS NOT NULL)
      <> (json_type(NEW.payload_json, '$.changed_selection') = 'object')
  THEN RAISE(ABORT, 'event_changed_selection_presence_mismatch') end;
  SELECT case WHEN NEW.canonical_selection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM icono_manifestation_canonical_selections selection
     WHERE selection.canonical_selection_id = NEW.canonical_selection_id
       AND selection.gene_id = NEW.gene_id
       AND selection.selected_manifestation_id =
         json_extract(NEW.payload_json, '$.changed_selection.selected_manifestation_id')
       AND selection.selected_revision_id =
         json_extract(NEW.payload_json, '$.changed_selection.selected_revision_id')
       AND selection.command_id = NEW.command_id
       AND selection.head_version =
         json_extract(NEW.payload_json, '$.changed_selection.head_version')
       AND selection.gene_revision = NEW.gene_revision
  ) THEN RAISE(ABORT, 'event_changed_selection_record_mismatch') end;
  SELECT case WHEN NEW.manifestation_id IS NOT NULL
    AND NEW.manifestation_revision_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM icono_manifestation_revisions revision
       WHERE revision.manifestation_revision_id = NEW.manifestation_revision_id
         AND revision.manifestation_id = NEW.manifestation_id
    )
  THEN RAISE(ABORT, 'event_manifestation_revision_mismatch') end;
  SELECT case WHEN EXISTS (
    SELECT 1 FROM json_tree(NEW.payload_json)
     WHERE lower(COALESCE(key, '')) IN (
       'prose', 'body', 'text', 'content', 'object_key', 'ciphertext_sha256',
       'ciphertext_bytes', 'body_iv_base64', 'wrapped_dek_base64',
       'wrap_iv_base64', 'object_etag'
     )
  ) THEN RAISE(ABORT, 'event_payload_contains_prose_or_storage_secret') end;
end;

CREATE TRIGGER icono_command_guard_requires_atomic_event
BEFORE DELETE ON icono_authority_command_guards
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1
      FROM icono_authoring_command_receipts receipt
      JOIN icono_manifestation_events event
        ON event.event_sequence = receipt.accepted_event_sequence
      JOIN icono_manifestation_heads head ON head.gene_id = event.gene_id
     WHERE receipt.command_id = OLD.command_id
       AND event.command_id = OLD.command_id
       AND head.gene_revision = event.gene_revision
       AND head.last_event_sequence = event.event_sequence
  ) THEN RAISE(ABORT, 'authority_command_requires_atomic_event') end;
end;
