-- Permanently invalid exact-generation requests must leave the open queue without
-- being erased. The request row becomes cancelled for existing user/admin read
-- models, while this append-only record preserves the authority failure that made
-- GPU execution impossible.

CREATE TABLE IF NOT EXISTS icono_generation_request_quarantine (
  request_row_id INTEGER PRIMARY KEY
    REFERENCES icono_generation_requests(id) ON DELETE RESTRICT,
  generation_request_id TEXT NOT NULL UNIQUE
    CHECK (length(trim(generation_request_id)) BETWEEN 8 AND 180),
  source_manifestation_revision_id TEXT,
  source_snapshot_sha256 TEXT,
  failure_code TEXT NOT NULL
    CHECK (length(trim(failure_code)) BETWEEN 1 AND 96),
  failure_message TEXT NOT NULL
    CHECK (length(trim(failure_message)) BETWEEN 1 AND 500),
  quarantined_at TEXT NOT NULL,
  CHECK (
    (source_manifestation_revision_id IS NULL AND source_snapshot_sha256 IS NULL)
    OR (
      length(trim(source_manifestation_revision_id)) BETWEEN 8 AND 180
      AND length(source_snapshot_sha256) = 64
      AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_quarantine_time
  ON icono_generation_request_quarantine (quarantined_at DESC, request_row_id DESC);

CREATE TRIGGER IF NOT EXISTS trg_icono_generation_request_quarantine_immutable_update
BEFORE UPDATE ON icono_generation_request_quarantine
BEGIN
  SELECT RAISE(ABORT, 'generation_request_quarantine_is_immutable');
end;

CREATE TRIGGER IF NOT EXISTS trg_icono_generation_request_quarantine_immutable_delete
BEFORE DELETE ON icono_generation_request_quarantine
BEGIN
  SELECT RAISE(ABORT, 'generation_request_quarantine_is_immutable');
end;
