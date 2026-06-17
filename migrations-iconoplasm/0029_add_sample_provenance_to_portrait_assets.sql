ALTER TABLE icono_portrait_assets ADD COLUMN sample_label TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN sample_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_portrait_assets ADD COLUMN sample_text_hash TEXT;
