-- Migration: 0008 - Add PDB chain ID
-- When PDB structures are protein complexes, we need the chain ID to
-- extract just the target protein using PDBe Model Server.
-- Example: 7E2I is SHH + Dispatched1 complex; we want only Chain G (SHH).

ALTER TABLE proteins ADD COLUMN pdb_chain_id TEXT;
