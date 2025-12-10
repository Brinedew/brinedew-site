-- Migration: 0014 - Add CATH classification columns
-- CATH = Class, Architecture, Topology, Homologous Superfamily
-- These describe the structural fold classification from CATH database

ALTER TABLE proteins ADD COLUMN cath_class TEXT;
ALTER TABLE proteins ADD COLUMN cath_architecture TEXT;
ALTER TABLE proteins ADD COLUMN cath_topology TEXT;
ALTER TABLE proteins ADD COLUMN cath_homologous_superfamily TEXT;
