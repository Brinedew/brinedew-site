-- Durable automatic mystery-target replacements must not contend with the
-- Cloudflare KV daily write quota used by unrelated application state.
CREATE TABLE IF NOT EXISTS daily_target_availability_pins (
  date TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  salt TEXT NOT NULL,
  selection_pool_fingerprint TEXT NOT NULL,
  original_uniprot_id TEXT NOT NULL,
  uniprot_id TEXT NOT NULL,
  rejected_uniprot_ids_json TEXT NOT NULL DEFAULT '[]',
  forbidden_uniprot_ids_json TEXT NOT NULL DEFAULT '[]',
  forbidden_gene_surnames_json TEXT NOT NULL DEFAULT '[]',
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_target_availability_pins_selector
  ON daily_target_availability_pins (salt, selection_pool_fingerprint, date);
