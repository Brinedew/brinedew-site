INSERT OR IGNORE INTO icono_user_emulsion_favorites (user_id, emulsion_family_id, created_at)
SELECT
  user_id,
  '0-' || CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER),
  created_at
FROM icono_user_emulsion_favorites
WHERE substr(emulsion_family_id, 1, 1) GLOB '[A-Za-z]'
  AND instr(emulsion_family_id, '-') >= 3
  AND substr(emulsion_family_id, 2, instr(emulsion_family_id, '-') - 2) NOT GLOB '*[^0-9]*'
  AND substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) <> ''
  AND substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) NOT GLOB '*[^0-9]*'
  AND CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER) > 0;

DELETE FROM icono_user_emulsion_favorites
WHERE substr(emulsion_family_id, 1, 1) GLOB '[A-Za-z]'
  AND instr(emulsion_family_id, '-') >= 3
  AND substr(emulsion_family_id, 2, instr(emulsion_family_id, '-') - 2) NOT GLOB '*[^0-9]*'
  AND substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) <> ''
  AND substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) NOT GLOB '*[^0-9]*'
  AND CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER) > 0;
