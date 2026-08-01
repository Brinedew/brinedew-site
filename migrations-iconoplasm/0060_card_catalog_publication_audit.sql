-- ARCHITECTURE FENCE [IPD-010]
-- B-695: bounded, queryable operation records for gallery publication.
-- Routine rows describe dirty-shard work only; a whole-catalog rebuild is not a
-- publication outcome and cannot be hidden behind this ledger.
CREATE TABLE IF NOT EXISTS icono_card_catalog_publication_audit (
  operation_id TEXT PRIMARY KEY,
  publication_kind TEXT NOT NULL CHECK (publication_kind = 'dirty_shards'),
  baseline_version TEXT NOT NULL,
  target_version TEXT,
  after_event_at TEXT,
  through_event_at TEXT,
  after_event_id INTEGER CHECK (after_event_id IS NULL OR after_event_id >= 0),
  through_event_id INTEGER CHECK (through_event_id IS NULL OR through_event_id >= 0),
  dirty_symbol_count INTEGER NOT NULL DEFAULT 0 CHECK (dirty_symbol_count >= 0),
  dirty_shard_count INTEGER NOT NULL DEFAULT 0 CHECK (dirty_shard_count >= 0),
  prepared_shard_count INTEGER NOT NULL DEFAULT 0 CHECK (prepared_shard_count >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'preparing', 'completed', 'failed')),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_card_catalog_publication_audit_updated
  ON icono_card_catalog_publication_audit (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_publish_events_card_catalog_window
  ON icono_publish_events (action, id, gene_symbol);

-- This is an operational audit, not the historical event archive. Keep the
-- newest 512 operations so observability cannot become unbounded primary-D1
-- storage. Cloudflare logs retain the matching operation_id for longer analysis.
CREATE TRIGGER IF NOT EXISTS trg_icono_card_catalog_publication_audit_bound
AFTER INSERT ON icono_card_catalog_publication_audit
BEGIN
  DELETE FROM icono_card_catalog_publication_audit
   WHERE operation_id IN (
     SELECT operation_id
       FROM icono_card_catalog_publication_audit
      ORDER BY updated_at DESC, operation_id DESC
      LIMIT -1 OFFSET 512
   );
END;
