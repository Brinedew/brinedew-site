-- ARCHITECTURE FENCE [IPD-012]: server-only caretaker read, sync, derivative,
-- and object-reconciliation state. No plaintext manifestation or Tags body is
-- admitted to D1.
PRAGMA foreign_keys = ON;

CREATE TABLE icono_manifestation_snapshot_parts (
  snapshot_id TEXT NOT NULL REFERENCES icono_manifestation_snapshot_leases(snapshot_id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  part_kind TEXT NOT NULL CHECK (
    part_kind IN ('gene_baseline', 'authority_checkpoint_entity', 'authority_event')
  ),
  source_key TEXT NOT NULL,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  part_json TEXT NOT NULL CHECK (json_valid(part_json) AND json_type(part_json) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (snapshot_id, ordinal),
  UNIQUE (snapshot_id, part_kind, source_key)
);

CREATE INDEX idx_icono_snapshot_part_page
  ON icono_manifestation_snapshot_parts (snapshot_id, ordinal);

CREATE TABLE icono_authoring_command_tombstones (
  command_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN ('account', 'administrator', 'service', 'migration')
  ),
  actor_account_id TEXT,
  gene_id TEXT,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  response_sha256 TEXT NOT NULL CHECK (length(response_sha256) = 64),
  accepted_event_sequence INTEGER NOT NULL CHECK (accepted_event_sequence >= 1),
  accepted_event_uuid TEXT NOT NULL,
  accepted_gene_revision INTEGER NOT NULL CHECK (accepted_gene_revision >= 1),
  original_created_at TEXT NOT NULL,
  compacted_at TEXT NOT NULL
);

CREATE INDEX idx_icono_command_tombstones_retention
  ON icono_authoring_command_tombstones (compacted_at, command_id);

-- A checkpoint is the compact, normalized replacement for the prunable prefix
-- of the ordered event stream. It retains one current record per mutable
-- entity and every immutable revision/selection/derivative record required for
-- history and rollback. Candidates are built only from an immutable prior
-- checkpoint plus an immutable event suffix at a fixed watermark.
CREATE TABLE icono_manifestation_event_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 1),
  base_checkpoint_id TEXT REFERENCES icono_manifestation_event_checkpoints(checkpoint_id),
  base_watermark_event_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (base_watermark_event_sequence >= 0),
  target_watermark_event_sequence INTEGER NOT NULL
    CHECK (target_watermark_event_sequence >= base_watermark_event_sequence),
  status TEXT NOT NULL CHECK (
    status IN ('building', 'verified', 'active', 'superseded', 'failed')
  ),
  build_phase TEXT NOT NULL CHECK (
    build_phase IN ('gene_baselines', 'checkpoint_entities', 'events', 'verify', 'ready')
  ),
  build_after_key TEXT,
  build_after_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (build_after_event_sequence >= 0),
  build_event_entity_offset INTEGER NOT NULL DEFAULT 0 CHECK (build_event_entity_offset >= 0),
  next_entity_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (next_entity_ordinal >= 1),
  verify_chain_sha256 TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
    CHECK (length(verify_chain_sha256) = 64 AND verify_chain_sha256 NOT GLOB '*[^0-9a-f]*'),
  total_entities INTEGER CHECK (total_entities IS NULL OR total_entities >= 0),
  manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL OR (
      length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  activated_at TEXT,
  superseded_at TEXT,
  prune_completed_at TEXT,
  CHECK (
    (status = 'building' AND total_entities IS NULL AND manifest_sha256 IS NULL)
    OR (status IN ('verified', 'active', 'superseded')
      AND build_phase = 'ready' AND total_entities IS NOT NULL AND manifest_sha256 IS NOT NULL)
    OR status = 'failed'
  )
);

CREATE UNIQUE INDEX uq_icono_active_event_checkpoint
  ON icono_manifestation_event_checkpoints ((1)) WHERE status = 'active';

CREATE UNIQUE INDEX uq_icono_building_event_checkpoint
  ON icono_manifestation_event_checkpoints ((1)) WHERE status IN ('building', 'verified');

CREATE TABLE icono_manifestation_event_checkpoint_entities (
  checkpoint_id TEXT NOT NULL
    REFERENCES icono_manifestation_event_checkpoints(checkpoint_id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN (
    'gene_identity', 'gene_alias', 'canonical_head',
    'assignment', 'manifestation', 'revision',
    'canonical_selection', 'tags_derivative', 'derivative_head', 'tombstone'
  )),
  entity_key TEXT NOT NULL,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
  source_event_sequence INTEGER NOT NULL CHECK (source_event_sequence >= 0),
  entity_json TEXT NOT NULL CHECK (json_valid(entity_json) AND json_type(entity_json) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  entity_ordinal INTEGER CHECK (entity_ordinal IS NULL OR entity_ordinal >= 1),
  PRIMARY KEY (checkpoint_id, entity_kind, entity_key),
  UNIQUE (checkpoint_id, entity_ordinal)
);

CREATE INDEX idx_icono_checkpoint_entity_verify
  ON icono_manifestation_event_checkpoint_entities (
    checkpoint_id, entity_kind, entity_key
  );

CREATE TABLE icono_manifestation_event_compaction_delete_guards (
  event_sequence INTEGER PRIMARY KEY,
  event_uuid TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL REFERENCES icono_manifestation_event_checkpoints(checkpoint_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER icono_checkpoint_entities_insert_only_while_building
BEFORE INSERT ON icono_manifestation_event_checkpoint_entities
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_event_checkpoints checkpoint
     WHERE checkpoint.checkpoint_id = NEW.checkpoint_id AND checkpoint.status = 'building'
  ) THEN RAISE(ABORT, 'event_checkpoint_is_not_building') end;
end;

CREATE TRIGGER icono_checkpoint_entities_update_only_while_building
BEFORE UPDATE ON icono_manifestation_event_checkpoint_entities
BEGIN
  SELECT case WHEN NEW.checkpoint_id <> OLD.checkpoint_id
      OR NEW.entity_kind <> OLD.entity_kind OR NEW.entity_key <> OLD.entity_key
      OR NOT EXISTS (
        SELECT 1 FROM icono_manifestation_event_checkpoints checkpoint
         WHERE checkpoint.checkpoint_id = OLD.checkpoint_id AND checkpoint.status = 'building'
      )
    THEN RAISE(ABORT, 'verified_event_checkpoint_is_immutable') end;
end;

CREATE TRIGGER icono_checkpoint_entities_delete_active_guard
BEFORE DELETE ON icono_manifestation_event_checkpoint_entities
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_event_checkpoints checkpoint
   WHERE checkpoint.checkpoint_id = OLD.checkpoint_id AND checkpoint.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'active_event_checkpoint_cannot_be_deleted');
end;

CREATE TRIGGER icono_checkpoint_entities_no_secrets
BEFORE INSERT ON icono_manifestation_event_checkpoint_entities
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM json_tree(NEW.entity_json)
     WHERE lower(COALESCE(key, '')) IN (
       'prose', 'body', 'text', 'content', 'object_key', 'ciphertext_sha256',
       'ciphertext_bytes', 'body_iv_base64', 'wrapped_dek_base64',
       'wrap_iv_base64', 'object_etag'
     )
  ) THEN RAISE(ABORT, 'event_checkpoint_contains_prose_or_storage_secret') end;
end;

DROP TRIGGER icono_events_immutable_delete;

CREATE TRIGGER icono_events_immutable_delete
BEFORE DELETE ON icono_manifestation_events
WHEN NOT EXISTS (
  SELECT 1
    FROM icono_manifestation_event_compaction_delete_guards guard
    JOIN icono_manifestation_event_checkpoints checkpoint
      ON checkpoint.checkpoint_id = guard.checkpoint_id
    JOIN icono_authority_state state ON state.singleton = 1
    JOIN icono_authoring_command_receipts receipt
      ON receipt.command_id = OLD.command_id
   WHERE guard.event_sequence = OLD.event_sequence
     AND guard.event_uuid = OLD.event_uuid
     AND checkpoint.status = 'active'
     AND checkpoint.authority_epoch = state.authority_epoch
     AND checkpoint.target_watermark_event_sequence = state.event_retention_floor
     AND OLD.event_sequence <= checkpoint.target_watermark_event_sequence
     AND receipt.accepted_event_sequence = OLD.event_sequence
     AND receipt.accepted_event_uuid = OLD.event_uuid
)
BEGIN
  SELECT RAISE(ABORT, 'manifestation_events_are_immutable');
end;

CREATE TRIGGER icono_compaction_delete_guard_requires_deleted_event
BEFORE DELETE ON icono_manifestation_event_compaction_delete_guards
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_events event
   WHERE event.event_sequence = OLD.event_sequence AND event.event_uuid = OLD.event_uuid
)
BEGIN
  SELECT RAISE(ABORT, 'compaction_guard_event_still_exists');
end;

CREATE UNIQUE INDEX uq_icono_open_snapshot_consumer
  ON icono_manifestation_snapshot_leases (consumer_id)
  WHERE status IN ('building', 'open');

CREATE TABLE icono_manifestation_orphan_objects (
  orphan_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL CHECK (
    length(ciphertext_sha256) = 64 AND ciphertext_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'adopted', 'deleted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_error_code TEXT,
  requested_by_actor_kind TEXT NOT NULL
    CHECK (requested_by_actor_kind IN ('account', 'administrator', 'service', 'migration')),
  requested_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX idx_icono_orphan_objects_due
  ON icono_manifestation_orphan_objects (status, next_attempt_at, created_at);

-- Durable reservation written before an external PUT. The random locator is
-- discoverable by the sweeper even if a Worker dies between storage and D1.
CREATE TABLE icono_manifestation_upload_intents (
  upload_intent_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'create' CHECK (operation IN ('create', 'restore')),
  caretaker_assignment_id TEXT REFERENCES icono_caretaker_assignments(caretaker_assignment_id),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL CHECK (
    length(ciphertext_sha256) = 64 AND ciphertext_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  planned_body_bytes INTEGER NOT NULL CHECK (planned_body_bytes BETWEEN 1 AND 32768),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'deleting', 'adopted', 'deleted', 'failed')),
  lease_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('account', 'administrator', 'service', 'migration')),
  actor_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  CHECK ((status IN ('adopted', 'deleted')) = (resolved_at IS NOT NULL))
);

CREATE INDEX idx_icono_upload_intents_due
  ON icono_manifestation_upload_intents (status, lease_expires_at, created_at);

CREATE UNIQUE INDEX uq_icono_live_upload_intent_entity
  ON icono_manifestation_upload_intents (entity_kind, entity_id)
  WHERE status IN ('uploading', 'deleting');

CREATE TABLE icono_authority_account_projection_receipts (
  source_event_id TEXT PRIMARY KEY,
  source_event_sequence INTEGER NOT NULL UNIQUE CHECK (source_event_sequence >= 1),
  account_id TEXT NOT NULL REFERENCES icono_authority_accounts(account_id),
  request_sha256 TEXT NOT NULL CHECK (
    length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
);

CREATE TRIGGER icono_account_projection_receipt_requires_applied_state
BEFORE INSERT ON icono_authority_account_projection_receipts
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_authority_accounts account
     WHERE account.account_id = NEW.account_id
       AND account.source_event_sequence = NEW.source_event_sequence
       AND account.source_event_id = NEW.source_event_id
  ) THEN RAISE(ABORT, 'account_projection_state_not_applied') end;
end;

CREATE TRIGGER icono_upload_intent_admission
BEFORE INSERT ON icono_manifestation_upload_intents
BEGIN
  SELECT case WHEN NEW.lease_expires_at <= NEW.created_at
    THEN RAISE(ABORT, 'upload_intent_lease_is_not_future') end;
  SELECT case WHEN NEW.entity_kind = 'revision' AND NEW.planned_body_bytes > 16384
    THEN RAISE(ABORT, 'revision_body_exceeds_16kib') end;
  SELECT case WHEN NEW.actor_kind = 'account' AND NOT EXISTS (
    SELECT 1 FROM icono_authority_accounts account
     WHERE account.account_id = NEW.actor_account_id AND account.status = 'active'
  ) THEN RAISE(ABORT, 'upload_actor_is_not_active') end;
  SELECT case WHEN NEW.caretaker_assignment_id IS NOT NULL AND NEW.actor_kind = 'account' AND NOT EXISTS (
    SELECT 1 FROM icono_caretaker_assignments assignment
     WHERE assignment.caretaker_assignment_id = NEW.caretaker_assignment_id
       AND assignment.status = 'active'
       AND (NEW.actor_kind <> 'account' OR assignment.account_id = NEW.actor_account_id)
  ) THEN RAISE(ABORT, 'upload_assignment_is_not_active') end;
  SELECT case WHEN (
    SELECT body_admitted_bytes + body_reserved_bytes + NEW.planned_body_bytes
      FROM icono_authority_state WHERE singleton = 1
  ) > (
    SELECT body_admitted_limit_bytes FROM icono_authority_state WHERE singleton = 1
  ) THEN RAISE(ABORT, 'authoring_body_quota_exceeded') end;
  SELECT case WHEN NEW.caretaker_assignment_id IS NOT NULL AND (
    COALESCE((
      SELECT SUM(revision.body_bytes)
        FROM icono_manifestation_revisions revision
       WHERE revision.caretaker_assignment_id = NEW.caretaker_assignment_id
    ), 0)
    + COALESCE((
      SELECT SUM(derivative.body_bytes)
        FROM icono_manifestation_derivatives derivative
        JOIN icono_manifestation_revisions revision
          ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       WHERE revision.caretaker_assignment_id = NEW.caretaker_assignment_id
         AND derivative.body_bytes IS NOT NULL
    ), 0)
    + COALESCE((
      SELECT SUM(intent.planned_body_bytes)
        FROM icono_manifestation_upload_intents intent
       WHERE intent.caretaker_assignment_id = NEW.caretaker_assignment_id
         AND intent.status IN ('uploading', 'deleting')
    ), 0)
    + NEW.planned_body_bytes
  ) > 2097152 THEN RAISE(ABORT, 'caretaker_lineage_body_quota_exceeded') end;
  SELECT case WHEN NEW.entity_kind = 'revision'
    AND NEW.caretaker_assignment_id IS NOT NULL
    AND (
      (SELECT count(*) FROM icono_manifestation_revisions revision
        WHERE revision.caretaker_assignment_id = NEW.caretaker_assignment_id)
      + (SELECT count(*) FROM icono_manifestation_upload_intents intent
          WHERE intent.caretaker_assignment_id = NEW.caretaker_assignment_id
            AND intent.entity_kind = 'revision'
            AND intent.status IN ('uploading', 'deleting'))
    ) >= 256 THEN RAISE(ABORT, 'caretaker_lineage_revision_limit_exceeded') end;
  SELECT case WHEN NEW.entity_kind = 'derivative'
    AND NEW.caretaker_assignment_id IS NOT NULL
    AND (
      (SELECT count(*)
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
        WHERE revision.caretaker_assignment_id = NEW.caretaker_assignment_id)
      + (SELECT count(*) FROM icono_manifestation_upload_intents intent
          WHERE intent.caretaker_assignment_id = NEW.caretaker_assignment_id
            AND intent.entity_kind = 'derivative'
            AND intent.status IN ('uploading', 'deleting'))
    ) >= 512 THEN RAISE(ABORT, 'caretaker_lineage_derivative_limit_exceeded') end;
end;

CREATE TRIGGER icono_upload_intent_reserve
AFTER INSERT ON icono_manifestation_upload_intents
BEGIN
  UPDATE icono_authority_state
     SET body_reserved_bytes = body_reserved_bytes + NEW.planned_body_bytes,
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_upload_intent_release
AFTER UPDATE OF status ON icono_manifestation_upload_intents
WHEN OLD.status IN ('uploading', 'deleting') AND NEW.status IN ('adopted', 'deleted')
BEGIN
  UPDATE icono_authority_state
     SET body_reserved_bytes = MAX(0, body_reserved_bytes - OLD.planned_body_bytes),
         updated_at = CURRENT_TIMESTAMP
   WHERE singleton = 1;
end;

CREATE TRIGGER icono_revision_storage_adopts_upload_intent
AFTER INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  UPDATE icono_manifestation_upload_intents
     SET status = 'adopted', resolved_at = CURRENT_TIMESTAMP, last_error_code = NULL
   WHERE entity_kind = 'revision'
     AND entity_id = NEW.manifestation_revision_id
     AND object_key = NEW.object_key
     AND ciphertext_sha256 = NEW.ciphertext_sha256
     AND status = 'uploading'
     AND julianday(lease_expires_at) >= julianday(CURRENT_TIMESTAMP);
end;

CREATE TRIGGER icono_revision_storage_upload_intent_fence
BEFORE INSERT ON icono_manifestation_revision_storage_secrets
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_upload_intents intent
   WHERE intent.entity_kind = 'revision'
     AND intent.entity_id = NEW.manifestation_revision_id
)
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.entity_kind = 'revision'
       AND intent.entity_id = NEW.manifestation_revision_id
       AND intent.object_key = NEW.object_key
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'revision_upload_intent_is_not_adoptable') end;
end;

CREATE TRIGGER icono_derivative_storage_adopts_upload_intent
AFTER INSERT ON icono_manifestation_derivative_storage_secrets
BEGIN
  UPDATE icono_manifestation_upload_intents
     SET status = 'adopted', resolved_at = CURRENT_TIMESTAMP, last_error_code = NULL
   WHERE entity_kind = 'derivative'
     AND entity_id = NEW.manifestation_derivative_id
     AND object_key = NEW.object_key
     AND ciphertext_sha256 = NEW.ciphertext_sha256
     AND status = 'uploading'
     AND julianday(lease_expires_at) >= julianday(CURRENT_TIMESTAMP);
end;

CREATE TRIGGER icono_derivative_storage_upload_intent_fence
BEFORE INSERT ON icono_manifestation_derivative_storage_secrets
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_upload_intents intent
   WHERE intent.entity_kind = 'derivative'
     AND intent.entity_id = NEW.manifestation_derivative_id
)
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.entity_kind = 'derivative'
       AND intent.entity_id = NEW.manifestation_derivative_id
       AND intent.object_key = NEW.object_key
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'derivative_upload_intent_is_not_adoptable') end;
end;

CREATE TRIGGER icono_revision_storage_restore_adopts_upload_intent
AFTER UPDATE OF object_key, ciphertext_sha256 ON icono_manifestation_revision_storage_secrets
BEGIN
  UPDATE icono_manifestation_upload_intents
     SET status = 'adopted', resolved_at = CURRENT_TIMESTAMP, last_error_code = NULL
   WHERE entity_kind = 'revision'
     AND entity_id = NEW.manifestation_revision_id
     AND operation = 'restore'
     AND object_key = NEW.object_key
     AND ciphertext_sha256 = NEW.ciphertext_sha256
     AND status = 'uploading'
     AND julianday(lease_expires_at) >= julianday(CURRENT_TIMESTAMP);
end;

CREATE TRIGGER icono_revision_storage_restore_upload_intent_fence
BEFORE UPDATE OF object_key, ciphertext_sha256 ON icono_manifestation_revision_storage_secrets
WHEN NEW.object_key <> OLD.object_key
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.entity_kind = 'revision'
       AND intent.entity_id = NEW.manifestation_revision_id
       AND intent.operation = 'restore'
       AND intent.object_key = NEW.object_key
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'revision_restore_upload_intent_is_not_adoptable') end;
end;

CREATE TRIGGER icono_derivative_storage_restore_adopts_upload_intent
AFTER UPDATE OF object_key, ciphertext_sha256 ON icono_manifestation_derivative_storage_secrets
BEGIN
  UPDATE icono_manifestation_upload_intents
     SET status = 'adopted', resolved_at = CURRENT_TIMESTAMP, last_error_code = NULL
   WHERE entity_kind = 'derivative'
     AND entity_id = NEW.manifestation_derivative_id
     AND operation = 'restore'
     AND object_key = NEW.object_key
     AND ciphertext_sha256 = NEW.ciphertext_sha256
     AND status = 'uploading'
     AND julianday(lease_expires_at) >= julianday(CURRENT_TIMESTAMP);
end;

CREATE TRIGGER icono_derivative_storage_restore_upload_intent_fence
BEFORE UPDATE OF object_key, ciphertext_sha256 ON icono_manifestation_derivative_storage_secrets
WHEN NEW.object_key <> OLD.object_key
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.entity_kind = 'derivative'
       AND intent.entity_id = NEW.manifestation_derivative_id
       AND intent.operation = 'restore'
       AND intent.object_key = NEW.object_key
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'derivative_restore_upload_intent_is_not_adoptable') end;
end;

CREATE TABLE icono_manifestation_backup_capabilities (
  capability_sha256 TEXT PRIMARY KEY CHECK (
    length(capability_sha256) = 64 AND capability_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('administrator', 'service')),
  actor_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  expires_at TEXT NOT NULL,
  lease_id TEXT,
  leased_until TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((lease_id IS NULL) = (leased_until IS NULL))
);

CREATE INDEX idx_icono_backup_capabilities_expiry
  ON icono_manifestation_backup_capabilities (expires_at, used_at);

-- Storage secrets are immutable except for an exact restore or DEK rewrap.
-- A per-entity guard avoids the unsafe pattern of authorizing an update merely
-- because some unrelated command receipt is still uncommitted.
CREATE TABLE icono_manifestation_storage_mutation_guards (
  command_id TEXT NOT NULL REFERENCES icono_authoring_command_receipts(command_id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('restore', 'rewrap')),
  PRIMARY KEY (entity_kind, entity_id)
);

CREATE TABLE icono_manifestation_key_rotation_jobs (
  rotation_job_id TEXT PRIMARY KEY,
  from_key_version INTEGER NOT NULL CHECK (from_key_version >= 1),
  to_key_version INTEGER NOT NULL CHECK (to_key_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('running', 'verification', 'completed', 'failed')),
  after_entity_kind TEXT CHECK (after_entity_kind IN ('revision', 'derivative')),
  after_entity_id TEXT,
  rotated_revisions INTEGER NOT NULL DEFAULT 0 CHECK (rotated_revisions >= 0),
  rotated_derivatives INTEGER NOT NULL DEFAULT 0 CHECK (rotated_derivatives >= 0),
  last_error_code TEXT,
  created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('administrator', 'service')),
  created_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  CHECK (from_key_version <> to_key_version),
  CHECK ((after_entity_kind IS NULL) = (after_entity_id IS NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE icono_manifestation_key_rotation_items (
  rotation_job_id TEXT NOT NULL
    REFERENCES icono_manifestation_key_rotation_jobs(rotation_job_id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (rotation_job_id, entity_kind, entity_id)
);

CREATE TRIGGER icono_legal_hold_release_queues_preserved_objects
AFTER UPDATE OF released_at ON icono_manifestation_legal_holds
WHEN OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
BEGIN
  UPDATE icono_manifestation_object_purge_queue
     SET status = 'pending', next_attempt_at = NEW.released_at
   WHERE status = 'held' AND (
     entity_id IN (
       SELECT revision.manifestation_revision_id
         FROM icono_manifestation_revisions revision
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
     OR entity_id IN (
       SELECT derivative.manifestation_derivative_id
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
   );
end;

CREATE TRIGGER icono_legal_hold_place_blocks_active_purge
BEFORE INSERT ON icono_manifestation_legal_holds
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_object_purge_queue queue
   WHERE queue.status = 'processing' AND (
     queue.entity_id IN (
       SELECT revision.manifestation_revision_id
         FROM icono_manifestation_revisions revision
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
     OR queue.entity_id IN (
       SELECT derivative.manifestation_derivative_id
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
   )
)
BEGIN
  SELECT RAISE(ABORT, 'manifestation_purge_is_in_progress');
end;

CREATE TRIGGER icono_legal_hold_place_pauses_queued_objects
AFTER INSERT ON icono_manifestation_legal_holds
BEGIN
  UPDATE icono_manifestation_object_purge_queue SET status = 'held', next_attempt_at = NULL
   WHERE status IN ('pending', 'failed') AND (
     entity_id IN (
       SELECT revision.manifestation_revision_id
         FROM icono_manifestation_revisions revision
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
     OR entity_id IN (
       SELECT derivative.manifestation_derivative_id
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
        WHERE revision.manifestation_id = NEW.manifestation_id
     )
   );
end;

CREATE TRIGGER icono_revision_storage_restore_only
BEFORE UPDATE ON icono_manifestation_revision_storage_secrets
WHEN NOT EXISTS (
  SELECT 1 FROM icono_manifestation_storage_mutation_guards guard
   WHERE guard.entity_kind = 'revision'
     AND guard.entity_id = OLD.manifestation_revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'revision_storage_is_immutable_outside_restore');
end;

CREATE TRIGGER icono_derivative_storage_restore_only
BEFORE UPDATE ON icono_manifestation_derivative_storage_secrets
WHEN NOT EXISTS (
  SELECT 1 FROM icono_manifestation_storage_mutation_guards guard
   WHERE guard.entity_kind = 'derivative'
     AND guard.entity_id = OLD.manifestation_derivative_id
)
BEGIN
  SELECT RAISE(ABORT, 'derivative_storage_is_immutable_outside_restore');
end;

CREATE TRIGGER icono_storage_mutation_guard_delete_requires_matching_receipt
BEFORE DELETE ON icono_manifestation_storage_mutation_guards
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_authoring_command_receipts receipt
     WHERE receipt.command_id = OLD.command_id
       AND receipt.accepted_event_sequence IS NOT NULL
       AND (
         (OLD.operation = 'restore' AND receipt.command_type IN (
           'manifestation.backup_restore', 'manifestation.derivative_backup_restore'
         ))
         OR (OLD.operation = 'rewrap' AND receipt.command_type = 'manifestation.key_rewrap')
       )
  ) THEN RAISE(ABORT, 'storage_mutation_guard_receipt_mismatch') end;
end;

CREATE TRIGGER icono_snapshot_parts_immutable_update
BEFORE UPDATE ON icono_manifestation_snapshot_parts
BEGIN
  SELECT RAISE(ABORT, 'manifestation_snapshot_state_is_immutable');
end;

CREATE TRIGGER icono_snapshot_parts_immutable_delete
BEFORE DELETE ON icono_manifestation_snapshot_parts
WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_snapshot_leases lease
   WHERE lease.snapshot_id = OLD.snapshot_id AND lease.status IN ('building', 'open')
)
BEGIN
  SELECT RAISE(ABORT, 'open_manifestation_snapshot_cannot_be_deleted');
end;

CREATE TRIGGER icono_snapshot_parts_no_secrets
BEFORE INSERT ON icono_manifestation_snapshot_parts
BEGIN
  SELECT case WHEN EXISTS (
    SELECT 1 FROM json_tree(NEW.part_json)
     WHERE lower(COALESCE(key, '')) IN (
       'prose', 'body', 'text', 'content', 'object_key', 'ciphertext_sha256',
       'ciphertext_bytes', 'body_iv_base64', 'wrapped_dek_base64',
       'wrap_iv_base64', 'object_etag'
     )
  ) THEN RAISE(ABORT, 'snapshot_contains_prose_or_storage_secret') end;
end;

CREATE TRIGGER icono_gene_merge_validate
BEFORE UPDATE OF status, merged_into_gene_id ON icono_gene_identities
WHEN NEW.status = 'merged'
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_gene_identities target
     WHERE target.gene_id = NEW.merged_into_gene_id AND target.status = 'active'
  ) THEN RAISE(ABORT, 'gene_merge_target_is_not_active') end;
  SELECT case WHEN EXISTS (
    SELECT 1 FROM icono_caretaker_assignments assignment
     WHERE assignment.gene_id = NEW.gene_id
       AND assignment.status IN ('pending_acceptance', 'active', 'suspended')
  ) THEN RAISE(ABORT, 'gene_with_open_caretaker_cannot_merge') end;
end;

CREATE TRIGGER icono_derivative_head_create
AFTER INSERT ON icono_manifestation_revisions
BEGIN
  INSERT INTO icono_manifestation_derivative_heads (manifestation_revision_id)
  VALUES (NEW.manifestation_revision_id);
end;

CREATE TRIGGER icono_derivatives_immutable_provenance
BEFORE UPDATE OF manifestation_revision_id, derivative_kind, source_body_sha256,
  body_sha256, body_bytes, tags_sha256, tags_bytes, fields_sha256, fields_bytes,
  recipe_id, recipe_version, provider_id, model_id,
  tagger_config_sha256, failure_code,
  provenance_status, created_at, completed_at
ON icono_manifestation_derivatives
BEGIN
  SELECT RAISE(ABORT, 'manifestation_derivative_provenance_is_immutable');
end;

CREATE TRIGGER icono_derivative_head_validate
BEFORE UPDATE ON icono_manifestation_derivative_heads
BEGIN
  SELECT case WHEN NEW.derivative_head_version <> OLD.derivative_head_version + 1
  THEN RAISE(ABORT, 'stale_derivative_head_version') end;
  SELECT case WHEN NEW.accepted_derivative_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM icono_manifestation_derivatives derivative
      JOIN icono_manifestation_derivative_storage_secrets storage
        ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
     WHERE derivative.manifestation_derivative_id = NEW.accepted_derivative_id
       AND derivative.manifestation_revision_id = NEW.manifestation_revision_id
       AND derivative.status = 'complete'
       AND derivative.source_body_sha256 = (
         SELECT revision.body_sha256 FROM icono_manifestation_revisions revision
          WHERE revision.manifestation_revision_id = NEW.manifestation_revision_id
       )
  ) THEN RAISE(ABORT, 'derivative_head_is_not_eligible') end;
end;

DROP TRIGGER icono_events_validate_snapshot;

CREATE TRIGGER icono_events_validate_snapshot
BEFORE INSERT ON icono_manifestation_events
BEGIN
  SELECT case WHEN json_type(NEW.payload_json) <> 'object'
    OR json_type(NEW.payload_json, '$.schema_version') <> 'integer'
    OR json_type(NEW.payload_json, '$.cause') <> 'text'
    OR json_type(NEW.payload_json, '$.gene') <> 'object'
    OR json_type(NEW.payload_json, '$.gene.aliases') <> 'array'
    OR json_type(NEW.payload_json, '$.assignment') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.manifestation') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.canonical') <> 'object'
    OR json_type(NEW.payload_json, '$.changed_revision') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.changed_selection') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.changed_aliases') <> 'array'
    OR json_type(NEW.payload_json, '$.changed_derivative') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.derivative_head') NOT IN ('object', 'null')
    OR json_type(NEW.payload_json, '$.tombstones') <> 'array'
  THEN RAISE(ABORT, 'event_payload_is_not_complete_snapshot') end;
  SELECT case WHEN json_extract(NEW.payload_json, '$.gene.gene_id') IS NOT NEW.gene_id
    OR json_extract(NEW.payload_json, '$.canonical.gene_revision') IS NOT NEW.gene_revision
  THEN RAISE(ABORT, 'event_payload_head_mismatch') end;
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
