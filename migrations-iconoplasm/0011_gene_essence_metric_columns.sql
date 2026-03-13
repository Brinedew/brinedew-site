-- Store synced lab-label footer diagnostics from the NiceGUI Website Ops sync.
-- These are public render-time metrics used by the vintage label card footer and
-- should come from the synced essence snapshot, not from UI fallback logic.

ALTER TABLE icono_gene_essence ADD COLUMN tissue_tau REAL;
ALTER TABLE icono_gene_essence ADD COLUMN loeuf REAL;
ALTER TABLE icono_gene_essence ADD COLUMN constraint_percentile REAL;
