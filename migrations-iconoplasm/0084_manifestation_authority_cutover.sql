-- ARCHITECTURE FENCE [IPD-012]: the primary Iconoplasm database is a compact
-- read projection after caretaker-authority cutover. It never becomes a second
-- manifestation writer and never stores encrypted-object credentials.

CREATE TABLE icono_manifestation_projection_authority (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK (authority_epoch >= 1),
  mode TEXT NOT NULL DEFAULT 'legacy_write'
    CHECK (mode IN ('legacy_write', 'shadow_frozen', 'authoritative', 'recovery_read_only')),
  source_snapshot_sha256 TEXT CHECK (
    source_snapshot_sha256 IS NULL OR length(source_snapshot_sha256) = 64
  ),
  expected_gene_count INTEGER CHECK (expected_gene_count IS NULL OR expected_gene_count >= 0),
  plaintext_retired_at TEXT,
  changed_by_account_id TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO icono_manifestation_projection_authority (singleton)
VALUES (1);

CREATE TABLE icono_manifestation_canonical_projection (
  gene_id TEXT PRIMARY KEY,
  canonical_symbol TEXT NOT NULL UNIQUE COLLATE NOCASE,
  canonical_manifestation_id TEXT,
  canonical_revision_id TEXT,
  canonical_selection_id TEXT,
  canonical_body_sha256 TEXT CHECK (
    canonical_body_sha256 IS NULL OR length(canonical_body_sha256) = 64
  ),
  canonical_body_bytes INTEGER CHECK (
    canonical_body_bytes IS NULL OR canonical_body_bytes BETWEEN 1 AND 16384
  ),
  canonical_revision_lifecycle TEXT CHECK (
    canonical_revision_lifecycle IS NULL
    OR canonical_revision_lifecycle IN ('active', 'withdrawn', 'purged', 'quarantined')
  ),
  accepted_tags_derivative_id TEXT,
  accepted_tags_derivative_head_version INTEGER CHECK (
    accepted_tags_derivative_head_version IS NULL OR accepted_tags_derivative_head_version >= 1
  ),
  accepted_tags_status TEXT CHECK (
    accepted_tags_status IS NULL OR accepted_tags_status IN ('pending', 'complete', 'failed')
  ),
  accepted_tags_source_body_sha256 TEXT CHECK (
    accepted_tags_source_body_sha256 IS NULL OR length(accepted_tags_source_body_sha256) = 64
  ),
  accepted_tags_body_sha256 TEXT CHECK (
    accepted_tags_body_sha256 IS NULL OR length(accepted_tags_body_sha256) = 64
  ),
  accepted_tags_body_bytes INTEGER CHECK (
    accepted_tags_body_bytes IS NULL OR accepted_tags_body_bytes BETWEEN 4 AND 32768
  ),
  accepted_tags_text_sha256 TEXT CHECK (
    accepted_tags_text_sha256 IS NULL OR length(accepted_tags_text_sha256) = 64
  ),
  accepted_tags_text_bytes INTEGER CHECK (
    accepted_tags_text_bytes IS NULL OR accepted_tags_text_bytes BETWEEN 1 AND 32767
  ),
  accepted_tags_fields_sha256 TEXT CHECK (
    accepted_tags_fields_sha256 IS NULL OR length(accepted_tags_fields_sha256) = 64
  ),
  accepted_tags_fields_bytes INTEGER CHECK (
    accepted_tags_fields_bytes IS NULL OR accepted_tags_fields_bytes BETWEEN 2 AND 32766
  ),
  accepted_tags_recipe_id TEXT,
  accepted_tags_recipe_version TEXT,
  accepted_tags_provider_id TEXT,
  accepted_tags_model_id TEXT,
  accepted_tags_config_sha256 TEXT CHECK (
    accepted_tags_config_sha256 IS NULL OR length(accepted_tags_config_sha256) = 64
  ),
  accepted_tags_provenance_status TEXT CHECK (
    accepted_tags_provenance_status IS NULL
    OR accepted_tags_provenance_status IN ('generated', 'legacy_unknown')
  ),
  head_version INTEGER NOT NULL CHECK (head_version >= 0),
  gene_revision INTEGER NOT NULL CHECK (gene_revision >= 1),
  authority_event_id TEXT NOT NULL,
  authority_event_sequence INTEGER NOT NULL CHECK (authority_event_sequence >= 1),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 1),
  public_material_event_id TEXT NOT NULL,
  public_material_version INTEGER NOT NULL DEFAULT 1 CHECK (public_material_version >= 1),
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
  projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (canonical_manifestation_id IS NULL
      AND canonical_revision_id IS NULL
      AND canonical_selection_id IS NULL
      AND canonical_body_sha256 IS NULL
      AND canonical_body_bytes IS NULL
      AND canonical_revision_lifecycle IS NULL)
    OR
    (canonical_manifestation_id IS NOT NULL
      AND canonical_revision_id IS NOT NULL
      AND canonical_selection_id IS NOT NULL
      AND canonical_body_sha256 IS NOT NULL
      AND canonical_body_bytes IS NOT NULL
      AND canonical_revision_lifecycle IS NOT NULL)
  ),
  CHECK (
    (accepted_tags_derivative_id IS NULL
      AND accepted_tags_derivative_head_version IS NULL
      AND accepted_tags_status IS NULL
      AND accepted_tags_source_body_sha256 IS NULL
      AND accepted_tags_body_sha256 IS NULL
      AND accepted_tags_body_bytes IS NULL
      AND accepted_tags_text_sha256 IS NULL
      AND accepted_tags_text_bytes IS NULL
      AND accepted_tags_fields_sha256 IS NULL
      AND accepted_tags_fields_bytes IS NULL
      AND accepted_tags_recipe_id IS NULL
      AND accepted_tags_recipe_version IS NULL
      AND accepted_tags_provider_id IS NULL
      AND accepted_tags_model_id IS NULL
      AND accepted_tags_config_sha256 IS NULL
      AND accepted_tags_provenance_status IS NULL)
    OR
    (accepted_tags_derivative_id IS NOT NULL
      AND accepted_tags_derivative_head_version IS NOT NULL
      AND accepted_tags_status = 'complete'
      AND accepted_tags_source_body_sha256 IS NOT NULL
      AND accepted_tags_body_sha256 IS NOT NULL
      AND accepted_tags_body_bytes IS NOT NULL
      AND accepted_tags_text_sha256 IS NOT NULL
      AND accepted_tags_text_bytes IS NOT NULL
      AND accepted_tags_fields_sha256 IS NOT NULL
      AND accepted_tags_fields_bytes IS NOT NULL
      AND accepted_tags_provenance_status IS NOT NULL)
  ),
  CHECK (
    canonical_revision_id IS NOT NULL
    OR accepted_tags_derivative_id IS NULL
  ),
  CHECK (
    canonical_revision_id IS NULL
    OR head_version >= 1
  ),
  CHECK (
    accepted_tags_derivative_id IS NULL
    OR accepted_tags_source_body_sha256 = canonical_body_sha256
  ),
  CHECK (
    accepted_tags_derivative_id IS NULL
    OR accepted_tags_body_bytes = accepted_tags_text_bytes + 1 + accepted_tags_fields_bytes
  ),
  CHECK (
    accepted_tags_provenance_status IS NULL
    OR (accepted_tags_provenance_status = 'generated'
      AND accepted_tags_recipe_id IS NOT NULL
      AND accepted_tags_recipe_version IS NOT NULL
      AND accepted_tags_provider_id IS NOT NULL
      AND accepted_tags_model_id IS NOT NULL
      AND accepted_tags_config_sha256 IS NOT NULL)
    OR (accepted_tags_provenance_status = 'legacy_unknown'
      AND accepted_tags_recipe_id IS NULL
      AND accepted_tags_recipe_version IS NULL
      AND accepted_tags_provider_id IS NULL
      AND accepted_tags_model_id IS NULL
      AND accepted_tags_config_sha256 IS NULL)
  )
);

CREATE INDEX idx_icono_manifestation_projection_event
  ON icono_manifestation_canonical_projection (authority_event_sequence, gene_id);

CREATE UNIQUE INDEX uq_icono_manifestation_projection_event_sequence
  ON icono_manifestation_canonical_projection (authority_event_sequence);

-- Cross-table card publication is a durable outbox, not part of the authoring
-- transaction illusion. The exact authority event ID is the idempotency key;
-- a bounded primary worker drain atomically emits the ordinary publish event
-- and marks this wake delivered.
CREATE TABLE icono_manifestation_publication_wakes (
  authority_event_id TEXT PRIMARY KEY,
  authority_event_sequence INTEGER NOT NULL UNIQUE CHECK (authority_event_sequence >= 1),
  gene_id TEXT NOT NULL,
  canonical_symbol TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE INDEX idx_icono_manifestation_publication_wakes_pending
  ON icono_manifestation_publication_wakes (status, authority_event_sequence);

-- Plaintext retirement is a separate, resumable release step. The verified
-- backup artifact hash is required before any legacy body is cleared, and the
-- cursor keeps each D1 invocation bounded.
CREATE TABLE icono_manifestation_plaintext_retirement (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  cutover_run_id TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK (length(source_snapshot_sha256) = 64),
  backup_artifact_id TEXT NOT NULL CHECK (
    length(backup_artifact_id) BETWEEN 8 AND 128
    AND backup_artifact_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  backup_artifact_sha256 TEXT NOT NULL CHECK (length(backup_artifact_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('running', 'verified', 'failed')),
  scan_after_symbol TEXT,
  retired_rows INTEGER NOT NULL DEFAULT 0 CHECK (retired_rows >= 0),
  retired_bytes INTEGER NOT NULL DEFAULT 0 CHECK (retired_bytes >= 0),
  failure_code TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT
);

-- Authority ownership only moves forward. This database is a projection after
-- freeze; neither an old Worker nor an operator typo may turn the legacy writer
-- back on or lower its epoch. Recovery may explicitly resume authoritative mode
-- after repair, but it can never reopen legacy or shadow writes.
CREATE TRIGGER icono_projection_authority_no_rewind
BEFORE UPDATE OF authority_epoch, mode, source_snapshot_sha256, expected_gene_count
ON icono_manifestation_projection_authority
BEGIN
  SELECT case WHEN NEW.authority_epoch < OLD.authority_epoch
    THEN RAISE(ABORT, 'manifestation_authority_epoch_cannot_rewind') end;
  SELECT case WHEN OLD.mode <> 'legacy_write' AND NEW.mode = 'legacy_write'
    THEN RAISE(ABORT, 'legacy_manifestation_writer_is_retired') end;
  SELECT case WHEN OLD.mode IN ('authoritative', 'recovery_read_only')
      AND NEW.mode = 'shadow_frozen'
    THEN RAISE(ABORT, 'manifestation_authority_mode_cannot_rewind') end;
  SELECT case WHEN OLD.mode <> 'legacy_write' AND (
      NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
      OR NEW.expected_gene_count IS NOT OLD.expected_gene_count
    ) THEN RAISE(ABORT, 'manifestation_cutover_identity_is_immutable') end;
end;

-- Freeze is enforced in SQLite, not only in an HTTP handler, so an old Worker,
-- a workstation retry, or a concurrent tab cannot reopen the legacy writer.
CREATE TRIGGER icono_legacy_manifestation_insert_frozen
BEFORE INSERT ON icono_gene_essence
WHEN (SELECT mode FROM icono_manifestation_projection_authority WHERE singleton = 1)
       <> 'legacy_write'
 AND (
   COALESCE(NEW.manifestation, '') <> ''
   OR COALESCE(NEW.manifestation_tags, '') <> ''
   OR COALESCE(NEW.manifestation_fields_json, '') <> ''
 )
BEGIN
  SELECT RAISE(ABORT, 'legacy_manifestation_writer_is_retired');
end;

CREATE TRIGGER icono_legacy_manifestation_update_frozen
BEFORE UPDATE OF manifestation, manifestation_tags, manifestation_fields_json
ON icono_gene_essence
WHEN (SELECT mode FROM icono_manifestation_projection_authority WHERE singleton = 1)
       <> 'legacy_write'
 AND (
   NEW.manifestation IS NOT OLD.manifestation
   OR NEW.manifestation_tags IS NOT OLD.manifestation_tags
   OR NEW.manifestation_fields_json IS NOT OLD.manifestation_fields_json
 )
 AND NOT (
   (SELECT mode FROM icono_manifestation_projection_authority WHERE singleton = 1)
     IN ('authoritative', 'recovery_read_only')
   AND COALESCE(NEW.manifestation, '') = ''
   AND COALESCE(NEW.manifestation_tags, '') = ''
   AND COALESCE(NEW.manifestation_fields_json, '') = ''
 )
BEGIN
  SELECT RAISE(ABORT, 'legacy_manifestation_writer_is_retired');
end;

CREATE TRIGGER icono_projection_epoch_guard_insert
BEFORE INSERT ON icono_manifestation_canonical_projection
BEGIN
  SELECT case WHEN NEW.authority_epoch <> (
    SELECT authority_epoch
      FROM icono_manifestation_projection_authority
     WHERE singleton = 1
  ) THEN RAISE(ABORT, 'manifestation_projection_epoch_mismatch') end;
end;

CREATE TRIGGER icono_projection_epoch_guard_update
BEFORE UPDATE ON icono_manifestation_canonical_projection
BEGIN
  SELECT case WHEN NEW.authority_epoch <> (
    SELECT authority_epoch
      FROM icono_manifestation_projection_authority
     WHERE singleton = 1
  ) OR NEW.gene_id IS NOT OLD.gene_id
  THEN RAISE(ABORT, 'manifestation_projection_epoch_or_identity_mismatch') end;
  SELECT case WHEN NEW.authority_event_sequence < OLD.authority_event_sequence
    OR NEW.gene_revision < OLD.gene_revision
    OR NEW.head_version < OLD.head_version
  THEN RAISE(ABORT, 'manifestation_projection_cannot_rewind') end;
  SELECT case WHEN NEW.authority_event_sequence = OLD.authority_event_sequence AND (
    NEW.canonical_symbol IS NOT OLD.canonical_symbol
    OR NEW.canonical_manifestation_id IS NOT OLD.canonical_manifestation_id
    OR NEW.canonical_revision_id IS NOT OLD.canonical_revision_id
    OR NEW.canonical_selection_id IS NOT OLD.canonical_selection_id
    OR NEW.canonical_body_sha256 IS NOT OLD.canonical_body_sha256
    OR NEW.canonical_body_bytes IS NOT OLD.canonical_body_bytes
    OR NEW.canonical_revision_lifecycle IS NOT OLD.canonical_revision_lifecycle
    OR NEW.accepted_tags_derivative_id IS NOT OLD.accepted_tags_derivative_id
    OR NEW.accepted_tags_derivative_head_version IS NOT OLD.accepted_tags_derivative_head_version
    OR NEW.accepted_tags_status IS NOT OLD.accepted_tags_status
    OR NEW.accepted_tags_source_body_sha256 IS NOT OLD.accepted_tags_source_body_sha256
    OR NEW.accepted_tags_body_sha256 IS NOT OLD.accepted_tags_body_sha256
    OR NEW.accepted_tags_body_bytes IS NOT OLD.accepted_tags_body_bytes
    OR NEW.accepted_tags_text_sha256 IS NOT OLD.accepted_tags_text_sha256
    OR NEW.accepted_tags_text_bytes IS NOT OLD.accepted_tags_text_bytes
    OR NEW.accepted_tags_fields_sha256 IS NOT OLD.accepted_tags_fields_sha256
    OR NEW.accepted_tags_fields_bytes IS NOT OLD.accepted_tags_fields_bytes
    OR NEW.accepted_tags_recipe_id IS NOT OLD.accepted_tags_recipe_id
    OR NEW.accepted_tags_recipe_version IS NOT OLD.accepted_tags_recipe_version
    OR NEW.accepted_tags_provider_id IS NOT OLD.accepted_tags_provider_id
    OR NEW.accepted_tags_model_id IS NOT OLD.accepted_tags_model_id
    OR NEW.accepted_tags_config_sha256 IS NOT OLD.accepted_tags_config_sha256
    OR NEW.accepted_tags_provenance_status IS NOT OLD.accepted_tags_provenance_status
    OR NEW.head_version IS NOT OLD.head_version
    OR NEW.gene_revision IS NOT OLD.gene_revision
    OR NEW.authority_event_id IS NOT OLD.authority_event_id
    OR NEW.authority_epoch IS NOT OLD.authority_epoch
  ) THEN RAISE(ABORT, 'manifestation_projection_event_replay_changed_payload') end;
end;
