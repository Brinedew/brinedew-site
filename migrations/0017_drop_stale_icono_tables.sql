-- Migration: 0017 - Remove stale Iconoplasm residue from the GeneGuessr D1.
--
-- Architectural choice:
--   GeneGuessr D1 owns GeneGuessr gameplay/reference tables only.
--   Iconoplasm website state lives in the dedicated ICONOPLASM_DB binding.
--
-- Mistake to avoid:
--   Do not recreate icono_* tables in the geneguessr database "just because the
--   worker can see both bindings". Cross-product table drift is how we ended up
--   with two partial sources of truth.

DROP TABLE IF EXISTS icono_publish_events;
DROP TABLE IF EXISTS icono_publish_state;
DROP TABLE IF EXISTS icono_portrait_assets;
