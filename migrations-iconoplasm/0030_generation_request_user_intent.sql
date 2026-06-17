-- Preserve the public FAQ contract for user-directed candidate generation.
-- The Worker still queues work for the local Iconoplasm workstation; these
-- columns keep the user's edit/new-candidate intent attached to the durable row
-- so review tooling can see what was actually requested.

ALTER TABLE icono_generation_requests
  ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'new_candidate'
  CHECK (request_kind IN ('new_candidate', 'edit_image'));

ALTER TABLE icono_generation_requests
  ADD COLUMN request_prompt TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_generation_requests
  ADD COLUMN source_gene_symbol TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_generation_requests
  ADD COLUMN source_asset_sha256 TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_kind
  ON icono_generation_requests (status, request_kind, created_at ASC, id ASC);
