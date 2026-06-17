-- Move repeated image-edit preservation instructions into one shared suffix.
--
-- Cost fence:
-- This table is bounded admin configuration. Keep this migration and the
-- runtime prompt-template reads away from public gallery, card, catalog, and
-- first-party hot reads.

INSERT INTO icono_image_edit_prompt_templates (
  kind,
  prompt_template,
  updated_by,
  created_at,
  updated_at
) VALUES (
  'shared_suffix',
  'Preserve art style, identity, outfit concept, fashion style, pose, composition, lighting, and background unless the selected edit explicitly requires a change. Strictly preserve linework style, rendering style, tone mapping, material roughness, and unrelated regions. Avoid full redraws; use surgical edits in masked spots.',
  'migration-0044-shared-suffix',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(kind) DO NOTHING;

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Adjust the character age to visibly look as {years} years old.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'age_years'
  AND prompt_template = 'Adjust the character age to visibly look as {years} years old. Preserve art style, identity, outfit concept, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Make the character a demi-human (not furry) with a fantastical feature clearly present: {value}.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'fantastical_feature'
  AND prompt_template = 'Make the character a demi-human (not furry) with a fantastical feature clearly present: {value}. Preserve art style, identity, outfit concept, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Adjust the character''s fashion style mix toward {styles}.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'fashion_styles'
  AND prompt_template = 'Adjust the character''s fashion style mix toward {styles}. Preserve art style, identity, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Change the character''s body scale and head-to-body ratio to read as {kg} kg. Smaller kg masses should become compact and chibi with a proportionally larger head and smaller body. Average kg characters (25-100) should have anywhere between 4 and 8 head:body ratio proportions. Larger kg masses should become broad, tall, and monumental with a proportionally smaller head and heavier body, and upward-tilting camera to exaggerate relative size. Adjust pose as needed.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'mass_kg'
  AND prompt_template = 'Change the character''s body scale and head-to-body ratio to read as {kg} kg. Smaller kg masses should become compact and chibi with a proportionally larger head and smaller body. Average kg characters (25-100) should have anywhere between 4 and 8 head:body ratio proportions. Larger kg masses should become broad, tall, and monumental with a proportionally smaller head and heavier body, and upward-tilting camera to exaggerate relative size. Adjust pose as needed. Preserve art style, identity, outfit concept, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Remove visible AI generation errors and repair malformed hands, extra limbs, remove text fragments and watermarks, broken anatomy, and rendering artifacts, make fantastical features make sense.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'remove_ai_generation_errors'
  AND prompt_template = 'Remove visible AI generation errors and repair malformed hands, extra limbs, remove text fragments and watermarks, broken anatomy, and rendering artifacts, make fantastical features make sense. Preserve art style, identity, outfit concept, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Adjust the character''s sex to {value}.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'sex'
  AND prompt_template = 'Adjust the character''s sex to {value}. Preserve art style, fashion style, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';

UPDATE icono_image_edit_prompt_templates
SET
  prompt_template = 'Change only visible skin tone to {hex}. Leave wardrobe and costume colors unchanged; do not recolor outfit, hair, accessories, lighting, background, or material surfaces.',
  updated_by = 'migration-0044-shared-suffix',
  updated_at = CURRENT_TIMESTAMP
WHERE kind = 'surface_tone_hex'
  AND prompt_template = 'Change only visible skin tone to {hex}. Leave wardrobe and costume colors unchanged; do not recolor outfit, hair, accessories, lighting, background, or material surfaces. Preserve art style, identity, outfit concept, pose, composition, lighting, and background. Strictly preserve linework style, rendering style, tone mapping and material roughness. Avoid full redraws, just do surgical edits in masked spots.';
