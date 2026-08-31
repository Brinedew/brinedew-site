-- ARCHITECTURE FENCE [IPD-012]: resumable system-seed import state contains
-- hashes and opaque identities only. Legacy plaintext is read from the frozen
-- source row for one bounded operation and is never copied into this database.

CREATE TABLE icono_manifestation_cutover_runs (
  cutover_run_id TEXT PRIMARY KEY,
  source_snapshot_id TEXT NOT NULL UNIQUE,
  source_snapshot_sha256 TEXT CHECK (
    source_snapshot_sha256 IS NULL OR length(source_snapshot_sha256) = 64
  ),
  source_gene_count INTEGER CHECK (source_gene_count IS NULL OR source_gene_count >= 0),
  source_manifestation_count INTEGER CHECK (
    source_manifestation_count IS NULL OR source_manifestation_count >= 0
  ),
  source_manifestation_bytes INTEGER CHECK (
    source_manifestation_bytes IS NULL OR source_manifestation_bytes >= 0
  ),
  target_authority_epoch INTEGER NOT NULL CHECK (target_authority_epoch >= 2),
  plan_chain_sha256 TEXT NOT NULL CHECK (length(plan_chain_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN (
      'planning', 'ready', 'importing', 'seeded', 'shadow_verified',
      'authoritative', 'recovery_read_only', 'failed'
    )),
  scan_after_symbol TEXT,
  planned_items INTEGER NOT NULL DEFAULT 0 CHECK (planned_items >= 0),
  adopted_items INTEGER NOT NULL DEFAULT 0 CHECK (adopted_items >= 0),
  verified_items INTEGER NOT NULL DEFAULT 0 CHECK (verified_items >= 0),
  failure_code TEXT,
  failure_message TEXT,
  created_by_actor_kind TEXT NOT NULL DEFAULT 'administrator'
    CHECK (created_by_actor_kind IN ('administrator', 'service', 'migration')),
  created_by_account_id TEXT REFERENCES icono_authority_accounts(account_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  CHECK (
    (created_by_actor_kind = 'administrator' AND created_by_account_id IS NOT NULL)
    OR (created_by_actor_kind IN ('service', 'migration') AND created_by_account_id IS NULL)
  )
);

CREATE TABLE icono_manifestation_cutover_items (
  cutover_run_id TEXT NOT NULL REFERENCES icono_manifestation_cutover_runs(cutover_run_id),
  canonical_symbol TEXT NOT NULL COLLATE NOCASE,
  gene_id TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manifestation', 'no_manifestation')),
  seed_manifestation_id TEXT UNIQUE,
  seed_revision_id TEXT UNIQUE,
  seed_selection_id TEXT UNIQUE,
  seed_command_id TEXT UNIQUE,
  seed_tags_derivative_id TEXT UNIQUE,
  seed_tags_command_id TEXT UNIQUE,
  seed_tags_selection_command_id TEXT UNIQUE,
  source_updated_at TEXT,
  source_body_sha256 TEXT CHECK (source_body_sha256 IS NULL OR length(source_body_sha256) = 64),
  source_body_bytes INTEGER CHECK (source_body_bytes IS NULL OR source_body_bytes BETWEEN 1 AND 16384),
  source_tags_sha256 TEXT CHECK (source_tags_sha256 IS NULL OR length(source_tags_sha256) = 64),
  source_tags_bytes INTEGER CHECK (source_tags_bytes IS NULL OR source_tags_bytes >= 1),
  source_fields_sha256 TEXT CHECK (source_fields_sha256 IS NULL OR length(source_fields_sha256) = 64),
  source_fields_bytes INTEGER CHECK (source_fields_bytes IS NULL OR source_fields_bytes >= 2),
  source_sample_label TEXT,
  source_sample_number INTEGER CHECK (source_sample_number IS NULL OR source_sample_number >= 0),
  source_sample_text_sha256 TEXT CHECK (
    source_sample_text_sha256 IS NULL OR length(source_sample_text_sha256) = 64
  ),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'uploading', 'adopted', 'registered_unseeded',
      'projected', 'verified', 'failed'
    )),
  authority_event_sequence INTEGER CHECK (
    authority_event_sequence IS NULL OR authority_event_sequence >= 1
  ),
  public_material_proof_sha256 TEXT CHECK (
    public_material_proof_sha256 IS NULL OR length(public_material_proof_sha256) = 64
  ),
  public_material_event_sequence INTEGER CHECK (
    public_material_event_sequence IS NULL OR public_material_event_sequence >= 1
  ),
  public_material_verified_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  adopted_at TEXT,
  projected_at TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (source_kind = 'manifestation'
      AND seed_manifestation_id IS NOT NULL
      AND seed_revision_id IS NOT NULL
      AND seed_selection_id IS NOT NULL
      AND seed_command_id IS NOT NULL
      AND source_body_sha256 IS NOT NULL
      AND source_body_bytes IS NOT NULL
      AND ((source_tags_sha256 IS NULL
        AND source_tags_bytes IS NULL
        AND source_fields_sha256 IS NULL
        AND source_fields_bytes IS NULL
        AND seed_tags_derivative_id IS NULL
        AND seed_tags_command_id IS NULL
        AND seed_tags_selection_command_id IS NULL)
      OR (source_tags_sha256 IS NOT NULL
        AND source_tags_bytes IS NOT NULL
        AND source_fields_sha256 IS NOT NULL
        AND source_fields_bytes IS NOT NULL
        AND seed_tags_derivative_id IS NOT NULL
        AND seed_tags_command_id IS NOT NULL
        AND seed_tags_selection_command_id IS NOT NULL)))
    OR
    (source_kind = 'no_manifestation'
      AND seed_manifestation_id IS NULL
      AND seed_revision_id IS NULL
      AND seed_selection_id IS NULL
      AND seed_command_id IS NOT NULL
      AND seed_tags_derivative_id IS NULL
      AND seed_tags_command_id IS NULL
      AND seed_tags_selection_command_id IS NULL
      AND source_body_sha256 IS NULL
      AND source_body_bytes IS NULL
      AND source_tags_sha256 IS NULL
      AND source_tags_bytes IS NULL
      AND source_fields_sha256 IS NULL
      AND source_fields_bytes IS NULL)
  ),
  CHECK (
    (status = 'verified' AND public_material_proof_sha256 IS NOT NULL
      AND public_material_event_sequence IS NOT NULL
      AND public_material_verified_at IS NOT NULL)
    OR status <> 'verified'
  ),
  PRIMARY KEY (cutover_run_id, canonical_symbol)
);

CREATE INDEX idx_icono_cutover_items_due
  ON icono_manifestation_cutover_items (
    cutover_run_id, status, next_attempt_at, canonical_symbol
  );

-- A cutover backup is an actual, server-built multipart artifact in a distinct
-- private backup storage zone. The verified root digest, never a caller claim,
-- is the only identity accepted by the plaintext-retirement gate.
CREATE TABLE icono_manifestation_cutover_backup_artifacts (
  backup_artifact_id TEXT PRIMARY KEY,
  cutover_run_id TEXT NOT NULL UNIQUE
    REFERENCES icono_manifestation_cutover_runs(cutover_run_id),
  source_snapshot_sha256 TEXT NOT NULL CHECK (length(source_snapshot_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN (
    'building', 'verified', 'retention_pending', 'deleting',
    'delete_failed', 'held', 'deleted', 'failed'
  )),
  expected_entries INTEGER NOT NULL CHECK (expected_entries >= 0),
  verified_entries INTEGER NOT NULL DEFAULT 0 CHECK (verified_entries >= 0),
  package_bytes INTEGER NOT NULL DEFAULT 0 CHECK (package_bytes >= 0),
  part_count INTEGER NOT NULL DEFAULT 0 CHECK (part_count >= 0),
  inventory_chain_sha256 TEXT CHECK (
    inventory_chain_sha256 IS NULL OR length(inventory_chain_sha256) = 64
  ),
  root_object_key TEXT UNIQUE,
  root_sha256 TEXT CHECK (root_sha256 IS NULL OR length(root_sha256) = 64),
  root_bytes INTEGER CHECK (root_bytes IS NULL OR root_bytes BETWEEN 17 AND 65536),
  failure_code TEXT,
  retention_expires_at TEXT,
  deletion_started_at TEXT,
  deletion_attempts INTEGER NOT NULL DEFAULT 0 CHECK (deletion_attempts >= 0),
  deletion_next_attempt_at TEXT,
  deletion_last_error_code TEXT,
  deleted_object_count INTEGER CHECK (deleted_object_count IS NULL OR deleted_object_count >= 0),
  deletion_receipt_sha256 TEXT CHECK (
    deletion_receipt_sha256 IS NULL OR length(deletion_receipt_sha256) = 64
  ),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  CHECK (verified_entries <= expected_entries),
  CHECK (
    (status IN ('verified', 'retention_pending', 'deleting', 'delete_failed', 'held')
      AND verified_entries = expected_entries
      AND inventory_chain_sha256 IS NOT NULL AND root_object_key IS NOT NULL
      AND root_sha256 IS NOT NULL AND root_bytes IS NOT NULL AND verified_at IS NOT NULL)
    OR (status = 'deleted' AND verified_entries = expected_entries
      AND inventory_chain_sha256 IS NOT NULL AND root_object_key IS NULL
      AND root_sha256 IS NOT NULL AND root_bytes IS NOT NULL
      AND verified_at IS NOT NULL AND deleted_at IS NOT NULL
      AND deleted_object_count IS NOT NULL AND deletion_receipt_sha256 IS NOT NULL)
    OR status IN ('building', 'failed')
  )
);

CREATE TABLE icono_manifestation_cutover_backup_entries (
  backup_artifact_id TEXT NOT NULL
    REFERENCES icono_manifestation_cutover_backup_artifacts(backup_artifact_id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('revision', 'derivative')),
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'verified', 'failed')),
  package_object_key TEXT NOT NULL UNIQUE,
  package_sha256 TEXT CHECK (package_sha256 IS NULL OR length(package_sha256) = 64),
  package_bytes INTEGER CHECK (package_bytes IS NULL OR package_bytes BETWEEN 17 AND 65536),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  body_bytes INTEGER NOT NULL CHECK (body_bytes BETWEEN 1 AND 32768),
  ciphertext_sha256 TEXT NOT NULL CHECK (length(ciphertext_sha256) = 64),
  ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes BETWEEN 17 AND 65536),
  part_number INTEGER CHECK (part_number IS NULL OR part_number >= 1),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  PRIMARY KEY (backup_artifact_id, entity_kind, entity_id),
  CHECK (
    (status = 'verified' AND package_sha256 IS NOT NULL AND package_bytes IS NOT NULL
      AND verified_at IS NOT NULL)
    OR status <> 'verified'
  )
);

CREATE INDEX idx_icono_cutover_backup_entries_pending
  ON icono_manifestation_cutover_backup_entries (backup_artifact_id, status, part_number, entity_kind, entity_id);

CREATE TABLE icono_manifestation_cutover_backup_parts (
  backup_artifact_id TEXT NOT NULL
    REFERENCES icono_manifestation_cutover_backup_artifacts(backup_artifact_id),
  part_number INTEGER NOT NULL CHECK (part_number >= 1),
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 1 AND 250),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'verified')),
  part_object_key TEXT NOT NULL UNIQUE,
  part_sha256 TEXT CHECK (part_sha256 IS NULL OR length(part_sha256) = 64),
  part_bytes INTEGER CHECK (part_bytes IS NULL OR part_bytes BETWEEN 17 AND 65536),
  chain_sha256 TEXT CHECK (chain_sha256 IS NULL OR length(chain_sha256) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (backup_artifact_id, part_number),
  CHECK (
    (status = 'verified' AND part_sha256 IS NOT NULL AND part_bytes IS NOT NULL
      AND chain_sha256 IS NOT NULL)
    OR (status = 'uploading' AND part_sha256 IS NULL AND part_bytes IS NULL
      AND chain_sha256 IS NULL)
  )
);

CREATE TABLE icono_manifestation_cutover_backup_deletions (
  backup_artifact_id TEXT NOT NULL
    REFERENCES icono_manifestation_cutover_backup_artifacts(backup_artifact_id),
  object_kind TEXT NOT NULL CHECK (object_kind IN ('package', 'inventory_part', 'root')),
  object_identity TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'deleted', 'failed', 'held')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (backup_artifact_id, object_kind, object_identity),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE INDEX idx_icono_cutover_backup_deletions_due
  ON icono_manifestation_cutover_backup_deletions (
    backup_artifact_id, status, next_attempt_at, object_kind, object_identity
  );

CREATE TRIGGER icono_cutover_backup_verified_terminal
BEFORE UPDATE ON icono_manifestation_cutover_backup_artifacts
WHEN OLD.status IN (
  'verified', 'retention_pending', 'deleting', 'delete_failed', 'held', 'deleted'
) AND (
  NEW.backup_artifact_id IS NOT OLD.backup_artifact_id
  OR NEW.cutover_run_id IS NOT OLD.cutover_run_id
  OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.expected_entries IS NOT OLD.expected_entries
  OR NEW.verified_entries IS NOT OLD.verified_entries
  OR NEW.package_bytes IS NOT OLD.package_bytes
  OR NEW.part_count IS NOT OLD.part_count
  OR NEW.inventory_chain_sha256 IS NOT OLD.inventory_chain_sha256
  OR NEW.root_sha256 IS NOT OLD.root_sha256
  OR NEW.root_bytes IS NOT OLD.root_bytes
  OR NEW.verified_at IS NOT OLD.verified_at
  OR (OLD.status = 'deleted' AND (
    NEW.deleted_object_count IS NOT OLD.deleted_object_count
    OR NEW.deletion_receipt_sha256 IS NOT OLD.deletion_receipt_sha256
    OR NEW.deleted_at IS NOT OLD.deleted_at
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'verified_cutover_backup_identity_is_immutable');
end;

CREATE TRIGGER icono_cutover_backup_entry_verified_terminal
BEFORE UPDATE ON icono_manifestation_cutover_backup_entries
WHEN OLD.status = 'verified' AND (
  NEW.entity_kind IS NOT OLD.entity_kind OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.package_object_key IS NOT OLD.package_object_key
  OR NEW.package_sha256 IS NOT OLD.package_sha256
  OR NEW.package_bytes IS NOT OLD.package_bytes
  OR NEW.body_sha256 IS NOT OLD.body_sha256 OR NEW.body_bytes IS NOT OLD.body_bytes
  OR NEW.ciphertext_sha256 IS NOT OLD.ciphertext_sha256
  OR NEW.ciphertext_bytes IS NOT OLD.ciphertext_bytes
)
BEGIN
  SELECT RAISE(ABORT, 'verified_cutover_backup_entry_is_immutable');
end;

CREATE TRIGGER icono_cutover_item_source_immutable
BEFORE UPDATE OF canonical_symbol, gene_id, source_kind, seed_manifestation_id,
  seed_revision_id, seed_selection_id, seed_command_id,
  seed_tags_derivative_id, seed_tags_command_id, seed_tags_selection_command_id,
  source_updated_at,
  source_body_sha256, source_body_bytes, source_tags_sha256, source_tags_bytes,
  source_fields_sha256, source_fields_bytes,
  source_sample_label, source_sample_number, source_sample_text_sha256
ON icono_manifestation_cutover_items
BEGIN
  SELECT RAISE(ABORT, 'cutover_source_plan_is_immutable');
end;

CREATE TRIGGER icono_cutover_item_public_proof_immutable
BEFORE UPDATE OF authority_event_sequence, public_material_proof_sha256,
  public_material_event_sequence, public_material_verified_at, verified_at
ON icono_manifestation_cutover_items
WHEN OLD.status = 'verified' AND (
  NEW.authority_event_sequence IS NOT OLD.authority_event_sequence
  OR NEW.public_material_proof_sha256 IS NOT OLD.public_material_proof_sha256
  OR NEW.public_material_event_sequence IS NOT OLD.public_material_event_sequence
  OR NEW.public_material_verified_at IS NOT OLD.public_material_verified_at
  OR NEW.verified_at IS NOT OLD.verified_at
)
BEGIN
  SELECT RAISE(ABORT, 'verified_cutover_public_material_proof_is_immutable');
end;

CREATE TRIGGER icono_cutover_item_no_rewind
BEFORE UPDATE OF status ON icono_manifestation_cutover_items
BEGIN
  SELECT case
    WHEN OLD.status = 'planned' AND NEW.status IN ('uploading', 'adopted', 'failed') THEN NULL
    WHEN OLD.status = 'planned' AND NEW.status IN ('registered_unseeded', 'failed') THEN NULL
    WHEN OLD.status = 'uploading' AND NEW.status IN ('uploading', 'adopted', 'failed') THEN NULL
    WHEN OLD.status = 'adopted' AND NEW.status IN ('projected', 'failed') THEN NULL
    WHEN OLD.status = 'registered_unseeded' AND NEW.status IN ('projected', 'failed') THEN NULL
    WHEN OLD.status = 'projected' AND NEW.status IN ('verified', 'failed') THEN NULL
    WHEN OLD.status = 'verified' AND NEW.status = 'verified' THEN NULL
    WHEN OLD.status = 'failed' AND NEW.status IN ('planned', 'failed') THEN NULL
    ELSE RAISE(ABORT, 'cutover_item_status_cannot_rewind')
  end;
end;
