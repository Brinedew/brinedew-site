-- Direct candidate generation can use either the prose manifestation sample or
-- the distilled tag version of the same sample. Store the choice on each job
-- and sync the current tag body on the gene essence row.
--
-- D1 cost fence:
-- The candidate generation route must keep using one gene-symbol lookup. Do not
-- add live scans over manifestation or portrait tables to discover tag bodies.

ALTER TABLE icono_gene_essence ADD COLUMN manifestation_tags TEXT;
ALTER TABLE icono_gene_essence ADD COLUMN manifestation_fields_json TEXT;

ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN prompt_body_mode TEXT NOT NULL DEFAULT 'prose_sample';
