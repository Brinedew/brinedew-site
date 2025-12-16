const PDB_COVERAGE_THRESHOLD = 0.6;
const SWISS_MODEL_COVERAGE_THRESHOLD = 0.6;
const SWISS_MODEL_QMEAN_THRESHOLD = 0.6;

const deepClone = (value) => JSON.parse(JSON.stringify(value));

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseChainSegments(spec) {
  if (typeof spec !== 'string') {
    return [];
  }
  return spec
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [chainToken, rangeToken] = part.split('=');
      if (!rangeToken) {
        return null;
      }
      const chains = (chainToken || '')
        .split('/')
        .map((c) => c.trim())
        .filter(Boolean);
      if (chains.length === 0) {
        return null;
      }
      const [startToken, endToken] = rangeToken.split('-');
      const start = Number.parseInt(startToken, 10);
      const end = Number.parseInt(endToken, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      const normalizedStart = Math.min(start, end);
      const normalizedEnd = Math.max(start, end);
      return {
        chains,
        start: normalizedStart,
        end: normalizedEnd,
        length: normalizedEnd - normalizedStart + 1
      };
    })
    .filter(Boolean);
}

function computePdbCoverage(structure, proteinLength) {
  if (!structure || !structure.pdb || !structure.pdb.chains) {
    return 0;
  }
  if (!Number.isFinite(proteinLength) || proteinLength <= 0) {
    return 1;
  }
  const segments = parseChainSegments(structure.pdb.chains);
  if (!segments.length) {
    return 0;
  }
  const covered = segments.reduce((sum, segment) => sum + Math.max(0, segment.length || 0), 0);
  return Math.max(0, Math.min(1, covered / proteinLength));
}

function extractSwissQuality(model) {
  if (!model) {
    return null;
  }
  const candidates = [
    model.qmean,
    model.qmeanDisCo_global,
    model.qmean_dis_co_global,
    model.quality && (model.quality.qmeanDisCo_global ?? model.quality.qmean_dis_co_global),
    model.qmean && (model.qmean.qmeanDisCo_global ?? model.qmean.qmean_dis_co_global ?? model.qmean.qmean4_norm_score ?? model.qmean.avg_local_score)
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

function computeSwissCoverage(model, proteinLength) {
  if (!model) {
    return 0;
  }
  if (typeof model.coverage === 'number') {
    return model.coverage;
  }
  if (!Number.isFinite(proteinLength) || proteinLength <= 0) {
    return 0;
  }
  const start = toFiniteNumber(model.uniprot_start ?? model.uniprot_from ?? model.start ?? model.from);
  const end = toFiniteNumber(model.uniprot_end ?? model.uniprot_to ?? model.end ?? model.to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  const span = Math.max(0, normalizedEnd - normalizedStart + 1);
  return Math.max(0, Math.min(1, span / proteinLength));
}

function deriveSwissChainSegments(model) {
  if (!model) {
    return [];
  }
  const chainIds = Array.isArray(model.chain_ids) ? model.chain_ids : [];
  if (!chainIds.length) {
    return [];
  }
  const start = toFiniteNumber(model.uniprot_start);
  const end = toFiniteNumber(model.uniprot_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return [];
  }
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  const length = Math.max(0, normalizedEnd - normalizedStart + 1);
  return [{
    chains: chainIds,
    start: normalizedStart,
    end: normalizedEnd,
    length
  }];
}

function normalizeSwissModel(raw, proteinLength) {
  if (!raw) {
    return null;
  }
  const normalized = { ...raw };
  normalized.coverage = typeof raw.coverage === 'number' ? raw.coverage : computeSwissCoverage(raw, proteinLength);
  normalized.qmean = typeof raw.qmean === 'number' ? raw.qmean : extractSwissQuality(raw);
  const chainCandidates = Array.isArray(raw.chain_ids) && raw.chain_ids.length
    ? raw.chain_ids
    : Array.isArray(raw.chains) && raw.chains.length ? raw.chains.map((c) => c && c.id).filter(Boolean)
    : raw.chain_id ? [raw.chain_id] : [];
  normalized.chain_ids = chainCandidates;
  normalized.uniprot_start = toFiniteNumber(raw.uniprot_start ?? raw.uniprot_from ?? raw.start ?? raw.from);
  normalized.uniprot_end = toFiniteNumber(raw.uniprot_end ?? raw.uniprot_to ?? raw.end ?? raw.to);
  return normalized;
}

export function resolveStructureRepresentation(structure, proteinLength) {
  if (!structure) {
    return null;
  }
  const alphafoldAvailable = Boolean(structure.alphafold && structure.alphafold.model_url);
  const pdbAvailable = Boolean(structure.pdb && structure.pdb.id);
  const swissModel = normalizeSwissModel(structure.swiss_model, proteinLength);
  const swissAvailable = Boolean(swissModel && (swissModel.coordinates_url || swissModel.coordinatesUrl || swissModel.model_url || swissModel.modelcif));
  const coverage = computePdbCoverage(structure, proteinLength);
  const structureId = structure.structure_id || (structure.pdb && structure.pdb.id) || (swissModel && (swissModel.model_id || swissModel.template || swissModel.pdb_id)) || (structure.alphafold && structure.alphafold.id) || '';
  const base = {
    coverage,
    structureId
  };

  const swissRepresentation = swissAvailable ? {
    ...base,
    coverage: typeof swissModel.coverage === 'number' ? swissModel.coverage : base.coverage,
    structureId: structureId || swissModel.model_id || swissModel.template || swissModel.pdb_id || 'SWISS',
    source: 'swissmodel',
    swissModel,
    chains: deriveSwissChainSegments(swissModel)
  } : null;
  const swissQuality = typeof swissModel?.qmean === 'number' ? swissModel.qmean : null;
  const swissAcceptable = Boolean(
    swissRepresentation &&
    swissRepresentation.coverage >= SWISS_MODEL_COVERAGE_THRESHOLD &&
    (typeof swissQuality !== 'number' || swissQuality >= SWISS_MODEL_QMEAN_THRESHOLD)
  );

  if (pdbAvailable && coverage >= PDB_COVERAGE_THRESHOLD) {
    return {
      ...base,
      source: 'pdb',
      pdb: structure.pdb,
      chains: parseChainSegments(structure.pdb && structure.pdb.chains)
    };
  }
  if (swissAcceptable) {
    return swissRepresentation;
  }
  if (alphafoldAvailable) {
    return {
      ...base,
      source: 'alphafold',
      alphafold: structure.alphafold
    };
  }
  if (swissRepresentation) {
    return swissRepresentation;
  }
  if (pdbAvailable) {
    return {
      ...base,
      source: 'pdb',
      pdb: structure.pdb,
      chains: parseChainSegments(structure.pdb && structure.pdb.chains)
    };
  }
  return null;
}

function buildRepresentationFromStoredSource(protein) {
  if (!protein) {
    return null;
  }

  const source = typeof protein.structure_source === 'string'
    ? protein.structure_source.trim().toLowerCase()
    : '';

  if (!source) {
    return null;
  }

  if (source === 'pdb' && protein.pdb_id) {
    const pdbId = String(protein.pdb_id).trim().toUpperCase();
    if (!pdbId) {
      return null;
    }
    return {
      source: 'pdb',
      structureId: pdbId,
      coverage: 1,
      pdb: { id: pdbId },
      chains: []
    };
  }

  if (source === 'swissmodel' && protein.swissmodel_url) {
    return {
      source: 'swissmodel',
      structureId: protein.swissmodel_template ? String(protein.swissmodel_template) : (protein.uniprot ? String(protein.uniprot) : 'SWISS'),
      coverage: typeof protein.swissmodel_coverage === 'number' ? protein.swissmodel_coverage : null,
      swissModel: {
        coordinates_url: protein.swissmodel_url,
        coverage: protein.swissmodel_coverage,
        qmean: protein.swissmodel_qmean,
        template: protein.swissmodel_template
      },
      chains: []
    };
  }

  if (source === 'alphafold' && protein.alphafold_url) {
    const uniprot = protein.uniprot ? String(protein.uniprot).trim().toUpperCase() : '';
    return {
      source: 'alphafold',
      structureId: uniprot || 'Preview',
      coverage: 1,
      alphafold: {
        id: uniprot ? ('AF-' + uniprot + '-F1') : undefined,
        model_url: protein.alphafold_url
      },
      chains: []
    };
  }

  return null;
}

function detectStructureFormat(url, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (typeof url === 'string') {
    const lower = url.toLowerCase();
    if (lower.includes('.cif')) {
      return 'cif';
    }
    if (lower.includes('.bcif')) {
      return 'bcif';
    }
    if (lower.includes('.pdb')) {
      return 'pdb';
    }
  }
  return 'pdb';
}

function coerceProteinStructure(protein) {
  if (!protein) {
    return null;
  }
  if (protein.structure) {
    return protein.structure;
  }

  const uniprot = protein.uniprot;
  const structure = {};

  if (protein.pdb_id) {
    structure.pdb = { id: protein.pdb_id };
  }

  if (protein.alphafold_url) {
    structure.alphafold = {
      id: uniprot ? ('AF-' + uniprot + '-F1') : undefined,
      model_url: protein.alphafold_url
    };
  }

  if (protein.swissmodel_url) {
    structure.swiss_model = {
      coordinates_url: protein.swissmodel_url,
      coverage: protein.swissmodel_coverage,
      qmean: protein.swissmodel_qmean,
      template: protein.swissmodel_template
    };
  }

  return Object.keys(structure).length ? structure : null;
}

export function buildMolstarOptionsFromRepresentation(representation) {
  if (!representation) {
    return null;
  }
  if (representation.source === 'pdb' && representation.pdb && representation.pdb.id) {
    return {
      moleculeId: representation.pdb.id,
      assemblyId: '1',
      customData: {
        url: 'https://files.rcsb.org/download/' + representation.pdb.id + '.cif',
        format: 'cif'
      }
    };
  }
  if (representation.source === 'alphafold' && representation.alphafold && representation.alphafold.model_url) {
    return {
      moleculeId: representation.alphafold.id || representation.structureId || 'Preview',
      customData: {
        url: representation.alphafold.model_url,
        format: detectStructureFormat(representation.alphafold.model_url, representation.alphafold.format)
      }
    };
  }
  if (representation.source === 'swissmodel' && representation.swissModel) {
    const swissUrl = representation.swissModel.coordinates_url || representation.swissModel.coordinatesUrl || representation.swissModel.model_url || representation.swissModel.modelcif;
    if (!swissUrl) {
      return null;
    }
    return {
      moleculeId: representation.swissModel.model_id || representation.swissModel.template || representation.structureId || 'SWISS',
      assemblyId: '1',
      customData: {
        url: swissUrl,
        format: detectStructureFormat(swissUrl, representation.swissModel.format)
      }
    };
  }
  return null;
}

export function buildStructurePreviewPayload(protein) {
  if (!protein) {
    return null;
  }

  // Keep admin preview consistent with the public game: if the DB has an explicit
  // structure_source, use it directly instead of re-running heuristic selection.
  const storedRepresentation = buildRepresentationFromStoredSource(protein);
  const structure = storedRepresentation ? null : coerceProteinStructure(protein);
  const representation = storedRepresentation || resolveStructureRepresentation(structure, protein.length || 0);
  if (!representation) {
    return null;
  }
  const renderOptions = buildMolstarOptionsFromRepresentation(representation);
  if (!renderOptions) {
    return null;
  }
  return {
    representation: {
      ...representation,
      chains: Array.isArray(representation.chains) ? representation.chains : []
    },
    renderOptions
  };
}

export function sanitizeProteinSummary(protein) {
  if (!protein) {
    return null;
  }
  return {
    uniprot: protein.uniprot,
    hgnc: protein.gene || protein.hgnc,  // DB column is 'gene', client expects 'hgnc'
    full_name: protein.full_name,
    length: protein.length
  };
}
