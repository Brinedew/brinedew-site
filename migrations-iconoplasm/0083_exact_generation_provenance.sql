-- Bind every new generation request, direct generation job, and generated
-- portrait to one immutable authoring revision. Historical rows deliberately
-- remain legacy_unbound: a matching gene symbol is not proof of provenance.
--
-- D1 cost fence:
-- These are compact identities and hashes only. Plaintext manifestation prose
-- and derived Tags bodies remain encrypted outside D1 under IPD-012.

ALTER TABLE icono_generation_requests
  ADD COLUMN generation_provenance_status TEXT NOT NULL DEFAULT 'legacy_unbound'
  CHECK (generation_provenance_status IN ('legacy_unbound', 'bound'));
ALTER TABLE icono_generation_requests ADD COLUMN generation_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN source_gene_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN source_manifestation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_revision_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_body_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_tags_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_tags_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_fields_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_fields_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_recipe_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_recipe_version TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_manifestation_derivative_tagger_config_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_manifestation_derivative_tagger_config_sha256 = ''
    OR length(source_manifestation_derivative_tagger_config_sha256) = 64
  );
ALTER TABLE icono_generation_requests
  ADD COLUMN source_canonical_selection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_canonical_head_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_generation_requests
  ADD COLUMN source_gene_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_generation_requests ADD COLUMN source_sample_label TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN source_sample_number INTEGER CHECK (
    source_sample_number IS NULL OR source_sample_number >= 0
  );
ALTER TABLE icono_generation_requests
  ADD COLUMN source_sample_text_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_sample_text_sha256 = '' OR length(source_sample_text_sha256) = 64
  );
ALTER TABLE icono_generation_requests ADD COLUMN source_snapshot_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN generation_request_contract_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests
  ADD COLUMN generation_config_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN fulfilled_generation_attempt_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN fulfilled_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN fulfilled_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_generation_requests ADD COLUMN fulfilled_prompt_sha256 TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_source_revision
  ON icono_generation_requests (
    source_manifestation_revision_id,
    status,
    created_at,
    id
  )
  WHERE generation_provenance_status = 'bound';

CREATE UNIQUE INDEX IF NOT EXISTS uq_icono_generation_requests_stable_request
  ON icono_generation_requests (generation_request_id)
  WHERE generation_request_id <> '';

CREATE TABLE IF NOT EXISTS icono_generation_execution_leases (
  generation_request_id TEXT PRIMARY KEY,
  request_row_id INTEGER NOT NULL UNIQUE REFERENCES icono_generation_requests(id) ON DELETE CASCADE,
  generation_attempt_id TEXT NOT NULL UNIQUE,
  lease_token TEXT NOT NULL UNIQUE,
  lease_owner_id TEXT NOT NULL,
  lease_version INTEGER NOT NULL CHECK (lease_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  failure_code TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'active' AND completed_at IS NULL AND failed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (status = 'failed' AND completed_at IS NULL AND failed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_execution_leases_due
  ON icono_generation_execution_leases (status, expires_at, request_row_id);

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_request_complete_insert
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_request_complete_update
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_request_identity_immutable
BEFORE UPDATE OF generation_provenance_status, generation_request_id,
  source_gene_id, source_manifestation_id, source_manifestation_revision_id,
  source_manifestation_body_sha256, source_manifestation_derivative_id,
  source_manifestation_derivative_sha256, source_manifestation_derivative_tags_sha256,
  source_manifestation_derivative_tags_bytes, source_manifestation_derivative_fields_sha256,
  source_manifestation_derivative_fields_bytes, source_manifestation_derivative_recipe_id,
  source_manifestation_derivative_recipe_version, source_manifestation_derivative_provider_id,
  source_manifestation_derivative_model_id, source_manifestation_derivative_tagger_config_sha256,
  source_canonical_selection_id, source_canonical_head_version, source_gene_revision,
  source_sample_label, source_sample_number, source_sample_text_sha256,
  source_snapshot_sha256, generation_request_contract_sha256, generation_config_sha256,
  prompt_body_mode
ON icono_generation_requests
WHEN OLD.generation_provenance_status = 'bound' AND (
  NEW.generation_provenance_status IS NOT OLD.generation_provenance_status
  OR NEW.generation_request_id IS NOT OLD.generation_request_id
  OR NEW.source_gene_id IS NOT OLD.source_gene_id
  OR NEW.source_manifestation_id IS NOT OLD.source_manifestation_id
  OR NEW.source_manifestation_revision_id IS NOT OLD.source_manifestation_revision_id
  OR NEW.source_manifestation_body_sha256 IS NOT OLD.source_manifestation_body_sha256
  OR NEW.source_manifestation_derivative_id IS NOT OLD.source_manifestation_derivative_id
  OR NEW.source_manifestation_derivative_sha256 IS NOT OLD.source_manifestation_derivative_sha256
  OR NEW.source_manifestation_derivative_tags_sha256 IS NOT OLD.source_manifestation_derivative_tags_sha256
  OR NEW.source_manifestation_derivative_tags_bytes IS NOT OLD.source_manifestation_derivative_tags_bytes
  OR NEW.source_manifestation_derivative_fields_sha256 IS NOT OLD.source_manifestation_derivative_fields_sha256
  OR NEW.source_manifestation_derivative_fields_bytes IS NOT OLD.source_manifestation_derivative_fields_bytes
  OR NEW.source_manifestation_derivative_recipe_id IS NOT OLD.source_manifestation_derivative_recipe_id
  OR NEW.source_manifestation_derivative_recipe_version IS NOT OLD.source_manifestation_derivative_recipe_version
  OR NEW.source_manifestation_derivative_provider_id IS NOT OLD.source_manifestation_derivative_provider_id
  OR NEW.source_manifestation_derivative_model_id IS NOT OLD.source_manifestation_derivative_model_id
  OR NEW.source_manifestation_derivative_tagger_config_sha256 IS NOT OLD.source_manifestation_derivative_tagger_config_sha256
  OR NEW.source_canonical_selection_id IS NOT OLD.source_canonical_selection_id
  OR NEW.source_canonical_head_version IS NOT OLD.source_canonical_head_version
  OR NEW.source_gene_revision IS NOT OLD.source_gene_revision
  OR NEW.source_sample_label IS NOT OLD.source_sample_label
  OR NEW.source_sample_number IS NOT OLD.source_sample_number
  OR NEW.source_sample_text_sha256 IS NOT OLD.source_sample_text_sha256
  OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.generation_request_contract_sha256 IS NOT OLD.generation_request_contract_sha256
  OR NEW.generation_config_sha256 IS NOT OLD.generation_config_sha256
  OR NEW.prompt_body_mode IS NOT OLD.prompt_body_mode
)
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_request_identity_is_immutable');
END;

ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN generation_provenance_status TEXT NOT NULL DEFAULT 'legacy_unbound'
  CHECK (generation_provenance_status IN ('legacy_unbound', 'bound'));
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN generation_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN generation_attempt_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs ADD COLUMN source_gene_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_revision_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_body_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_tags_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_tags_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_fields_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_fields_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_recipe_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_recipe_version TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_manifestation_derivative_tagger_config_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_manifestation_derivative_tagger_config_sha256 = ''
    OR length(source_manifestation_derivative_tagger_config_sha256) = 64
  );
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_canonical_selection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_canonical_head_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_gene_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_candidate_generation_jobs ADD COLUMN source_sample_label TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_sample_number INTEGER CHECK (
    source_sample_number IS NULL OR source_sample_number >= 0
  );
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_sample_text_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_sample_text_sha256 = '' OR length(source_sample_text_sha256) = 64
  );
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN source_snapshot_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN generation_request_contract_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN provider_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs ADD COLUMN prompt_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN generation_config_sha256 TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_icono_candidate_generation_request
  ON icono_candidate_generation_jobs (user_id, generation_request_id)
  WHERE generation_request_id <> '';

-- A bound row may contain only the compact source projection. The historical
-- columns are retained for legacy rows, but accepting exact source prose or a
-- prompt that embeds it would duplicate private authoring bodies in primary D1.
CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_job_reject_plaintext_insert
BEFORE INSERT ON icono_candidate_generation_jobs
WHEN NEW.generation_provenance_status = 'bound'
 AND (NEW.manifestation <> '' OR NEW.prompt <> '')
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_job_plaintext_forbidden');
END;

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_job_reject_plaintext_update
BEFORE UPDATE OF generation_provenance_status, manifestation, prompt
ON icono_candidate_generation_jobs
WHEN NEW.generation_provenance_status = 'bound'
 AND (NEW.manifestation <> '' OR NEW.prompt <> '')
BEGIN
  SELECT RAISE(ABORT, 'bound_generation_job_plaintext_forbidden');
END;

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_job_complete_insert
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_generation_job_complete_update
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

ALTER TABLE icono_portrait_assets
  ADD COLUMN generation_provenance_status TEXT NOT NULL DEFAULT 'legacy_unbound'
  CHECK (generation_provenance_status IN ('legacy_unbound', 'bound'));
ALTER TABLE icono_portrait_assets ADD COLUMN generation_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN generation_attempt_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN generation_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN generation_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN generation_prompt_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN generation_config_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN source_gene_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets ADD COLUMN source_manifestation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_revision_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_body_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_tags_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_tags_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_fields_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_fields_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_recipe_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_recipe_version TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_manifestation_derivative_tagger_config_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_manifestation_derivative_tagger_config_sha256 = ''
    OR length(source_manifestation_derivative_tagger_config_sha256) = 64
  );
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_canonical_selection_id TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_canonical_head_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_portrait_assets ADD COLUMN source_gene_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE icono_portrait_assets ADD COLUMN source_sample_label TEXT NOT NULL DEFAULT '';
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_sample_number INTEGER CHECK (
    source_sample_number IS NULL OR source_sample_number >= 0
  );
ALTER TABLE icono_portrait_assets
  ADD COLUMN source_sample_text_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_sample_text_sha256 = '' OR length(source_sample_text_sha256) = 64
  );
ALTER TABLE icono_portrait_assets ADD COLUMN source_snapshot_sha256 TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_source_revision
  ON icono_portrait_assets (source_manifestation_revision_id, gene_symbol, created_at DESC)
  WHERE generation_provenance_status = 'bound';

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_portrait_asset_complete_insert
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

CREATE TRIGGER IF NOT EXISTS trg_icono_bound_portrait_asset_complete_update
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

-- A content-addressed portrait can be produced more than once. Keep every
-- exact generation receipt instead of rewriting one asset row when identical
-- bytes are generated from different immutable inputs.
CREATE TABLE IF NOT EXISTS icono_portrait_generation_provenance (
  generation_request_id TEXT PRIMARY KEY,
  generation_attempt_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  source_gene_id TEXT NOT NULL,
  source_manifestation_id TEXT NOT NULL,
  source_manifestation_revision_id TEXT NOT NULL,
  source_manifestation_body_sha256 TEXT NOT NULL CHECK (length(source_manifestation_body_sha256) = 64),
  source_manifestation_derivative_id TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_sha256 TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_tags_sha256 TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_tags_bytes INTEGER NOT NULL DEFAULT 0,
  source_manifestation_derivative_fields_sha256 TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_fields_bytes INTEGER NOT NULL DEFAULT 0,
  source_manifestation_derivative_recipe_id TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_recipe_version TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_provider_id TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_model_id TEXT NOT NULL DEFAULT '',
  source_manifestation_derivative_tagger_config_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    source_manifestation_derivative_tagger_config_sha256 = ''
    OR length(source_manifestation_derivative_tagger_config_sha256) = 64
  ),
  source_canonical_selection_id TEXT NOT NULL,
  source_canonical_head_version INTEGER NOT NULL CHECK (source_canonical_head_version >= 1),
  source_gene_revision INTEGER NOT NULL CHECK (source_gene_revision >= 1),
  source_snapshot_sha256 TEXT NOT NULL CHECK (length(source_snapshot_sha256) = 64),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64),
  generation_config_sha256 TEXT NOT NULL CHECK (length(generation_config_sha256) = 64),
  sample_label TEXT NOT NULL DEFAULT '',
  sample_number INTEGER CHECK (sample_number IS NULL OR sample_number >= 0),
  sample_text_sha256 TEXT NOT NULL DEFAULT '' CHECK (
    sample_text_sha256 = '' OR length(sample_text_sha256) = 64
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gene_symbol, asset_sha256)
    REFERENCES icono_portrait_assets (gene_symbol, asset_sha256)
);

CREATE INDEX IF NOT EXISTS idx_icono_portrait_generation_provenance_source_revision
  ON icono_portrait_generation_provenance (
    source_manifestation_revision_id,
    gene_symbol,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_icono_portrait_generation_provenance_attempt
  ON icono_portrait_generation_provenance (generation_attempt_id, gene_symbol);

CREATE TRIGGER IF NOT EXISTS trg_icono_portrait_generation_provenance_complete
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
      AND length(trim(NEW.source_manifestation_derivative_recipe_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_recipe_version)) > 0
      AND length(trim(NEW.source_manifestation_derivative_provider_id)) > 0
      AND length(trim(NEW.source_manifestation_derivative_model_id)) > 0
      AND length(NEW.source_manifestation_derivative_tagger_config_sha256) = 64
      AND NEW.source_manifestation_derivative_tagger_config_sha256 NOT GLOB '*[^0-9a-f]*')
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

CREATE TRIGGER IF NOT EXISTS trg_icono_portrait_generation_provenance_immutable
BEFORE UPDATE ON icono_portrait_generation_provenance
BEGIN
  SELECT RAISE(ABORT, 'portrait_generation_provenance_is_immutable');
END;
