-- ARCHITECTURE FENCE [IPD-012]: immutable CC0 caretaker terms.
-- Adds terms_2026_09_02_v3 after owner review of terms_2026_09_02_v2: the
-- document is now assembled sentence-by-sentence from established boilerplate
-- (CC0 1.0 Universal legal code and deed; Reddit User Agreement and Rules;
-- Hugging Face Terms of Service) with only nouns substituted. Product
-- mechanics and improvised prose were removed. Zero assignments accepted v1
-- or v2; claim reads choose the newest active effective version
-- (ORDER BY effective_at DESC, terms_version_id DESC), so v3 wins
-- deterministically.

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
  'terms_2026_09_02_v3',
  '0f87f17b93b0103e92f0503ab4ecfc000ed76280eb9197eaa09d977c2cbb1f76',
  'https://iconoplasm.brinedew.bio/caretaker-terms',
  'Caretaker terms - 2 September 2026 (v3)',
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
   WHERE terms_version_id = 'terms_2026_09_02_v3'
     AND terms_sha256 = '0f87f17b93b0103e92f0503ab4ecfc000ed76280eb9197eaa09d977c2cbb1f76'
     AND document_url = 'https://iconoplasm.brinedew.bio/caretaker-terms'
     AND display_label = 'Caretaker terms - 2 September 2026 (v3)'
     AND effective_at = '2026-09-02T00:00:00.000Z'
     AND retired_at IS NULL
     AND created_by_actor_kind = 'migration'
     AND created_by_account_id IS NULL
) THEN 1 ELSE 0 end;

DROP TABLE icono_caretaker_terms_cc0_seed_guard;
