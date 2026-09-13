// Preserve exact metadata and canonical status semantics. An unchanged sync
// must not rewrite the row, its indexes or its trigger-maintained projections.
export const PORTRAIT_ASSET_UPSERT_SQL = `INSERT INTO icono_portrait_assets (
                 gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
                 mime, width, height, bytes, status, autopick_eligible, is_stale, is_legacy,
                 vision_id, emulsion_id, workflow_id, workflow_label, workflow_path, prompt_version, variant_slot,
                 candidate_image_id, sample_label, sample_number, sample_text_hash, artist_tag, artist_name, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
                 r2_key_full=excluded.r2_key_full,
                 r2_key_medium=excluded.r2_key_medium,
                 r2_key_thumb=excluded.r2_key_thumb,
                 mime=excluded.mime,
                 width=COALESCE(excluded.width, icono_portrait_assets.width),
                 height=COALESCE(excluded.height, icono_portrait_assets.height),
                 bytes=COALESCE(excluded.bytes, icono_portrait_assets.bytes),
                 status=excluded.status,
                 autopick_eligible=excluded.autopick_eligible,
                 is_stale=excluded.is_stale,
                 is_legacy=0,
                 vision_id=COALESCE(excluded.vision_id, icono_portrait_assets.vision_id),
                 emulsion_id=COALESCE(excluded.emulsion_id, icono_portrait_assets.emulsion_id),
                 workflow_id=COALESCE(excluded.workflow_id, icono_portrait_assets.workflow_id),
                 workflow_label=COALESCE(excluded.workflow_label, icono_portrait_assets.workflow_label),
                 workflow_path=COALESCE(excluded.workflow_path, icono_portrait_assets.workflow_path),
                 prompt_version=COALESCE(excluded.prompt_version, icono_portrait_assets.prompt_version),
                 variant_slot=COALESCE(excluded.variant_slot, icono_portrait_assets.variant_slot),
                 candidate_image_id=COALESCE(excluded.candidate_image_id, icono_portrait_assets.candidate_image_id),
                 sample_label=COALESCE(excluded.sample_label, icono_portrait_assets.sample_label),
                 sample_number=COALESCE(excluded.sample_number, icono_portrait_assets.sample_number),
                 sample_text_hash=COALESCE(excluded.sample_text_hash, icono_portrait_assets.sample_text_hash),
                  artist_tag=NULL,
                  artist_name=NULL,
                 created_by=COALESCE(excluded.created_by, icono_portrait_assets.created_by)
               WHERE icono_portrait_assets.r2_key_full IS NOT excluded.r2_key_full
                  OR icono_portrait_assets.r2_key_medium IS NOT excluded.r2_key_medium
                  OR icono_portrait_assets.r2_key_thumb IS NOT excluded.r2_key_thumb
                  OR icono_portrait_assets.mime IS NOT excluded.mime
                  OR icono_portrait_assets.width IS NOT COALESCE(excluded.width, icono_portrait_assets.width)
                  OR icono_portrait_assets.height IS NOT COALESCE(excluded.height, icono_portrait_assets.height)
                  OR icono_portrait_assets.bytes IS NOT COALESCE(excluded.bytes, icono_portrait_assets.bytes)
                  OR icono_portrait_assets.status IS NOT excluded.status
                  OR icono_portrait_assets.autopick_eligible IS NOT excluded.autopick_eligible
                  OR icono_portrait_assets.is_stale IS NOT excluded.is_stale
                  OR icono_portrait_assets.is_legacy IS NOT 0
                  OR icono_portrait_assets.vision_id IS NOT COALESCE(excluded.vision_id, icono_portrait_assets.vision_id)
                  OR icono_portrait_assets.emulsion_id IS NOT COALESCE(excluded.emulsion_id, icono_portrait_assets.emulsion_id)
                  OR icono_portrait_assets.workflow_id IS NOT COALESCE(excluded.workflow_id, icono_portrait_assets.workflow_id)
                  OR icono_portrait_assets.workflow_label IS NOT COALESCE(excluded.workflow_label, icono_portrait_assets.workflow_label)
                  OR icono_portrait_assets.workflow_path IS NOT COALESCE(excluded.workflow_path, icono_portrait_assets.workflow_path)
                  OR icono_portrait_assets.prompt_version IS NOT COALESCE(excluded.prompt_version, icono_portrait_assets.prompt_version)
                  OR icono_portrait_assets.variant_slot IS NOT COALESCE(excluded.variant_slot, icono_portrait_assets.variant_slot)
                  OR icono_portrait_assets.candidate_image_id IS NOT COALESCE(excluded.candidate_image_id, icono_portrait_assets.candidate_image_id)
                  OR icono_portrait_assets.sample_label IS NOT COALESCE(excluded.sample_label, icono_portrait_assets.sample_label)
                  OR icono_portrait_assets.sample_number IS NOT COALESCE(excluded.sample_number, icono_portrait_assets.sample_number)
                  OR icono_portrait_assets.sample_text_hash IS NOT COALESCE(excluded.sample_text_hash, icono_portrait_assets.sample_text_hash)
                  OR icono_portrait_assets.artist_tag IS NOT NULL
                  OR icono_portrait_assets.artist_name IS NOT NULL
                  OR icono_portrait_assets.created_by IS NOT COALESCE(excluded.created_by, icono_portrait_assets.created_by)`
