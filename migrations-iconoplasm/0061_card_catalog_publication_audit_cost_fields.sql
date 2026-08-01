-- ARCHITECTURE FENCE [IPD-010]
-- B-695: the dirty-shard audit must answer why work ran and what it cost.
-- These are bounded per-operation counters, not a replacement telemetry store.
ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN trigger_reason TEXT NOT NULL DEFAULT 'unspecified';

ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN shards_read INTEGER NOT NULL DEFAULT 0 CHECK (shards_read >= 0);

ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN shards_written INTEGER NOT NULL DEFAULT 0 CHECK (shards_written >= 0);

ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN kv_writes_reserved INTEGER NOT NULL DEFAULT 0 CHECK (kv_writes_reserved >= 0);

ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN kv_writes_used INTEGER NOT NULL DEFAULT 0 CHECK (kv_writes_used >= 0);

ALTER TABLE icono_card_catalog_publication_audit
  ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0);
