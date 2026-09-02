-- ARCHITECTURE FENCE [IPD-012]: immutable CC0 caretaker terms.
-- Adds terms_2026_09_02_v2: same-day correction of terms_2026_09_02_v1 after
-- owner review (explicit AI-assisted writing permission, positively-framed
-- conduct rules, CC0 display rights after leaving, no product ergonomics in
-- terms). Zero assignments accepted v1, and claim reads choose
-- ORDER BY effective_at DESC, terms_version_id DESC, so v2 wins deterministically.

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
  'terms_2026_09_02_v2',
  'ee68c8a63efa3f4e31d6fbf310903def19db5bbbf8d2e9716c534b3e48019521',
  'https://iconoplasm.brinedew.bio/caretaker-terms',
  'Caretaker terms - 2 September 2026 (v2)',
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
   WHERE terms_version_id = 'terms_2026_09_02_v2'
     AND terms_sha256 = 'ee68c8a63efa3f4e31d6fbf310903def19db5bbbf8d2e9716c534b3e48019521'
     AND document_url = 'https://iconoplasm.brinedew.bio/caretaker-terms'
     AND display_label = 'Caretaker terms - 2 September 2026 (v2)'
     AND effective_at = '2026-09-02T00:00:00.000Z'
     AND retired_at IS NULL
     AND created_by_actor_kind = 'migration'
     AND created_by_account_id IS NULL
) THEN 1 ELSE 0 end;

DROP TABLE icono_caretaker_terms_cc0_seed_guard;
