-- ARCHITECTURE FENCE [IPD-005]: manifestation prose belongs to the canonical
-- gene essence row. The admin rollup is an operational index and must not keep a
-- second 68 MB copy of immutable profile text. The column remains empty during
-- the rolling deploy so the pre-deploy Worker can continue to read the schema.
UPDATE icono_admin_gene_rollup
SET manifestation = ''
WHERE length(COALESCE(manifestation, '')) > 0;
