-- B-1131: nothing reads or writes the blot ledger any more. A gene's blot
-- address follows from its stable gene object (workers/lib/iconoplasm-blot.js)
-- and scripts/draw-iconoplasm-blots.mjs, in GitHub Actions, draws whatever
-- Bunny storage lacks, so storage is the record of which blots exist. The
-- workstation drain that filled these tables through the admin blots routes
-- is gone, and so are the routes (the release before this one).
DROP INDEX IF EXISTS idx_icono_gene_blot_materializations_fingerprint;
DROP TABLE IF EXISTS icono_gene_blot_materializations;
DROP TABLE IF EXISTS icono_gene_blot_backlog_watermark;
