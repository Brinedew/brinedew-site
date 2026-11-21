-- B-1278: style picker thumbnails must only show unedited canonical portraits
-- of a style's genes, never edited (`-e` / `image-edit:`) portraits (nor
-- non-canonical drafts). `blot_count` still counts all canonical portraits of
-- the style in `icono_style_published_portraits`; only `portraits_json`
-- excludes edited assets.
DROP TRIGGER trg_icono_style_cards_insert;
DROP TRIGGER trg_icono_style_cards_delete;
DROP TRIGGER trg_icono_style_cards_update;
DROP TRIGGER trg_icono_style_cards_placeholder;

CREATE TRIGGER trg_icono_style_cards_insert AFTER INSERT ON icono_style_published_portraits
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT NEW.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = NEW.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes, placeholder)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes, a.placeholder
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    LEFT JOIN icono_portrait_assets a
      ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = NEW.style_slot
      AND lower(COALESCE(a.emulsion_id, '')) NOT LIKE '%-e'
      AND lower(COALESCE(a.vision_id, '')) NOT LIKE 'image-edit:%'
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

CREATE TRIGGER trg_icono_style_cards_delete AFTER DELETE ON icono_style_published_portraits
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT OLD.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = OLD.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes, placeholder)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes, a.placeholder
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    LEFT JOIN icono_portrait_assets a
      ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = OLD.style_slot
      AND lower(COALESCE(a.emulsion_id, '')) NOT LIKE '%-e'
      AND lower(COALESCE(a.vision_id, '')) NOT LIKE 'image-edit:%'
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

CREATE TRIGGER trg_icono_style_cards_update
AFTER UPDATE OF asset_sha256 ON icono_style_published_portraits
WHEN OLD.asset_sha256 IS NOT NEW.asset_sha256
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT NEW.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = NEW.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes, placeholder)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes, a.placeholder
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    LEFT JOIN icono_portrait_assets a
      ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = NEW.style_slot
      AND lower(COALESCE(a.emulsion_id, '')) NOT LIKE '%-e'
      AND lower(COALESCE(a.vision_id, '')) NOT LIKE 'image-edit:%'
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

CREATE TRIGGER trg_icono_style_cards_placeholder
AFTER UPDATE OF placeholder ON icono_portrait_assets
WHEN OLD.placeholder IS NOT NEW.placeholder
  AND EXISTS (
    SELECT 1 FROM icono_style_cards c
    WHERE c.style_slot = CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER)
      AND instr(c.portraits_json, NEW.asset_sha256) > 0
  )
BEGIN
UPDATE icono_style_cards SET portraits_json = (
  SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes, placeholder)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes, a.placeholder
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    LEFT JOIN icono_portrait_assets a
      ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = icono_style_cards.style_slot
      AND lower(COALESCE(a.emulsion_id, '')) NOT LIKE '%-e'
      AND lower(COALESCE(a.vision_id, '')) NOT LIKE 'image-edit:%'
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
WHERE style_slot = CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER);
END;

UPDATE icono_style_cards SET portraits_json = (
  SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes, placeholder)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes, a.placeholder
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    LEFT JOIN icono_portrait_assets a
      ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = icono_style_cards.style_slot
      AND lower(COALESCE(a.emulsion_id, '')) NOT LIKE '%-e'
      AND lower(COALESCE(a.vision_id, '')) NOT LIKE 'image-edit:%'
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
WHERE style_slot IN (
  SELECT DISTINCT m.style_slot
  FROM icono_style_published_portraits m
  JOIN icono_portrait_assets a
    ON a.gene_symbol = m.gene_symbol AND a.asset_sha256 = m.asset_sha256
  WHERE lower(COALESCE(a.emulsion_id, '')) LIKE '%-e'
     OR lower(COALESCE(a.vision_id, '')) LIKE 'image-edit:%'
);
