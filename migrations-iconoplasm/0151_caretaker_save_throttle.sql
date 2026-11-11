-- B-1190: one row per account: when it last saved caretaker text. The save
-- cooldown (workers/iconoplasm/caretaker/caretaker-save-cooldown.js) reserves
-- the next slot with one conditional upsert, so two racing saves cannot both
-- pass. One row per account keeps the table bounded however many saves land.
CREATE TABLE IF NOT EXISTS icono_caretaker_save_throttle (
  account_id TEXT PRIMARY KEY,
  last_save_at TEXT NOT NULL
);
