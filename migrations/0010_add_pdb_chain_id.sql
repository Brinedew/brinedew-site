-- Add pdb_chain_id column for the target chain identifier
ALTER TABLE proteins ADD COLUMN pdb_chain_id TEXT;
