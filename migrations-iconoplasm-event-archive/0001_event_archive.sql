-- B-799: immutable, read-only replica history. The authoring database remains
-- the only command writer. Load and verify the fixed prefix before inserting
-- the manifest row; that row seals the archive against further inserts.
CREATE TABLE IF NOT EXISTS icono_manifestation_events (
  event_sequence INTEGER PRIMARY KEY,
  event_uuid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  gene_id TEXT NOT NULL,
  gene_revision INTEGER NOT NULL,
  manifestation_id TEXT,
  manifestation_revision_id TEXT,
  canonical_selection_id TEXT,
  caretaker_assignment_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS icono_event_archive_manifest (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  authority_epoch INTEGER NOT NULL,
  through_sequence INTEGER NOT NULL CHECK (through_sequence > 0),
  event_count INTEGER NOT NULL CHECK (event_count > 0),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64)
);

CREATE TRIGGER IF NOT EXISTS icono_event_archive_no_update
BEFORE UPDATE ON icono_manifestation_events
BEGIN
  SELECT RAISE(ABORT, 'event_archive_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS icono_event_archive_no_delete
BEFORE DELETE ON icono_manifestation_events
BEGIN
  SELECT RAISE(ABORT, 'event_archive_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS icono_event_archive_no_insert_after_seal
BEFORE INSERT ON icono_manifestation_events
WHEN EXISTS (SELECT 1 FROM icono_event_archive_manifest WHERE singleton = 1)
BEGIN
  SELECT RAISE(ABORT, 'event_archive_is_sealed');
END;

CREATE TRIGGER IF NOT EXISTS icono_event_archive_manifest_immutable_update
BEFORE UPDATE ON icono_event_archive_manifest
BEGIN
  SELECT RAISE(ABORT, 'event_archive_manifest_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS icono_event_archive_manifest_immutable_delete
BEFORE DELETE ON icono_event_archive_manifest
BEGIN
  SELECT RAISE(ABORT, 'event_archive_manifest_is_immutable');
END;
