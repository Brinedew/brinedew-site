-- B-921: votes are written, elected and versioned in D1 directly (B-898), so
-- nothing reads or writes the vote projection job table. Dropping it drops its
-- one index with it.
DROP TABLE IF EXISTS icono_vote_projection_refresh_jobs;
