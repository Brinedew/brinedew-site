-- ARCHITECTURE FENCE [IPD-012]: immutable public caretaker terms seed.
-- A migration actor is recorded directly; no fictitious human account is created.

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
  'terms_2026_08_30_v1',
  '06b27f697c0c9a9fcaaa3ae01014c008aa6d149eed1279afbb75f9d924ed1aa5',
  'https://iconoplasm.brinedew.bio/caretaker-terms',
  'Caretaker terms - 30 August 2026',
  '2026-08-30T00:00:00.000Z',
  'migration',
  NULL,
  '2026-08-30T00:00:00.000Z'
)
ON CONFLICT(terms_version_id) DO NOTHING;

CREATE TABLE icono_caretaker_terms_seed_guard (
  guard INTEGER NOT NULL CHECK (guard = 1)
);

INSERT INTO icono_caretaker_terms_seed_guard (guard)
SELECT case WHEN EXISTS (
  SELECT 1
    FROM icono_caretaker_terms_versions
   WHERE terms_version_id = 'terms_2026_08_30_v1'
     AND terms_sha256 = '06b27f697c0c9a9fcaaa3ae01014c008aa6d149eed1279afbb75f9d924ed1aa5'
     AND document_url = 'https://iconoplasm.brinedew.bio/caretaker-terms'
     AND display_label = 'Caretaker terms - 30 August 2026'
     AND effective_at = '2026-08-30T00:00:00.000Z'
     AND retired_at IS NULL
     AND created_by_actor_kind = 'migration'
     AND created_by_account_id IS NULL
) THEN 1 ELSE 0 end;

DROP TABLE icono_caretaker_terms_seed_guard;

-- ARCHITECTURE FENCE [IPD-012]
