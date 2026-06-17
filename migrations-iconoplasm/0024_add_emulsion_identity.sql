ALTER TABLE icono_portrait_assets ADD COLUMN emulsion_id TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN workflow_id TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN workflow_label TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN workflow_path TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN prompt_version TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN variant_slot TEXT;

ALTER TABLE icono_admin_gene_rollup ADD COLUMN live_emulsion_id TEXT;
ALTER TABLE icono_admin_gene_rollup ADD COLUMN leader_emulsion_id TEXT;

ALTER TABLE icono_admin_vision_rollup ADD COLUMN emulsion_id TEXT;
ALTER TABLE icono_admin_vision_rollup ADD COLUMN workflow_id TEXT;
ALTER TABLE icono_admin_vision_rollup ADD COLUMN workflow_label TEXT;
ALTER TABLE icono_admin_vision_rollup ADD COLUMN prompt_version TEXT;
ALTER TABLE icono_admin_vision_rollup ADD COLUMN variant_slot TEXT;
