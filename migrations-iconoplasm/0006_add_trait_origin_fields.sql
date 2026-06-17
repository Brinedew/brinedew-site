-- Phase 6: Store molecular provenance for mnemonic traits so tooltips can
-- show "derived from" metadata instead of treating politics as an origin.

ALTER TABLE icono_gene_essence ADD COLUMN aesthetics_origin_json TEXT;
ALTER TABLE icono_gene_essence ADD COLUMN politics_origin_json TEXT;
