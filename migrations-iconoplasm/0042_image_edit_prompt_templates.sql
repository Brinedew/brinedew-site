-- Admin-editable prompt templates for the image edit checkbox actions.
--
-- Cost fence:
-- The table is deliberately tiny and keyed by prompt kind. Runtime image edit
-- jobs read only this bounded config set before making a provider call. Do not
-- join this table into public gallery, card, catalog, or first-party hot reads.

CREATE TABLE IF NOT EXISTS icono_image_edit_prompt_templates (
  kind TEXT PRIMARY KEY,
  prompt_template TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
