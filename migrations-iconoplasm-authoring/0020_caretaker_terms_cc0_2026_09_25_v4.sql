-- ARCHITECTURE FENCE [IPD-012]: immutable CC0 caretaker terms.
-- Adds terms_2026_09_25_v4 (B-860). New sentences are copied, not drafted:
-- the Editing section is Wikipedia's WP:OWN nutshell plus its edit notice,
-- and Leaving is Wikipedia's courtesy-vanishing wording. Assignments that
-- accepted v3 keep their recorded version; new claims read the newest
-- active effective version, so v4 wins.

INSERT INTO icono_caretaker_terms_versions (
  terms_version_id,
  terms_sha256,
  document_url,
  display_label,
  effective_at,
  created_by_actor_kind,
  created_by_account_id,
  created_at
) VALUES (
  'terms_2026_09_25_v4',
  'bbaab1561315c613282cc07a1b554f769f52c03862a443f87436b420991a308d',
  'https://iconoplasm.brinedew.bio/caretaker-terms',
  'Caretaker terms - 25 September 2026 (v4)',
  '2026-09-25T00:00:00.000Z',
  'migration',
  NULL,
  '2026-09-25T00:00:00.000Z'
)
ON CONFLICT(terms_version_id) DO NOTHING;

CREATE TABLE icono_caretaker_terms_cc0_seed_guard (
  guard INTEGER NOT NULL CHECK (guard = 1)
);

INSERT INTO icono_caretaker_terms_cc0_seed_guard (guard)
SELECT case WHEN EXISTS (
  SELECT 1
    FROM icono_caretaker_terms_versions
   WHERE terms_version_id = 'terms_2026_09_25_v4'
     AND terms_sha256 = 'bbaab1561315c613282cc07a1b554f769f52c03862a443f87436b420991a308d'
     AND document_url = 'https://iconoplasm.brinedew.bio/caretaker-terms'
     AND display_label = 'Caretaker terms - 25 September 2026 (v4)'
     AND effective_at = '2026-09-25T00:00:00.000Z'
     AND retired_at IS NULL
     AND created_by_actor_kind = 'migration'
     AND created_by_account_id IS NULL
) THEN 1 ELSE 0 end;

DROP TABLE icono_caretaker_terms_cc0_seed_guard;
