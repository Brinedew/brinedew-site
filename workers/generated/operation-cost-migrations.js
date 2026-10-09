// Generated from reviewed migrations; never accept caller SQL.
export const VISION_ROLLUP_DIRTY_MIGRATION_NAME = "0117_vision_rollup_dirty.sql"
export const VISION_ROLLUP_DIRTY_MIGRATION_STATEMENTS = Object.freeze([
  "CREATE TABLE IF NOT EXISTS icono_vision_rollup_dirty (\n  vision_id TEXT PRIMARY KEY NOT NULL,\n  marked_at TEXT NOT NULL\n);"
])
