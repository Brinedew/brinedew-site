-- Migration: 0009 - Add PDB chain labels for 3D viewer callouts
-- When showing multi-chain structures (complexes), we want to label each chain
-- so users understand what they're looking at.
-- Format: JSON array like [{"chains":["A","B"],"name":"p53","gene":"TP53","is_target":true},...]

ALTER TABLE proteins ADD COLUMN pdb_chain_labels TEXT;
