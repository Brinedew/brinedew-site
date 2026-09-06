-- Cold deployments require the generation fence before accepting vote work.
-- Older Workers added this column at runtime. The reviewed release adapter
-- verifies that legacy shape and journals it without resetting its versions.
ALTER TABLE icono_vote_projection_refresh_jobs
ADD COLUMN job_version INTEGER NOT NULL DEFAULT 1;
