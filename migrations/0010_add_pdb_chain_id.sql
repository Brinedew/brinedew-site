-- Migration: 0010 - Historical no-op for duplicated pdb_chain_id column
--
-- Architectural choice:
--   Keep the migration chain replayable on a fresh/local database even when
--   historical remote state contains a duplicate migration record.
--
-- Mistake to avoid:
--   Do not reintroduce a second ALTER TABLE here. Migration 0008 already adds
--   proteins.pdb_chain_id, and replaying the duplicate step makes local D1
--   bootstrap fail before later schema fixes can apply.

SELECT 1;
