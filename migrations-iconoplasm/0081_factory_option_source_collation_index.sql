-- ARCHITECTURE FENCE [IPD-005] / B-716: the factory rollup matches normalized
-- incoming identities case-insensitively. Its former public_emulsion_code
-- NOCASE index was removed with that duplicate column in 0077, but the new
-- emulsion_id join retained NOCASE. The existing BINARY emulsion index cannot
-- seek that predicate: production scanned 434M rows in 33 updates (2026-08-27).
-- Keep both access paths: ordinary user-emulsion matching is case-sensitive.
-- Removing this index or changing collation requires real EXPLAIN + row-cost
-- proof, not merely a result-equivalence test on two portraits.
CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_factory_emulsion_nocase
ON icono_portrait_assets (emulsion_id COLLATE NOCASE);
