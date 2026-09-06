-- Canonical selections already validate that the lineage and revision belong
-- to the head's gene. Keep the reselect-before-withdraw/delete fence, using
-- that same authoritative gene identity instead of scanning unrelated heads.
DROP TRIGGER icono_canonical_manifestation_reselect_before_ineligible;
CREATE TRIGGER icono_canonical_manifestation_reselect_before_ineligible
BEFORE UPDATE OF status ON icono_manifestations
WHEN OLD.status = 'active' AND NEW.status <> 'active'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_heads h
    WHERE h.gene_id = OLD.gene_id
      AND h.canonical_manifestation_id = OLD.manifestation_id
  ) THEN RAISE(ABORT, 'canonical_manifestation_must_be_reselected_first') END;
END;

DROP TRIGGER icono_canonical_revision_reselect_before_ineligible;
CREATE TRIGGER icono_canonical_revision_reselect_before_ineligible
BEFORE UPDATE OF status ON icono_manifestation_revision_lifecycle
WHEN OLD.status = 'active' AND NEW.status <> 'active'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_revisions r
    JOIN icono_manifestations m ON m.manifestation_id = r.manifestation_id
    JOIN icono_manifestation_heads h ON h.gene_id = m.gene_id
    WHERE r.manifestation_revision_id = OLD.manifestation_revision_id
      AND h.canonical_revision_id = OLD.manifestation_revision_id
  ) THEN RAISE(ABORT, 'canonical_revision_must_be_reselected_first') END;
END;

DROP TRIGGER icono_canonical_storage_reselect_before_delete;
CREATE TRIGGER icono_canonical_storage_reselect_before_delete
BEFORE DELETE ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_revisions r
    JOIN icono_manifestations m ON m.manifestation_id = r.manifestation_id
    JOIN icono_manifestation_heads h ON h.gene_id = m.gene_id
    WHERE r.manifestation_revision_id = OLD.manifestation_revision_id
      AND h.canonical_revision_id = OLD.manifestation_revision_id
  ) THEN RAISE(ABORT, 'canonical_revision_storage_must_be_reselected_first') END;
END;
