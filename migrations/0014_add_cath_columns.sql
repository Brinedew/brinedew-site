-- Migration: 0014 - Add CATH architecture column
-- CATH architecture describes the structural fold classification (e.g., "Sandwich", "Barrel")
-- Stored as JSON array since multi-domain proteins can have multiple architectures

-- Drop unused columns from earlier migration (if they exist)
-- SQLite doesn't support DROP COLUMN easily, so we just add the new one
ALTER TABLE proteins ADD COLUMN cath_architecture TEXT;
