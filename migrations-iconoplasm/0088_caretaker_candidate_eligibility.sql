-- Caretaker supervotes must be authorized by a positive, versioned candidate
-- projection inside the per-gene VoteCoordinator. This D1 ledger is the source
-- of that projection. Triggers cover every writer, including direct admin SQL,
-- so delete/reject/stale transitions cannot rely on a best-effort blocklist.

CREATE TABLE icono_caretaker_candidate_eligibility_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL COLLATE NOCASE,
  asset_sha256 TEXT NOT NULL CHECK (length(asset_sha256) = 64),
  eligibility_version INTEGER NOT NULL CHECK (eligibility_version >= 1),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  source_status TEXT NOT NULL,
  source_autopick_eligible INTEGER NOT NULL CHECK (source_autopick_eligible IN (0, 1)),
  source_is_stale INTEGER NOT NULL CHECK (source_is_stale IN (0, 1)),
  transition_type TEXT NOT NULL CHECK (transition_type IN ('seeded', 'inserted', 'updated', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (gene_symbol, asset_sha256, eligibility_version)
);

CREATE TABLE icono_caretaker_candidate_eligibility_projection (
  gene_symbol TEXT NOT NULL COLLATE NOCASE,
  asset_sha256 TEXT NOT NULL CHECK (length(asset_sha256) = 64),
  eligibility_version INTEGER NOT NULL CHECK (eligibility_version >= 1),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  source_status TEXT NOT NULL,
  source_autopick_eligible INTEGER NOT NULL CHECK (source_autopick_eligible IN (0, 1)),
  source_is_stale INTEGER NOT NULL CHECK (source_is_stale IN (0, 1)),
  source_event_sequence INTEGER NOT NULL UNIQUE CHECK (source_event_sequence >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gene_symbol, asset_sha256),
  FOREIGN KEY (source_event_sequence)
    REFERENCES icono_caretaker_candidate_eligibility_events(event_sequence)
);

CREATE INDEX idx_icono_caretaker_candidate_eligibility_active
  ON icono_caretaker_candidate_eligibility_projection (gene_symbol, eligible, asset_sha256);

INSERT INTO icono_caretaker_candidate_eligibility_events (
  gene_symbol, asset_sha256, eligibility_version, eligible,
  source_status, source_autopick_eligible, source_is_stale, transition_type
)
SELECT
  gene_symbol,
  asset_sha256,
  1,
  case
    WHEN lower(COALESCE(status, '')) <> 'rejected'
      AND COALESCE(autopick_eligible, 1) > 0
      AND COALESCE(is_stale, 0) = 0
    THEN 1 ELSE 0
  end,
  lower(COALESCE(status, '')),
  case WHEN COALESCE(autopick_eligible, 1) > 0 THEN 1 ELSE 0 end,
  case WHEN COALESCE(is_stale, 0) > 0 THEN 1 ELSE 0 end,
  'seeded'
FROM icono_portrait_assets
ORDER BY gene_symbol, asset_sha256;

INSERT INTO icono_caretaker_candidate_eligibility_projection (
  gene_symbol, asset_sha256, eligibility_version, eligible,
  source_status, source_autopick_eligible, source_is_stale,
  source_event_sequence
)
SELECT
  gene_symbol, asset_sha256, eligibility_version, eligible,
  source_status, source_autopick_eligible, source_is_stale,
  event_sequence
FROM icono_caretaker_candidate_eligibility_events;

CREATE TRIGGER icono_portrait_asset_caretaker_identity_immutable
BEFORE UPDATE OF gene_symbol, asset_sha256 ON icono_portrait_assets
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.asset_sha256 IS NOT NEW.asset_sha256
BEGIN
  SELECT RAISE(ABORT, 'portrait_asset_identity_is_immutable');
end;

CREATE TRIGGER icono_portrait_asset_caretaker_eligibility_insert
AFTER INSERT ON icono_portrait_assets
BEGIN
  INSERT INTO icono_caretaker_candidate_eligibility_events (
    gene_symbol, asset_sha256, eligibility_version, eligible,
    source_status, source_autopick_eligible, source_is_stale, transition_type
  ) VALUES (
    NEW.gene_symbol,
    NEW.asset_sha256,
    COALESCE((
      SELECT eligibility_version + 1
        FROM icono_caretaker_candidate_eligibility_projection
       WHERE gene_symbol = NEW.gene_symbol AND asset_sha256 = NEW.asset_sha256
    ), 1),
    case
      WHEN lower(COALESCE(NEW.status, '')) <> 'rejected'
        AND COALESCE(NEW.autopick_eligible, 1) > 0
        AND COALESCE(NEW.is_stale, 0) = 0
      THEN 1 ELSE 0
    end,
    lower(COALESCE(NEW.status, '')),
    case WHEN COALESCE(NEW.autopick_eligible, 1) > 0 THEN 1 ELSE 0 end,
    case WHEN COALESCE(NEW.is_stale, 0) > 0 THEN 1 ELSE 0 end,
    'inserted'
  );
  INSERT INTO icono_caretaker_candidate_eligibility_projection (
    gene_symbol, asset_sha256, eligibility_version, eligible,
    source_status, source_autopick_eligible, source_is_stale,
    source_event_sequence, updated_at
  )
  SELECT
    gene_symbol, asset_sha256, eligibility_version, eligible,
    source_status, source_autopick_eligible, source_is_stale,
    event_sequence, CURRENT_TIMESTAMP
  FROM icono_caretaker_candidate_eligibility_events
  WHERE event_sequence = last_insert_rowid()
  ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
    eligibility_version = excluded.eligibility_version,
    eligible = excluded.eligible,
    source_status = excluded.source_status,
    source_autopick_eligible = excluded.source_autopick_eligible,
    source_is_stale = excluded.source_is_stale,
    source_event_sequence = excluded.source_event_sequence,
    updated_at = CURRENT_TIMESTAMP;
end;

CREATE TRIGGER icono_portrait_asset_caretaker_eligibility_update
AFTER UPDATE OF status, autopick_eligible, is_stale ON icono_portrait_assets
BEGIN
  INSERT INTO icono_caretaker_candidate_eligibility_events (
    gene_symbol, asset_sha256, eligibility_version, eligible,
    source_status, source_autopick_eligible, source_is_stale, transition_type
  ) VALUES (
    NEW.gene_symbol,
    NEW.asset_sha256,
    (SELECT eligibility_version + 1
       FROM icono_caretaker_candidate_eligibility_projection
      WHERE gene_symbol = NEW.gene_symbol AND asset_sha256 = NEW.asset_sha256),
    case
      WHEN lower(COALESCE(NEW.status, '')) <> 'rejected'
        AND COALESCE(NEW.autopick_eligible, 1) > 0
        AND COALESCE(NEW.is_stale, 0) = 0
      THEN 1 ELSE 0
    end,
    lower(COALESCE(NEW.status, '')),
    case WHEN COALESCE(NEW.autopick_eligible, 1) > 0 THEN 1 ELSE 0 end,
    case WHEN COALESCE(NEW.is_stale, 0) > 0 THEN 1 ELSE 0 end,
    'updated'
  );
  UPDATE icono_caretaker_candidate_eligibility_projection
     SET eligibility_version = (
           SELECT eligibility_version
             FROM icono_caretaker_candidate_eligibility_events
            WHERE event_sequence = last_insert_rowid()
         ),
         eligible = (
           SELECT eligible
             FROM icono_caretaker_candidate_eligibility_events
            WHERE event_sequence = last_insert_rowid()
         ),
         source_status = lower(COALESCE(NEW.status, '')),
         source_autopick_eligible = case
           WHEN COALESCE(NEW.autopick_eligible, 1) > 0 THEN 1 ELSE 0
         end,
         source_is_stale = case WHEN COALESCE(NEW.is_stale, 0) > 0 THEN 1 ELSE 0 end,
         source_event_sequence = last_insert_rowid(),
         updated_at = CURRENT_TIMESTAMP
   WHERE gene_symbol = NEW.gene_symbol AND asset_sha256 = NEW.asset_sha256;
end;

CREATE TRIGGER icono_portrait_asset_caretaker_eligibility_delete
AFTER DELETE ON icono_portrait_assets
BEGIN
  INSERT INTO icono_caretaker_candidate_eligibility_events (
    gene_symbol, asset_sha256, eligibility_version, eligible,
    source_status, source_autopick_eligible, source_is_stale, transition_type
  ) VALUES (
    OLD.gene_symbol,
    OLD.asset_sha256,
    (SELECT eligibility_version + 1
       FROM icono_caretaker_candidate_eligibility_projection
      WHERE gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.asset_sha256),
    0,
    'deleted',
    0,
    0,
    'deleted'
  );
  UPDATE icono_caretaker_candidate_eligibility_projection
     SET eligibility_version = (
           SELECT eligibility_version
             FROM icono_caretaker_candidate_eligibility_events
            WHERE event_sequence = last_insert_rowid()
         ),
         eligible = 0,
         source_status = 'deleted',
         source_autopick_eligible = 0,
         source_is_stale = 0,
         source_event_sequence = last_insert_rowid(),
         updated_at = CURRENT_TIMESTAMP
   WHERE gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.asset_sha256;
end;
