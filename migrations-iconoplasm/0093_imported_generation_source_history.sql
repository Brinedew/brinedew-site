-- Exact imported input is valid even when its historical tag author is unknown.
-- Preserve all byte, identity, plaintext and immutability guards. No rows are rewritten.
-- Keep this rule coherent across request, Image API job, asset and receipt storage.

DROP TRIGGER trg_icono_bound_generation_request_complete_insert;
CREATE TRIGGER trg_icono_bound_generation_request_complete_insert
BEFORE INSERT ON icono_generation_requests
WHEN NEW.generation_provenance_status = 'bound' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_request_contract_sha256) = 64
  AND NEW.generation_request_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.prompt_body_mode = 'prose_prompt'
      AND NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (NEW.prompt_body_mode = 'taggerizer_prompt'
      AND length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = ''
      AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_request_provenance_incomplete');
END;

DROP TRIGGER trg_icono_bound_generation_request_complete_update;
CREATE TRIGGER trg_icono_bound_generation_request_complete_update
BEFORE UPDATE ON icono_generation_requests
WHEN NEW.generation_provenance_status = 'bound' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_request_contract_sha256) = 64
  AND NEW.generation_request_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.prompt_body_mode = 'prose_prompt'
      AND NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (NEW.prompt_body_mode = 'taggerizer_prompt'
      AND length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = ''
      AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_request_provenance_incomplete');
END;

DROP TRIGGER trg_icono_bound_generation_job_complete_insert;
CREATE TRIGGER trg_icono_bound_generation_job_complete_insert
BEFORE INSERT ON icono_candidate_generation_jobs
WHEN NEW.generation_provenance_status = 'bound'
 AND NEW.manifestation = '' AND NEW.prompt = '' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.generation_attempt_id)) > 0
  AND length(trim(NEW.provider_id)) > 0
  AND length(trim(NEW.provider_model_id)) > 0
  AND length(NEW.prompt_sha256) = 64 AND NEW.prompt_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_request_contract_sha256) = 64
  AND NEW.generation_request_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.prompt_body_mode = 'prose_prompt'
      AND NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (NEW.prompt_body_mode = 'taggerizer_prompt'
      AND length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = '' AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_job_provenance_incomplete');
END;

DROP TRIGGER trg_icono_bound_generation_job_complete_update;
CREATE TRIGGER trg_icono_bound_generation_job_complete_update
BEFORE UPDATE ON icono_candidate_generation_jobs
WHEN NEW.generation_provenance_status = 'bound'
 AND NEW.manifestation = '' AND NEW.prompt = '' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.generation_attempt_id)) > 0
  AND length(trim(NEW.provider_id)) > 0
  AND length(trim(NEW.provider_model_id)) > 0
  AND length(NEW.prompt_sha256) = 64 AND NEW.prompt_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_request_contract_sha256) = 64
  AND NEW.generation_request_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.prompt_body_mode = 'prose_prompt'
      AND NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (NEW.prompt_body_mode = 'taggerizer_prompt'
      AND length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = '' AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_job_provenance_incomplete');
END;

DROP TRIGGER trg_icono_bound_portrait_asset_complete_insert;
CREATE TRIGGER trg_icono_bound_portrait_asset_complete_insert
BEFORE INSERT ON icono_portrait_assets
WHEN NEW.generation_provenance_status = 'bound' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.generation_attempt_id)) > 0
  AND length(trim(NEW.generation_provider_id)) > 0
  AND length(trim(NEW.generation_model_id)) > 0
  AND length(NEW.generation_prompt_sha256) = 64
  AND NEW.generation_prompt_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = '' AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_portrait_asset_provenance_incomplete');
END;

DROP TRIGGER trg_icono_bound_portrait_asset_complete_update;
CREATE TRIGGER trg_icono_bound_portrait_asset_complete_update
BEFORE UPDATE ON icono_portrait_assets
WHEN NEW.generation_provenance_status = 'bound' AND NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.generation_attempt_id)) > 0
  AND length(trim(NEW.generation_provider_id)) > 0
  AND length(trim(NEW.generation_model_id)) > 0
  AND length(NEW.generation_prompt_sha256) = 64
  AND NEW.generation_prompt_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.source_sample_label = '' AND NEW.source_sample_number IS NULL
      AND NEW.source_sample_text_sha256 = '')
    OR
    (length(trim(NEW.source_sample_label)) > 0
      AND length(NEW.source_sample_text_sha256) = 64
      AND NEW.source_sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.source_sample_number IS NULL OR NEW.source_sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'bound_portrait_asset_provenance_incomplete');
END;

DROP TRIGGER trg_icono_portrait_generation_provenance_complete;
CREATE TRIGGER trg_icono_portrait_generation_provenance_complete
BEFORE INSERT ON icono_portrait_generation_provenance
WHEN NOT (
  length(trim(NEW.generation_request_id)) > 0
  AND length(trim(NEW.generation_attempt_id)) > 0
  AND length(trim(NEW.gene_symbol)) > 0
  AND length(NEW.asset_sha256) = 64 AND NEW.asset_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_gene_id)) > 0
  AND length(trim(NEW.source_manifestation_id)) > 0
  AND length(trim(NEW.source_manifestation_revision_id)) > 0
  AND length(NEW.source_manifestation_body_sha256) = 64
  AND NEW.source_manifestation_body_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.source_canonical_selection_id)) > 0
  AND NEW.source_canonical_head_version >= 1
  AND NEW.source_gene_revision >= 1
  AND length(NEW.source_snapshot_sha256) = 64
  AND NEW.source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(trim(NEW.provider_id)) > 0
  AND length(trim(NEW.model_id)) > 0
  AND length(NEW.prompt_sha256) = 64 AND NEW.prompt_sha256 NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.generation_config_sha256) = 64
  AND NEW.generation_config_sha256 NOT GLOB '*[^0-9a-f]*'
  AND (
    (NEW.source_manifestation_derivative_id = ''
      AND NEW.source_manifestation_derivative_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_sha256 = ''
      AND NEW.source_manifestation_derivative_tags_bytes = 0
      AND NEW.source_manifestation_derivative_fields_sha256 = ''
      AND NEW.source_manifestation_derivative_fields_bytes = 0
      AND NEW.source_manifestation_derivative_recipe_id = ''
      AND NEW.source_manifestation_derivative_recipe_version = ''
      AND NEW.source_manifestation_derivative_provider_id = ''
      AND NEW.source_manifestation_derivative_model_id = ''
      AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
    OR
    (length(trim(NEW.source_manifestation_derivative_id)) > 0
      AND length(NEW.source_manifestation_derivative_sha256) = 64
      AND NEW.source_manifestation_derivative_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(NEW.source_manifestation_derivative_tags_sha256) = 64
      AND NEW.source_manifestation_derivative_tags_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_tags_bytes >= 1
      AND length(NEW.source_manifestation_derivative_fields_sha256) = 64
      AND NEW.source_manifestation_derivative_fields_sha256 NOT GLOB '*[^0-9a-f]*'
      AND NEW.source_manifestation_derivative_fields_bytes >= 2
      AND (
        (NEW.source_manifestation_derivative_recipe_id = ''
          AND NEW.source_manifestation_derivative_recipe_version = ''
          AND NEW.source_manifestation_derivative_provider_id = ''
          AND NEW.source_manifestation_derivative_model_id = ''
          AND NEW.source_manifestation_derivative_tagger_config_sha256 = '')
        OR
        (length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
          AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
          AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
          AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
          AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
      ))
  )
  AND (
    (NEW.sample_label = '' AND NEW.sample_number IS NULL AND NEW.sample_text_sha256 = '')
    OR
    (length(trim(NEW.sample_label)) > 0
      AND length(NEW.sample_text_sha256) = 64
      AND NEW.sample_text_sha256 NOT GLOB '*[^0-9a-f]*'
      AND (NEW.sample_number IS NULL OR NEW.sample_number >= 0))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'portrait_generation_provenance_incomplete');
END;
