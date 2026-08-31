-- Caretaker supervotes are a separate authority from ordinary FIT votes.
-- The per-gene VoteCoordinator serializes commands; these D1 tables are the
-- durable projection, audit trail, and idempotency receipt surface used by
-- ranking/read models. A caretaker selection contributes exactly +10 without
-- rewriting ordinary vote rows or their score.

CREATE TABLE icono_caretaker_vote_assignment_projection (
  gene_symbol TEXT PRIMARY KEY COLLATE NOCASE,
  gene_id TEXT NOT NULL UNIQUE,
  caretaker_assignment_id TEXT NOT NULL UNIQUE,
  caretaker_account_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending_acceptance', 'active', 'suspended', 'ended')),
  assignment_version INTEGER NOT NULL CHECK (assignment_version >= 1),
  authority_event_id TEXT NOT NULL,
  authority_event_sequence INTEGER NOT NULL CHECK (authority_event_sequence >= 1),
  projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_icono_caretaker_assignment_projection_event
  ON icono_caretaker_vote_assignment_projection (authority_event_id);

CREATE INDEX idx_icono_caretaker_assignment_projection_account
  ON icono_caretaker_vote_assignment_projection (
    caretaker_account_id,
    status,
    gene_symbol
  );

CREATE TABLE icono_caretaker_supervote_projection (
  gene_symbol TEXT PRIMARY KEY COLLATE NOCASE,
  gene_id TEXT NOT NULL UNIQUE,
  caretaker_assignment_id TEXT NOT NULL,
  caretaker_account_id TEXT NOT NULL,
  asset_sha256 TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  weight INTEGER NOT NULL DEFAULT 10 CHECK (weight = 10),
  supervote_version INTEGER NOT NULL DEFAULT 0 CHECK (supervote_version >= 0),
  last_mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at TEXT,
  CHECK (
    (active = 1 AND asset_sha256 IS NOT NULL AND length(asset_sha256) = 64)
    OR (active = 0 AND asset_sha256 IS NULL)
  )
);

CREATE UNIQUE INDEX idx_icono_caretaker_supervote_projection_mutation
  ON icono_caretaker_supervote_projection (last_mutation_id);

CREATE INDEX idx_icono_caretaker_supervote_projection_asset
  ON icono_caretaker_supervote_projection (gene_symbol, asset_sha256)
  WHERE active = 1;

CREATE TABLE icono_caretaker_supervote_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'assignment_projected',
      'assignment_suspended',
      'assignment_resumed',
      'assignment_ended',
      'supervote_set',
      'supervote_moved',
      'supervote_confirmed',
      'supervote_cleared',
      'supervote_asset_invalidated'
    )),
  command_id TEXT,
  request_sha256 TEXT CHECK (request_sha256 IS NULL OR length(request_sha256) = 64),
  gene_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL COLLATE NOCASE,
  caretaker_assignment_id TEXT NOT NULL,
  caretaker_account_id TEXT NOT NULL,
  assignment_status TEXT NOT NULL,
  assignment_version INTEGER NOT NULL CHECK (assignment_version >= 1),
  from_asset_sha256 TEXT CHECK (
    from_asset_sha256 IS NULL OR length(from_asset_sha256) = 64
  ),
  to_asset_sha256 TEXT CHECK (
    to_asset_sha256 IS NULL OR length(to_asset_sha256) = 64
  ),
  supervote_version INTEGER NOT NULL CHECK (supervote_version >= 0),
  authority_event_id TEXT,
  authority_event_sequence INTEGER CHECK (
    authority_event_sequence IS NULL OR authority_event_sequence >= 1
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_icono_caretaker_supervote_events_gene
  ON icono_caretaker_supervote_events (gene_symbol, id DESC);

CREATE INDEX idx_icono_caretaker_supervote_events_assignment
  ON icono_caretaker_supervote_events (caretaker_assignment_id, id DESC);

CREATE TABLE icono_caretaker_supervote_command_receipts (
  command_id TEXT PRIMARY KEY,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  mutation_id TEXT,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  accepted_event_sequence INTEGER NOT NULL CHECK (accepted_event_sequence >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER icono_caretaker_supervote_receipt_request_immutable
BEFORE UPDATE ON icono_caretaker_supervote_command_receipts
WHEN NEW.request_sha256 IS NOT OLD.request_sha256
BEGIN
  SELECT RAISE(ABORT, 'caretaker_supervote_command_id_conflict');
end;

CREATE TRIGGER icono_caretaker_assignment_projection_no_rewind
BEFORE UPDATE ON icono_caretaker_vote_assignment_projection
BEGIN
  SELECT case
    WHEN NEW.gene_id IS NOT OLD.gene_id
      OR NEW.authority_event_sequence < OLD.authority_event_sequence
      OR (
        NEW.caretaker_assignment_id = OLD.caretaker_assignment_id
        AND NEW.assignment_version < OLD.assignment_version
      )
    THEN RAISE(ABORT, 'caretaker_assignment_projection_cannot_rewind')
  end;
end;

CREATE TRIGGER icono_caretaker_supervote_projection_no_rewind
BEFORE UPDATE ON icono_caretaker_supervote_projection
BEGIN
  SELECT case
    WHEN NEW.gene_id IS NOT OLD.gene_id
      OR NEW.supervote_version < OLD.supervote_version
    THEN RAISE(ABORT, 'caretaker_supervote_projection_cannot_rewind')
  end;
end;

CREATE TRIGGER icono_caretaker_supervote_projection_assignment_guard_insert
BEFORE INSERT ON icono_caretaker_supervote_projection
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1
      FROM icono_caretaker_vote_assignment_projection assignment
     WHERE assignment.gene_symbol = NEW.gene_symbol
       AND assignment.gene_id = NEW.gene_id
       AND assignment.caretaker_assignment_id = NEW.caretaker_assignment_id
       AND assignment.caretaker_account_id = NEW.caretaker_account_id
       AND (
         NEW.active = 0
         OR assignment.status IN ('active', 'suspended')
       )
  ) THEN RAISE(ABORT, 'caretaker_supervote_assignment_projection_mismatch') end;
end;

CREATE TRIGGER icono_caretaker_supervote_projection_assignment_guard_update
BEFORE UPDATE ON icono_caretaker_supervote_projection
BEGIN
  SELECT case WHEN NOT EXISTS (
    SELECT 1
      FROM icono_caretaker_vote_assignment_projection assignment
     WHERE assignment.gene_symbol = NEW.gene_symbol
       AND assignment.gene_id = NEW.gene_id
       AND assignment.caretaker_assignment_id = NEW.caretaker_assignment_id
       AND assignment.caretaker_account_id = NEW.caretaker_account_id
       AND (
         NEW.active = 0
         OR assignment.status IN ('active', 'suspended')
       )
  ) THEN RAISE(ABORT, 'caretaker_supervote_assignment_projection_mismatch') end;
end;
