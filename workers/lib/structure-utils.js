function detectStructureFormat(url, fallbackFormat = "pdb") {
  if (typeof url === "string") {
    const lower = url.toLowerCase()
    if (lower.includes(".bcif")) {
      return "bcif"
    }
    if (lower.includes(".pdb")) {
      return "pdb"
    }
    if (lower.includes(".cif")) {
      return "cif"
    }
  }
  return fallbackFormat
}

function sanitizeKeySegment(value) {
  return (value || "unknown").toString().replace(/[^A-Za-z0-9_\-]/g, "_")
}

function resolveStoredSource(protein) {
  if (!protein) {
    return ""
  }
  const explicitSource =
    typeof protein.structure_source === "string"
      ? protein.structure_source.trim().toLowerCase()
      : ""
  if (explicitSource) {
    return explicitSource
  }
  if (protein.pdb_id) {
    return "pdb"
  }
  if (protein.swissmodel_url) {
    return "swissmodel"
  }
  if (protein.alphafold_url) {
    return "alphafold"
  }
  return ""
}

export function buildStructureMetaFromStoredSource(protein) {
  if (!protein) {
    return null
  }

  const source = resolveStoredSource(protein)
  if (!source) {
    return null
  }

  if (source === "pdb" && protein.pdb_id) {
    const pdbId = String(protein.pdb_id).trim().toUpperCase()
    if (!pdbId) {
      return null
    }
    return {
      source: "pdb",
      r2Key: `pdb/${pdbId}.bcif`,
      upstreamUrl: `https://models.rcsb.org/v1/${pdbId}/full?encoding=bcif&copy_all_categories=false`,
      shortLabel: "RCSB PDB",
      displayLabel: `RCSB PDB (${pdbId})`,
      format: "bcif",
      linkUrl: `https://www.rcsb.org/structure/${pdbId}`,
      moleculeId: pdbId,
    }
  }

  if (source === "swissmodel" && protein.swissmodel_url) {
    const url = String(protein.swissmodel_url).trim()
    if (!url) {
      return null
    }
    const uniprot = protein.uniprot ? String(protein.uniprot).trim().toUpperCase() : "unknown"
    const template = protein.swissmodel_template || "model"
    const modelId = `${uniprot}_${template}`
    const format = detectStructureFormat(url, "cif")
    return {
      source: "swissmodel",
      r2Key: `swissmodel/${sanitizeKeySegment(modelId)}.${format}`,
      upstreamUrl: url,
      shortLabel: "SWISS-MODEL",
      displayLabel: `SWISS-MODEL (${modelId})`,
      format,
      linkUrl: null,
      moleculeId: protein.swissmodel_template || "SWISS",
    }
  }

  if (source === "alphafold" && protein.alphafold_url) {
    const url = String(protein.alphafold_url).trim()
    if (!url) {
      return null
    }
    const uniprot = protein.uniprot ? String(protein.uniprot).trim().toUpperCase() : "unknown"
    const format = detectStructureFormat(url, "cif")
    return {
      source: "alphafold",
      r2Key: `alphafold/${sanitizeKeySegment(uniprot)}.${format}`,
      upstreamUrl: url,
      shortLabel: "AlphaFold",
      displayLabel: `AlphaFold (${uniprot})`,
      format,
      linkUrl: uniprot === "unknown" ? null : `https://alphafold.ebi.ac.uk/entry/${uniprot}`,
      moleculeId: uniprot,
    }
  }

  return null
}

export function sanitizeProteinSummary(protein) {
  if (!protein) {
    return null
  }
  return {
    uniprot: protein.uniprot,
    hgnc: protein.gene || protein.hgnc, // DB column is 'gene', client expects 'hgnc'
    gene_surname: protein.gene_surname || null,
    full_name: protein.full_name,
    length: protein.length,
  }
}
