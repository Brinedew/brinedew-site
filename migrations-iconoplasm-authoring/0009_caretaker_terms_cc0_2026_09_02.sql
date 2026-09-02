-- ARCHITECTURE FENCE [IPD-012]: immutable CC0 caretaker terms.
-- Adds terms_2026_09_02_v1 as the newest active version. Existing assignments
-- keep the version they accepted; claim reads choose the newest active
-- effective version. Plain-language rewrite of terms_2026_09_01_v2: same
-- legal substance, no architecture details in operator-facing copy.

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
  'terms_2026_09_02_v1',
  'b02d297f1f745a27328a3a273a63c31c7427393577812d255ce8cdbd0b1021c5',
  'https://iconoplasm.brinedew.bio/caretaker-terms',
  'Caretaker terms - 2 September 2026',
  '2026-09-02T00:00:00.000Z',
  'migration',
  NULL,
  '2026-09-02T00:00:00.000Z'
)
ON CONFLICT(terms_version_id) DO NOTHING;

CREATE TABLE icono_caretaker_terms_cc0_seed_guard (
  guard INTEGER NOT NULL CHECK (guard = 1)
);

INSERT INTO icono_caretaker_terms_cc0_seed_guard (guard)
SELECT case WHEN EXISTS (
  SELECT 1
    FROM icono_caretaker_terms_versions
   WHERE terms_version_id = 'terms_2026_09_02_v1'
     AND terms_sha256 = 'b02d297f1f745a27328a3a273a63c31c7427393577812d255ce8cdbd0b1021c5'
     AND document_url = 'https://iconoplasm.brinedew.bio/caretaker-terms'
     AND display_label = 'Caretaker terms - 2 September 2026'
     AND effective_at = '2026-09-02T00:00:00.000Z'
     AND retired_at IS NULL
     AND created_by_actor_kind = 'migration'
     AND created_by_account_id IS NULL
) THEN 1 ELSE 0 end;

DROP TABLE icono_caretaker_terms_cc0_seed_guard;
