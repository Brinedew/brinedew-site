-- Add avatar_url + updated_at to icono_gene_comments.
--
-- The table was first created on production by an earlier minimal variant of
-- migration 0045, so its CREATE TABLE IF NOT EXISTS could not add these columns.
-- The worker now selects/inserts avatar_url (Discord avatar) and reads updated_at,
-- so without these columns the comments read fails with a 500. Adding them here
-- backfills production and keeps fresh databases (which create the minimal table
-- in 0045) on an identical schema.
--
-- ALTER ... ADD COLUMN requires a constant default, so updated_at uses '' rather
-- than strftime(); the worker does not depend on its value.
ALTER TABLE icono_gene_comments ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_gene_comments ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
