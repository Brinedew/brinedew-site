-- Bind every specific generation request to the exact example blot the user saw.
--
-- A public emulsion id is a presentation identity, not an executable recipe.
-- Keeping only requested_vision_id made old requests depend on whichever local
-- artist registry happened to exist when the workstation eventually drained
-- them.  The ranked preview is already the user's visual source of truth, so
-- snapshot its first asset at request time and keep that immutable reference on
-- the request itself.

ALTER TABLE icono_generation_requests
  ADD COLUMN requested_reference_asset_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_generation_requests
  ADD COLUMN requested_reference_gene_symbol TEXT NOT NULL DEFAULT '';

-- Existing open requests predate the snapshot column. Freeze the example that
-- is currently ranked first once during migration; runtime reads never fall
-- back to a mutable rollup.
UPDATE icono_generation_requests
SET requested_reference_asset_sha256 = lower(COALESCE((
      SELECT json_extract(opt.preview_assets_json, '$[0].asset_sha256')
      FROM icono_generation_request_vision_option_rollup opt
      WHERE opt.vision_id = icono_generation_requests.requested_vision_id
      LIMIT 1
    ), '')),
    requested_reference_gene_symbol = upper(COALESCE((
      SELECT json_extract(opt.preview_assets_json, '$[0].gene_symbol')
      FROM icono_generation_request_vision_option_rollup opt
      WHERE opt.vision_id = icono_generation_requests.requested_vision_id
      LIMIT 1
    ), ''))
WHERE request_mode = 'specific'
  AND status IN ('open', 'delivery_pending')
  AND COALESCE(requested_reference_asset_sha256, '') = '';
