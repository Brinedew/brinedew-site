-- Add migrated_at column to track when localStorage stats were migrated
ALTER TABLE stats ADD COLUMN migrated_at INTEGER;
