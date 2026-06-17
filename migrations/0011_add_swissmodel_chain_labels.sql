-- Migration: 0011 - Add Swiss-Model chain labels for 3D viewer callouts (B-172)
-- Swiss-Model homology models can be multi-chain (homomers, heteromers)
-- Format: JSON array like [{"chains":["A","B"],"name":"KCNJ3","gene":"KCNJ3","is_target":true},...]

ALTER TABLE proteins ADD COLUMN swissmodel_chain_labels TEXT;
