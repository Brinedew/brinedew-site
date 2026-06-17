-- Migration: 0013 - Add neighbors column for similarity ladder
-- Stores top-9 most similar proteins as JSON array
-- Format: [{"gene": "HBD", "similarity": 0.9288}, ...]

ALTER TABLE proteins ADD COLUMN neighbors TEXT;
