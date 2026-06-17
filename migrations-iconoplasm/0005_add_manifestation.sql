-- Add manifestation column: 2-3 sentence character description synced from prompts.db.
-- Rendered on gene pages as the "character sheet" intro paragraph.

ALTER TABLE icono_gene_essence ADD COLUMN manifestation TEXT;
