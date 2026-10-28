-- A portrait's placeholder: its ThumbHash, base64, about 25 bytes. The style
-- picker decodes it into a blurred copy of the portrait and shows it until the
-- picture's file arrives, so a card is never a white square while the grid
-- loads (owner, 2026-10-28). The workstation computes it when it publishes a
-- portrait; older portraits get theirs from a backfill through
-- /api/iconoplasm/admin/portraits/placeholders. NULL means none yet, and the
-- card shows its plain background.
ALTER TABLE icono_portrait_assets ADD COLUMN placeholder TEXT;

-- Each card picture carries its placeholder as a fourth element:
-- [gene_symbol, asset_sha256, upvotes, placeholder]. 0144's triggers are
-- otherwise unchanged.
DROP TRIGGER trg_icono_style_cards_insert;
DROP TRIGGER trg_icono_style_cards_delete;
DROP TRIGGER trg_icono_style_cards_update;

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
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

-- A placeholder that arrives after its portrait (the backfill, or a portrait
-- edited on the site, which has none) refreshes the one card that shows it:
-- one card row written per placeholder, and none for a portrait that no card
-- shows.
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
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
WHERE style_slot = CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER);
END;
