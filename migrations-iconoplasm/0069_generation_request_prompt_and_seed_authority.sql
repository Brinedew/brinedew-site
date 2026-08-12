-- Website "New candidate" requests own their prompt-body and seed policies.
-- They must not inherit mutable workstation batch settings: Tags is the
-- default prompt authority and every requested image receives a fresh seed.

ALTER TABLE icono_generation_requests
  ADD COLUMN prompt_body_mode TEXT NOT NULL DEFAULT 'taggerizer_prompt'
  CHECK (prompt_body_mode IN ('taggerizer_prompt', 'prose_prompt'));

ALTER TABLE icono_generation_requests
  ADD COLUMN seed_mode TEXT NOT NULL DEFAULT 'random'
  CHECK (seed_mode = 'random');
