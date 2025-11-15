/**
 * Geneguessr - Daily Protein Guessing Game
 * 
 * Static implementation with:
 * - Date-based daily selection
 * - Autocomplete for protein guessing
 * - Progressive hint unlocking
 * - Similarity scoring (GO, domains, length, flags)
 * - Share functionality
 */

(function() {
  'use strict';

  const GENEGUESSR_STATUS_ATTR = 'data-geneguessr-status';
  const GENEGUESSR_ROOT_ID = 'geneguessr-root';
  const PDB_COVERAGE_THRESHOLD = 0.6;
  const SWISS_MODEL_COVERAGE_THRESHOLD = 0.6;
  const SWISS_MODEL_QMEAN_THRESHOLD = 0.7;
  const ACCENT_COLOR_HEX = '#1b7269';
  const LIGHT_NEUTRAL_GRAY_HEX = '#ab9b8f';
  const DARK_NEUTRAL_GRAY_HEX = '#87776d';

  function setStatus(status) {
    try {
      window.__geneguessrStatus = status;
      console.info(`[Geneguessr] ${status}`);
      if (document && document.body) {
        document.body.setAttribute(GENEGUESSR_STATUS_ATTR, status);
      }
    } catch {
      // ignore status update failures
    }
  }

  function reportError(status, detail) {
    setStatus(status);
    try {
      const root = document.getElementById(GENEGUESSR_ROOT_ID);
      if (root) {
        const extra = detail ? `\n${detail}` : '';
        root.innerHTML =
          `<pre class="pg-debug" style="white-space:pre-wrap;border:1px solid #d33;background:#2b0d0d;color:#ffecec;padding:1rem;border-radius:8px;">` +
          `Geneguessr encountered a problem:\n${status}${extra}</pre>`;
      }
    } catch {
      // ignore DOM write failures
    }
  }

  setStatus('script-loaded');

  window.addEventListener('error', (event) => {
    const message = event?.message ?? 'Unknown runtime error';
    reportError('runtime-error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message =
      (reason && reason.message) ||
      (typeof reason === 'string' ? reason : JSON.stringify(reason ?? null));
    reportError('unhandled-rejection', message);
  });

  function hasStructureData(protein) {
    if (!protein) {
      return false;
    }
    if (protein.structure_id) {
      return true;
    }
    const structure = protein.structure;
    return Boolean(
      structure &&
      (
        structure.primary_source ||
        (structure.pdb && structure.pdb.id) ||
        (structure.swiss_model && structure.swiss_model.coordinates_url) ||
        (structure.alphafold && structure.alphafold.model_url)
      )
    );
  }

  function getStructureMetaLabel(structure) {
    if (!structure) {
      return '';
    }
    const swissModel = structure.swiss_model;
    if (structure.primary_source === 'pdb' && structure.structure_id) {
      const resolution = structure.pdb && typeof structure.pdb.resolution === 'number'
        ? `${structure.pdb.resolution.toFixed(2)} A`
        : (structure.pdb && structure.pdb.resolution_raw) || '';
      return resolution ? `PDB - ${resolution}` : 'PDB';
    }
    if (structure.primary_source === 'swissmodel' && swissModel) {
      return formatSwissLabel(swissModel);
    }
    if (structure.primary_source === 'alphafold' && structure.alphafold && structure.alphafold.id) {
      return 'AlphaFold';
    }
    if (swissModel) {
      return formatSwissLabel(swissModel);
    }
    if (structure.pdb && structure.pdb.id) {
      const resolution = typeof structure.pdb.resolution === 'number'
        ? `${structure.pdb.resolution.toFixed(2)} A`
        : structure.pdb.resolution_raw || '';
      return resolution ? `PDB - ${resolution}` : 'PDB';
    }
    if (structure.alphafold && structure.alphafold.id) {
      return 'AlphaFold';
    }
    return '';
  }

  function formatSwissLabel(model) {
    if (!model) {
      return 'SWISS-MODEL';
    }
    const labelId = model.model_id || model.template || model.pdb_id || 'SWISS-MODEL';
    const coveragePart = typeof model.coverage === 'number'
      ? `${Math.round(model.coverage * 100)}%`
      : '';
    const qmeanPart = typeof model.qmean === 'number'
      ? `QMEAN ${model.qmean.toFixed(2)}`
      : '';
    const extras = [coveragePart, qmeanPart].filter(Boolean).join(', ');
    return extras ? `SWISS-MODEL (${extras})` : 'SWISS-MODEL';
  }

  function resolveStructureRepresentation(structure, proteinLength) {
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

  function escapeAttribute(value) {
    if (value == null) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getStructureSourceMetadataFromRepresentation(representation) {
    if (!representation || !representation.source) {
      return null;
    }
    if (representation.source === 'pdb' && representation.pdb) {
      const id = representation.pdb.id;
      const label = id ? `PDB (${id})` : 'PDB';
      const url = representation.pdb.url || (id ? `https://www.rcsb.org/structure/${id}` : null);
      return { label, url };
    }
    if (representation.source === 'swissmodel' && representation.swissModel) {
      const label = 'SWISS-MODEL';
      const url = representation.swissModel.model_url || representation.swissModel.coordinates_url || null;
      return { label, url };
    }
    if (representation.source === 'alphafold' && representation.alphafold) {
      const label = 'AlphaFold';
      const url = representation.alphafold.viewer_url || representation.alphafold.model_url || null;
      return { label, url };
    }
    return null;
  }

  function buildRepresentationFromStructure(structure, proteinLength, preferredSource) {
    if (!structure || !preferredSource) {
      return null;
    }
    if (preferredSource === 'pdb' && structure.pdb && structure.pdb.id) {
      const coverage = computePdbCoverage(structure, proteinLength);
      return {
        source: 'pdb',
        pdb: structure.pdb,
        coverage,
        structureId: structure.pdb.id,
        chains: parseChainSegments(structure.pdb.chains)
      };
    }
    if (preferredSource === 'swissmodel' && structure.swiss_model) {
      const swissModel = normalizeSwissModel(structure.swiss_model, proteinLength);
      if (!swissModel) {
        return null;
      }
      return {
        source: 'swissmodel',
        swissModel,
        coverage: typeof swissModel.coverage === 'number' ? swissModel.coverage : 0,
        structureId: swissModel.model_id || swissModel.template || swissModel.pdb_id || 'SWISS',
        chains: deriveSwissChainSegments(swissModel)
      };
    }
    if (preferredSource === 'alphafold' && structure.alphafold && structure.alphafold.model_url) {
      return {
        source: 'alphafold',
        alphafold: structure.alphafold,
        coverage: 1,
        structureId: structure.alphafold.id || structure.alphafold.model_url
      };
    }
    return null;
  }

  function getRepresentationCandidates(structure, proteinLength) {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (rep) => {
      if (!rep || !rep.source) {
        return;
      }
      const key = `${rep.source}|${rep.structureId || ''}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push(rep);
    };
    const preferred = resolveStructureRepresentation(structure, proteinLength);
    if (preferred) {
      pushCandidate(preferred);
    }
    ['pdb', 'swissmodel', 'alphafold'].forEach((source) => {
      const rep = buildRepresentationFromStructure(structure, proteinLength, source);
      pushCandidate(rep);
    });
    return candidates;
  }

  function resolveProteinStructure(protein) {
    if (!protein || !protein.structure) {
      return null;
    }
    return resolveStructureRepresentation(protein.structure, protein.length);
  }

  function getStructureSourceInfo(protein) {
    const representation = resolveProteinStructure(protein);
    if (!representation) {
      return null;
    }
    const meta = getStructureSourceMetadataFromRepresentation(representation);
    if (meta) {
      return { source: representation.source, label: meta.label, url: meta.url, representation };
    }
    return { source: representation.source, label: representation.source, representation };
  }

  function isAlphaFoldOnlyProtein(protein) {
    if (!protein) {
      return false;
    }
    const resolved = resolveProteinStructure(protein);
    return Boolean(resolved && resolved.source === 'alphafold');
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
    if (segments.length === 0) {
      return 0;
    }
    const coveredResidues = segments.reduce((sum, segment) => {
      return sum + Math.max(0, segment.length || 0);
    }, 0);
    return Math.max(0, Math.min(1, coveredResidues / proteinLength));
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
    return chainIds.map((chainId) => ({
      chains: [chainId],
      start: normalizedStart,
      end: normalizedEnd,
      length
    }));
  }

  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function buildMolstarOptionsFromRepresentation(representation, overrides = {}) {
    if (!representation) {
      return null;
    }
    if (representation.source === 'pdb' && representation.pdb && representation.pdb.id) {
      const obj = {
        moleculeId: representation.pdb.id,
        assemblyId: '1',
        customData: {
          url: `${RCSB_PDB_DOWNLOAD_URL}${representation.pdb.id}.cif`,
          format: 'cif'
        }
      };
      applyStructureOverrides(obj, overrides);
      return obj;
    }
    if (representation.source === 'alphafold' && representation.alphafold && representation.alphafold.model_url) {
      const obj = {
        moleculeId: representation.alphafold.id || representation.structureId || 'structure',
        customData: {
          url: representation.alphafold.model_url,
          format: 'cif'
        }
      };
      applyStructureOverrides(obj, overrides);
      return obj;
    }
    if (representation.source === 'swissmodel' && representation.swissModel) {
      const swissUrl = representation.swissModel.coordinates_url || representation.swissModel.coordinatesUrl || representation.swissModel.model_url || representation.swissModel.modelcif;
      if (!swissUrl) {
        return null;
      }
      const obj = {
        moleculeId: representation.swissModel.model_id || representation.swissModel.template || representation.structureId || 'SWISS',
        assemblyId: '1',
        customData: {
          url: swissUrl,
          format: detectStructureFormat(swissUrl, representation.swissModel.format)
        }
      };
      applyStructureOverrides(obj, overrides);
      return obj;
    }
    return null;
  }

  function applyStructureOverrides(option, overrides) {
    if (!option || !option.customData || !overrides) {
      return;
    }
    if (overrides.structureToken) {
      option.customData.url = `${API_BASE}/api/structure?token=${overrides.structureToken}`;
      if (overrides.format) {
        option.customData.format = overrides.format;
      }
    }
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
    }
    return 'pdb';
  }

  async function ensureStructureTokenForTarget() {
    if (targetStructureInfo && targetStructureInfo.token) {
      return targetStructureInfo;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/structure-token?type=target`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        throw new Error(`Token request failed: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data || !data.token) {
        throw new Error('Missing token in response');
      }
      targetStructureInfo = {
        token: data.token,
        sourceLabel: data.sourceLabel || 'Source unavailable'
      };
      return targetStructureInfo;
    } catch (err) {
      console.warn('Geneguessr: failed to fetch target structure token', err);
      targetStructureInfo = null;
      return null;
    }
  }

  async function ensureStructureTokenForProtein(uniprot) {
    if (!uniprot) {
      return null;
    }
    const key = String(uniprot).toUpperCase();
    const cached = structureTokenCache.get(key);
    if (cached && cached.token) {
      return cached;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/structure-token?uniprot=${encodeURIComponent(key)}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        throw new Error(`Token request failed: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data || !data.token) {
        throw new Error('Missing token in response');
      }
      const info = {
        token: data.token,
        sourceLabel: data.sourceLabel || 'Source unavailable',
        displayLabel: data.displayLabel || data.sourceLabel || 'Source unavailable'
      };
      structureTokenCache.set(key, info);
      return info;
    } catch (err) {
      console.warn('Geneguessr: failed to fetch structure token for', key, err);
      structureTokenCache.set(key, null);
      return null;
    }
  }

  function getStructureInfoForProtein(uniprot) {
    if (!uniprot) {
      return null;
    }
    return structureTokenCache.get(String(uniprot).toUpperCase()) || null;
  }

  function getTargetStructureInfo() {
    return targetStructureInfo;
  }

  async function hydrateStructureTokensForGuesses(guessEntries) {
    if (!Array.isArray(guessEntries) || guessEntries.length === 0) {
      return;
    }
    const tasks = guessEntries
      .map((entry) => entry?.uniprot)
      .filter(Boolean)
      .map((uniprot) => ensureStructureTokenForProtein(uniprot));
    await Promise.all(tasks);
  }

  function renderStructureViewer(protein, viewerId, options = {}) {
    if (!protein || !hasStructureData(protein)) {
      return '';
    }
    const linkable = Boolean(options.linkable);
    const structureInfo = options.structureInfo || null;
    const structureSource = getStructureSourceInfo(protein);
    if (structureInfo) {
      viewerStructureInfo.set(viewerId, structureInfo);
    } else {
      viewerStructureInfo.delete(viewerId);
    }
    const linkableAttr = ` data-source-linkable="${linkable ? 'true' : 'false'}"`;
    const shortLabel = structureInfo?.sourceLabel || structureSource?.label || 'Source unavailable';
    const longLabel = structureInfo?.displayLabel || structureSource?.label || shortLabel;
    const displayLabel = linkable ? longLabel : shortLabel;
    const linkUrl = linkable ? structureSource?.url : null;
    const escapedLabel = escapeAttribute(displayLabel);
    const sourceText = linkable && linkUrl
      ? `Source: <a href="${escapeAttribute(linkUrl)}" target="_blank" rel="noopener" class="pg-structure-source-link">${escapedLabel}</a>`
      : `Source: ${escapedLabel}`;
    
    return `
      <div class="pg-card-structure">
        <div class="pg-card-structure-viewer" id="${viewerId}" role="region" aria-label="3D structure viewer">
          <div class="pg-structure-placeholder" id="${viewerId}-placeholder" hidden>
            <p class="pg-structure-tip">Loading structure.</p>
          </div>
          <div class="pg-structure-loading" id="${viewerId}-loading" hidden>Loading viewer.</div>
          <div class="pg-structure-error" id="${viewerId}-error" hidden></div>
        </div>
        <div class="pg-structure-source" id="${viewerId}-source"${linkableAttr}>
          ${sourceText}
        </div>
      </div>
    `;
  }

  function updateStructureSourceDisplay(containerId, metadata) {
    const sourceEl = document.getElementById(`${containerId}-source`);
    if (!sourceEl) {
      return;
    }
    const linkable = sourceEl.dataset.sourceLinkable === 'true';
    const fallbackLabel = metadata?.label || 'Source unavailable';
    const shortLabel = metadata?.shortLabel || fallbackLabel;
    const longLabel = metadata?.longLabel || fallbackLabel;
    const label = linkable ? (longLabel || shortLabel) : shortLabel;
    const safeLabel = escapeAttribute(label);
    const safeUrl = linkable && metadata?.linkUrl ? escapeAttribute(metadata.linkUrl) : null;
    const inner = linkable && safeUrl
      ? `Source: <a href="${safeUrl}" target="_blank" rel="noopener" class="pg-structure-source-link">${safeLabel}</a>`
      : `Source: ${safeLabel}`;
    sourceEl.innerHTML = inner;
  }

  function renderStructureHint() {
    // Legacy function - no longer used in layout
    return '';
  }

  function setupStructureInteractions() {
    // Auto-load structure viewer for clue card if present
    const clueViewer = document.getElementById('pg-clue-structure');
    if (clueViewer && hasStructureData(targetProtein) && !renderedViewers.has('pg-clue-structure')) {
      loadStructureViewerInContainer(clueViewer, targetProtein).catch((err) => {
        console.error('Geneguessr: failed to load clue structure viewer', err);
      });
    }
    
    // Auto-load structure viewer for solution card if present (game over)
    const solutionViewer = document.getElementById('pg-solution-card-structure');
    const solutionTarget = targetReveal || targetProtein;
    if (solutionViewer && hasStructureData(solutionTarget) && !renderedViewers.has('pg-solution-card-structure')) {
      loadStructureViewerInContainer(solutionViewer, solutionTarget).catch((err) => {
        console.error('Geneguessr: failed to load solution structure viewer', err);
      });
    }
    
    // Auto-load structure viewers for guess cards if present
    gameState.guesses.forEach((guess) => {
      const viewerId = `guess-card-${guess.guessId}-structure`;
      const container = document.getElementById(viewerId);
      const guessProtein = guess.proteinResolved || guess.protein;
      if (container && hasStructureData(guessProtein) && !renderedViewers.has(viewerId)) {
        loadStructureViewerInContainer(container, guessProtein).catch((err) => {
          console.error(`Geneguessr: failed to load structure viewer for guess ${guess.guessId}`, err);
        });
      }
    });
  }

  function addMolstarPreconnectOnce() {
    if (molstarPreconnectAdded) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = MOLSTAR_PRECONNECT_URL;
    link.crossOrigin = '';
    document.head.appendChild(link);
    molstarPreconnectAdded = true;
  }

  function appendMolstarCssOnce() {
    if (molstarCssLoaded) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MOLSTAR_CSS_URL;
    link.onload = () => {
      molstarCssLoaded = true;
    };
    link.onerror = () => {
      console.warn('Geneguessr: failed to load Mol* CSS from jsDelivr');
    };
    document.head.appendChild(link);
    molstarCssLoaded = true;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = (err) => reject(err || new Error(`Failed to load script ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureMolstarAssets() {
    addMolstarPreconnectOnce();
    appendMolstarCssOnce();
    
    if (window.PDBeMolstarPlugin) {
      return;
    }
    if (!molstarLoaderPromise) {
      molstarLoaderPromise = (async () => {
        try {
          await loadScriptOnce(MOLSTAR_SCRIPT_URL);
        } catch (primaryErr) {
          console.warn('Geneguessr: primary Mol* CDN load failed, trying fallback version', primaryErr);
          await loadScriptOnce(MOLSTAR_FALLBACK_SCRIPT_URL);
        }
        if (!window.PDBeMolstarPlugin) {
          throw new Error('PDBeMolstarPlugin unavailable after loading scripts');
        }
      })().catch((err) => {
        molstarLoaderPromise = null;
        throw err;
      });
    }
    return molstarLoaderPromise;
  }

  function isDarkMode() {
    return document.documentElement.classList.contains('dark') || 
           document.body.classList.contains('dark') ||
           (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function toMolstarColor(rgb) {
    const sanitize = (value) => {
      if (!rgb || typeof value === 'undefined') {
        return 0;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    const convert = (value) => {
      const rounded = Math.round(sanitize(value));
      if (!COLOR_CLAMPING_ENABLED) {
        return rounded;
      }
      return Math.max(0, Math.min(255, rounded));
    };
    const r = convert(rgb?.r);
    const g = convert(rgb?.g);
    const b = convert(rgb?.b);
    return (r << 16) | (g << 8) | b;
  }

  function parseColorString(value, fallback) {
    if (!value) return fallback;
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return fallback;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
    };
  }

  function getViewerThemeColors(container) {
    const defaultLightBg = { r: 248, g: 241, b: 231 };
    const defaultDarkBg = { r: 17, g: 12, b: 10 };
    const defaultLightOutline = defaultLightBg;
    const defaultDarkOutline = defaultDarkBg;
    if (!container) {
      return {
        background: isDarkMode() ? defaultDarkBg : defaultLightBg,
        outline: isDarkMode() ? defaultDarkOutline : defaultLightOutline,
      };
    }
    try {
      const style = window.getComputedStyle(container);
      const bg = parseColorString(style.backgroundColor, null);
      const outlineCandidate = parseColorString(style.color, null);
      const outline = isDarkMode()
        ? (outlineCandidate || defaultDarkOutline)
        : (outlineCandidate || defaultLightOutline);
      if (bg) {
        return {
          background: bg,
          outline,
        };
      }
    } catch {
      // ignore and fall through
    }
    return {
      background: isDarkMode() ? defaultDarkBg : defaultLightBg,
      outline: isDarkMode() ? defaultDarkOutline : defaultLightOutline,
    };
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string') {
      return null;
    }
    const normalized = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return null;
    }
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    };
  }

  function resolveViewerColors(container) {
    const defaults = getViewerThemeColors(container);
    if (!GRAPHICS_SETTINGS || !GRAPHICS_SETTINGS.background) {
      return defaults;
    }
    const mode = GRAPHICS_SETTINGS.background.mode || 'auto';
    if (mode === 'dark') {
      const dark = hexToRgb(GRAPHICS_SETTINGS.background.dark);
      return dark ? { background: dark, outline: defaults.outline } : defaults;
    }
    if (mode === 'light') {
      const light = hexToRgb(GRAPHICS_SETTINGS.background.light);
      return light ? { background: light, outline: defaults.outline } : defaults;
    }
    if (mode === 'custom') {
      const custom = hexToRgb(GRAPHICS_SETTINGS.background.custom);
      return custom ? { background: custom, outline: defaults.outline } : defaults;
    }
    return defaults;
  }

  function getAccentColorRgb() {
    return resolveCssColorValue('var(--accent)') || hexToRgb(ACCENT_COLOR_HEX) || { r: 27, g: 114, b: 105 };
  }

  function getNeutralChainColor(container) {
    const fallbackHex = isDarkMode() ? DARK_NEUTRAL_GRAY_HEX : LIGHT_NEUTRAL_GRAY_HEX;
    const fromVar = resolveCssColorValue('var(--gray)');
    if (fromVar) {
      return fromVar;
    }
    if (container && window.getComputedStyle) {
      const computed = window.getComputedStyle(container).color;
      const parsed = parseColorString(computed, null);
      if (parsed) {
        return parsed;
      }
    }
    return hexToRgb(fallbackHex);
  }

  function resolveCssColorValue(value) {
    if (!value || !document || !document.body) {
      return null;
    }
    try {
      const probe = document.createElement('span');
      probe.style.position = 'absolute';
      probe.style.opacity = '0';
      probe.style.pointerEvents = 'none';
      probe.style.color = value;
      document.body.appendChild(probe);
      const computed = window.getComputedStyle(probe).color;
      probe.remove();
      return parseColorString(computed, null);
    } catch (err) {
      console.warn('Geneguessr: unable to resolve CSS color', err);
      return null;
    }
  }

  async function applyChainColoring(viewer, representation, container) {
    if (!viewer?.visual?.select || !representation || (representation.source !== 'pdb' && representation.source !== 'swissmodel')) {
      return;
    }
    const highlightData = buildChainHighlightData(representation, getAccentColorRgb());
    if (!highlightData.length) {
      return;
    }
    const structureId = representation.structureId || (representation.pdb && representation.pdb.id);
    if (!structureId) {
      return;
    }
    const neutralColor = getNeutralChainColor(container) || hexToRgb(DARK_NEUTRAL_GRAY_HEX);
    try {
      await viewer.visual.select({
        data: highlightData,
        nonSelectedColor: {
          r: Math.round(neutralColor.r || 0),
          g: Math.round(neutralColor.g || 0),
          b: Math.round(neutralColor.b || 0)
        },
        structureId: structureId
      });
    } catch (err) {
      console.warn('Geneguessr: failed to apply chain coloring', err);
    }
  }

  function buildChainHighlightData(representation, accentRgb) {
    if (!representation || !accentRgb) {
      return [];
    }
    let segments = [];
    if (representation.source === 'pdb') {
      segments = representation.chains && representation.chains.length > 0
        ? representation.chains
        : parseChainSegments(representation.pdb && representation.pdb.chains);
    } else if (representation.source === 'swissmodel') {
      segments = representation.chains && representation.chains.length > 0
        ? representation.chains
        : deriveSwissChainSegments(representation.swissModel);
    }
    if (!segments || segments.length === 0) {
      return [];
    }
    const normalizedColor = {
      r: Math.round(accentRgb.r || 0),
      g: Math.round(accentRgb.g || 0),
      b: Math.round(accentRgb.b || 0)
    };
    const data = [];
    segments.forEach((segment) => {
      if (!segment || !Array.isArray(segment.chains)) {
        return;
      }
      segment.chains.forEach((chainId) => {
        if (!chainId) {
          return;
        }
        data.push({
          auth_asym_id: chainId,
          start_residue_number: segment.start,
          end_residue_number: segment.end,
          color: normalizedColor
        });
      });
    });
    return data;
  }

  function getHintsBalance() {
    return typeof gameStatus?.hintBalance === 'number' ? gameStatus.hintBalance : 0;
  }
  
  function updateHintDisplays(explicitValue) {
    const value = typeof explicitValue === 'number' ? explicitValue : getHintsBalance();
    document.querySelectorAll('.pg-hints-value, .pg-sidebar-hints').forEach((el) => {
      el.textContent = value;
    });
  }
  
  async function requestHintReveal(hintId) {
    if (!hintId) {
      return true;
    }
    try {
      const payload = await revealHintRequest(hintId);
      hydrateStateFromPayload(payload);
      updateHintDisplays();
      render();
      return true;
    } catch (err) {
      console.warn('Geneguessr: hint reveal failed', err);
      flashHintsWarning();
      return false;
    }
  }

  function flashHintsWarning() {
    const meter = document.querySelector('.pg-hints');
    if (!meter) return;
    meter.classList.add('pg-hints--warn');
    setTimeout(() => meter.classList.remove('pg-hints--warn'), 600);
  }

  function safeApplyCanvasProps(viewer, props, label) {
    if (!viewer?.plugin?.canvas3d) {
      console.warn(`[GeneGuessr] canvas3d unavailable; cannot apply ${label}`);
      return false;
    }
    try {
      viewer.plugin.canvas3d.setProps(props);
      console.info(`[GeneGuessr] Applied viewer setting: ${label}`);
      return true;
    } catch (err) {
      console.warn(`[GeneGuessr] Failed to apply ${label}`, err);
      return false;
    }
  }

  let activeViewerInstance = null;
  let themeSyncInitialized = false;
  const activeViewers = new Map(); // Track all active viewers by container ID

  function hideMolstarPanels(viewer) {
    try {
      viewer.plugin?.layout?.setProps?.({
        isExpanded: false,
        showControls: false,
      });
    } catch (err) {
      console.warn('Geneguessr: unable to hide Mol* layout controls', err);
    }
  }

  // Debug flags for viewer stylization (can be disabled via URL params)
  // Graphics settings loaded from admin panel
  let GRAPHICS_SETTINGS = null;
  const numericOr = (value, fallback) => (typeof value === 'number' ? value : fallback);
  let DEBUG_STYLIZATION = {
    hideAxes: true,
    orthographic: false,
    backgroundColor: true,
    lighting: false,
    occlusion: false,
    antialiasing: true,
    fog: true,
    outline: true,
    disableMarking: true,
  };
  
  // Fetch graphics settings from API and update DEBUG_STYLIZATION
  fetch('https://geneguessr-api.decap.workers.dev/api/graphics-settings', {
    credentials: 'include'
  })
    .then(response => response.ok ? response.json() : null)
    .then(settings => {
      if (settings) {
        GRAPHICS_SETTINGS = settings;
        DEBUG_STYLIZATION.hideAxes = !(settings.extras && settings.extras.hideAxes === false);
        DEBUG_STYLIZATION.orthographic = settings.camera && settings.camera.mode === 'orthographic';
        DEBUG_STYLIZATION.backgroundColor = true;
        DEBUG_STYLIZATION.lighting = !(settings.lighting && settings.lighting.enabled === false);
        DEBUG_STYLIZATION.occlusion = !(settings.occlusion && settings.occlusion.enabled === false);
        DEBUG_STYLIZATION.antialiasing = settings.antialiasing && settings.antialiasing.mode === 'fxaa';
        DEBUG_STYLIZATION.fog = !(settings.fog && settings.fog.enabled === false);
        DEBUG_STYLIZATION.outline = !(settings.outline && settings.outline.enabled === false);
        DEBUG_STYLIZATION.disableMarking = !(settings.extras && settings.extras.disableMarking === false);
        console.info('[GeneGuessr] Loaded graphics settings from admin panel:', settings);
      }
    })
    .catch(err => console.warn('[GeneGuessr] Failed to load graphics settings, using defaults:', err));

  // Parse URL params for debug flags (e.g., ?debug_viewer&no_occlusion&no_outline)
  const urlParams = new URLSearchParams(window.location.search);
  const COLOR_CLAMPING_ENABLED = !urlParams.has('no_color_clamp');

  if (urlParams.has('debug_viewer')) {
    Object.keys(DEBUG_STYLIZATION).forEach(key => {
      if (urlParams.has(`no_${key}`)) {
        DEBUG_STYLIZATION[key] = false;
        console.info(`[GeneGuessr] Debug: disabled ${key}`);
      }
      if (urlParams.has(`with_${key}`)) {
        DEBUG_STYLIZATION[key] = true;
        console.info(`[GeneGuessr] Debug: enabled ${key}`);
      }
    });
  }

  function applyViewerThemeColors(viewer, container) {
    const theme = resolveViewerColors(container);
    safeApplyCanvasProps(viewer, {
      renderer: {
        backgroundColor: toMolstarColor(theme.background),
        ambientColor: toMolstarColor(theme.background),
        ambientIntensity: 0.55,
        interiorDarkening: 0,
      }
    }, 'theme background & ambient colors');
  }

  function ensureThemeSync() {
    if (themeSyncInitialized) return;
    const handleThemeChange = () => {
      // Update all active viewers
      activeViewers.forEach((viewer, containerId) => {
        const container = document.getElementById(containerId);
        if (container && viewer) {
          applyViewerThemeColors(viewer, container);
        }
      });
    };

    const observer = new MutationObserver(handleThemeChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media && media.addEventListener) {
        media.addEventListener('change', handleThemeChange);
      } else if (media && media.addListener) {
        media.addListener(handleThemeChange);
      }
    } catch {
      // ignore
    }

    themeSyncInitialized = true;
  }

  async function applyViewerStylizationProfile(viewer, container) {
    ensureThemeSync();
    activeViewerInstance = viewer;
    
    // Register this viewer for theme updates
    if (container && container.id) {
      activeViewers.set(container.id, viewer);
    }

    // Apply UI hiding and interactivity suppression immediately (these are safe)
    hideMolstarPanels(viewer);
    suppressViewerInteractivity(viewer);
    applyViewerThemeColors(viewer, container);

    // Define stylization steps to apply sequentially with delays
    const steps = [
      { name: 'hideAxes', enabled: DEBUG_STYLIZATION.hideAxes, fn: () => safeApplyCanvasProps(viewer, { camera: { helper: { axes: { name: 'off' } } } }, 'axis helper'), delay: 100 },
      { name: 'orthographic', enabled: DEBUG_STYLIZATION.orthographic, fn: () => safeApplyCanvasProps(viewer, { camera: { mode: 'orthographic' } }, 'orthographic camera'), delay: 150 },
      { name: 'backgroundColor', enabled: DEBUG_STYLIZATION.backgroundColor, fn: () => applyViewerThemeColors(viewer, container), delay: 150 },
      { name: 'lighting', enabled: DEBUG_STYLIZATION.lighting, fn: () => {
        const lighting = GRAPHICS_SETTINGS?.lighting;
        if (!lighting || lighting.enabled === false) {
          safeApplyCanvasProps(viewer, {
            renderer: { light: [] }
          }, 'custom lighting (disabled)');
          return;
        }
        const exposure = numericOr(lighting.exposure, 1);
        const lights = (lighting.lights || []).map((light, index) => {
          const rgb = hexToRgb(light.color) || { r: 255, g: 255, b: 255 };
          return {
            inclination: numericOr(light.inclination, 160),
            azimuth: numericOr(light.azimuth, index * 120),
            color: toMolstarColor(rgb),
            intensity: numericOr(light.intensity, 1) * exposure,
          };
        });
        safeApplyCanvasProps(viewer, {
          renderer: {
            light: lights
          }
        }, 'custom lighting (profile-defined)');
      }, delay: 200 },
      { name: 'occlusion', enabled: DEBUG_STYLIZATION.occlusion, fn: () => {
        const occlusion = GRAPHICS_SETTINGS?.occlusion;
        if (!occlusion || occlusion.enabled === false) {
          safeApplyCanvasProps(viewer, {
            postprocessing: {
              occlusion: { name: 'off' }
            }
          }, 'ambient occlusion (disabled)');
          return;
        }
        safeApplyCanvasProps(viewer, {
          postprocessing: {
            occlusion: {
              name: 'on',
              params: {
                samples: numericOr(occlusion.samples, 64),
                radius: numericOr(occlusion.radius, 6),
                bias: numericOr(occlusion.bias, 0.8),
                blurKernelSize: numericOr(occlusion.blurKernelSize, 7),
                resolutionScale: numericOr(occlusion.resolutionScale, 1)
              }
            }
          }
        }, 'ambient occlusion (custom)');
      }, delay: 200 },
      { name: 'antialiasing', enabled: DEBUG_STYLIZATION.antialiasing, fn: () => {
        const antialiasing = GRAPHICS_SETTINGS?.antialiasing;
        if (!antialiasing || antialiasing.mode !== 'fxaa') {
          safeApplyCanvasProps(viewer, {
            postprocessing: {
              antialiasing: { name: 'off' }
            }
          }, 'antialiasing (off)');
          return;
        }
        safeApplyCanvasProps(viewer, {
          postprocessing: {
            antialiasing: {
              name: 'fxaa',
              params: {
                edgeThresholdMin: numericOr(antialiasing.edgeThresholdMin, 0.125),
                edgeThresholdMax: numericOr(antialiasing.edgeThresholdMax, 0.25),
                iterations: numericOr(antialiasing.iterations, 2),
                subpixelQuality: numericOr(antialiasing.subpixelQuality, 0.75)
              }
            }
          }
        }, 'antialiasing (FXAA)');
      }, delay: 150 },
      { name: 'fog', enabled: DEBUG_STYLIZATION.fog, fn: () => {
        const fog = GRAPHICS_SETTINGS?.fog;
        if (!fog || fog.enabled === false) {
          safeApplyCanvasProps(viewer, {
            cameraFog: { name: 'off' }
          }, 'camera fog (disabled)');
          return;
        }
        const fogColor = hexToRgb(fog.color) || resolveViewerColors(container).background;
        const intensity = numericOr(fog.intensity, 0.5);
        safeApplyCanvasProps(viewer, {
          cameraFog: {
            name: 'on',
            params: {
              intensity,
              color: toMolstarColor(fogColor)
            }
          }
        }, `camera fog (intensity: ${intensity.toFixed(2)})`);
      }, delay: 150 },
      { name: 'outline', enabled: DEBUG_STYLIZATION.outline, fn: () => {
        const outline = GRAPHICS_SETTINGS?.outline;
        if (!outline || outline.enabled === false) {
          safeApplyCanvasProps(viewer, {
            postprocessing: {
              outline: { name: 'off' }
            }
          }, 'outline (disabled)');
          return;
        }
        const color = hexToRgb(outline.color) || resolveViewerColors(container).background;
        const scale = numericOr(outline.scale, 0.5);
        const threshold = numericOr(outline.threshold, 0.35);
        safeApplyCanvasProps(viewer, {
          postprocessing: {
            outline: {
              name: 'on',
              params: {
                scale,
                threshold,
                color: toMolstarColor(color)
              }
            }
          }
        }, `outline (scale: ${scale.toFixed(2)}, threshold: ${threshold.toFixed(2)})`);
      }, delay: 150 },
      { name: 'disableMarking', enabled: DEBUG_STYLIZATION.disableMarking, fn: () => safeApplyCanvasProps(viewer, {
        marking: {
          enabled: false,
          edgeScale: 0,
          ghostEdgeStrength: 0,
          innerEdgeFactor: 0,
        }
      }, 'marking disable'), delay: 100 },
    ];

    // Apply steps sequentially with delays to avoid overwhelming the renderer
    for (const step of steps) {
      if (!step.enabled) {
        console.info(`[GeneGuessr] Skipping ${step.name} (debug disabled)`);
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, step.delay));
      step.fn();
    }
    
    console.info('[GeneGuessr] Completed sequential stylization profile');
  }

  function suppressViewerInteractivity(viewer) {
    // Disable all interactivity
    try {
      viewer.plugin?.managers?.interactivity?.setProps?.({ 
        granularity: 'element',
        maxFps: 0  // Disable hover updates
      });
      viewer.plugin?.managers?.interactivity?.lociHighlights?.setProps?.({ 
        enabled: false
      });
      viewer.plugin?.managers?.interactivity?.lociSelects?.setProps?.({ 
        enabled: false
      });
    } catch (err) {
      console.warn('Geneguessr: unable to set interactivity props', err);
    }

    if (!viewer.plugin?.behaviors?.interaction) {
      return;
    }

    // Subscribe to hover/click events and immediately clear any highlights
    const hoverSub = viewer.plugin.behaviors.interaction.hover.subscribe(() => {
      try {
        viewer.plugin?.managers?.interactivity?.lociHighlights?.clearHighlights?.(true);
      } catch {
        // ignore
      }
    });
    const clickSub = viewer.plugin.behaviors.interaction.click.subscribe(() => {
      try {
        viewer.plugin?.managers?.interactivity?.lociSelects?.deselectAll?.();
        viewer.plugin?.managers?.interactivity?.lociHighlights?.clearHighlights?.(true);
      } catch {
        // ignore
      }
    });
    
    // Store subscriptions on the viewer instance so they can be cleaned up
    if (!viewer._interactivityGuards) {
      viewer._interactivityGuards = { hoverSub, clickSub };
    }
  }

  async function loadStructureViewerInContainer(container, protein) {
    if (!container || !protein || !hasStructureData(protein)) {
      return;
    }
    
    const containerId = container.id;
    if (renderedViewers.has(containerId)) {
      return;
    }
    const placeholder = document.getElementById(`${containerId}-placeholder`);
    const loadingEl = document.getElementById(`${containerId}-loading`);
    const errorEl = document.getElementById(`${containerId}-error`);
    const structureInfo = viewerStructureInfo.get(containerId);
    
    if (!structureInfo || !structureInfo.token) {
      if (errorEl) {
        errorEl.textContent = 'Structure unavailable.';
        errorEl.hidden = false;
      }
      return;
    }
    
    const structure = protein.structure || {};
    const representation = resolveStructureRepresentation(structure, protein.length);
    if (!representation) {
      if (errorEl) {
        errorEl.textContent = 'No 3D structure available for this protein.';
        errorEl.hidden = false;
      }
      return;
    }
    
    const options = buildMolstarOptionsFromRepresentation(representation, { structureToken: structureInfo.token });
    if (!options) {
      if (errorEl) {
        errorEl.textContent = 'Could not build viewer options.';
        errorEl.hidden = false;
      }
      return;
    }
    
    if (loadingEl) loadingEl.hidden = false;
    if (placeholder) placeholder.hidden = true;
    if (errorEl) errorEl.hidden = true;
    
    try {
      await ensureMolstarAssets();
      if (!window.PDBeMolstarPlugin) {
        throw new Error('PDBeMolstarPlugin missing after script load');
      }
      container.innerHTML = '';
      const viewer = new window.PDBeMolstarPlugin();
      viewer.render(container, {
        ...options,
        hideControls: true,
        hideCanvasControls: ['expand', 'controlToggle', 'controlInfo', 'selection', 'animation', 'trajectory', 'screenshot', 'reset'],
        pdbeLink: false,
        visualStyle: 'cartoon',
        lighting: 'glossy',
        loadMaps: false,
        selectInteraction: false,
        lowPrecisionCoords: false,
        hideStructureSourceTooltip: true,
      });

      const finalizeViewerStyling = () => {
        applyViewerStylizationProfile(viewer, container);
        applyChainColoring(viewer, representation, container);
      };
      if (viewer.events?.loadComplete) {
        viewer.events.loadComplete.subscribe(finalizeViewerStyling);
      } else {
        setTimeout(finalizeViewerStyling, 500);
      }

      const metadata = getStructureSourceMetadataFromRepresentation(representation);
      const refreshedShortLabel = structureInfo?.sourceLabel || metadata?.label || 'Source unavailable';
      const refreshedLongLabel = structureInfo?.displayLabel || metadata?.label || refreshedShortLabel;
      updateStructureSourceDisplay(containerId, {
        shortLabel: refreshedShortLabel,
        longLabel: refreshedLongLabel,
        linkUrl: metadata?.url || null
      });
      container.dataset.viewerLoaded = 'true';
      structureViewerLoaded = true;
      renderedViewers.add(containerId);
    } catch (err) {
      console.error('Geneguessr: Mol* render failed', err);
      if (errorEl) {
        errorEl.textContent = 'Could not load 3D viewer. Please try again.';
        errorEl.hidden = false;
      }
      if (placeholder) placeholder.hidden = false;
      renderedViewers.delete(containerId);
    } finally {
      if (loadingEl) loadingEl.hidden = true;
    }
  }

  async function loadStructureViewer() {
    // Legacy function - redirects to new implementation
    const container = document.getElementById('pg-clue-structure') || document.getElementById('pg-solution-card-structure');
    if (container && targetProtein) {
      return loadStructureViewerInContainer(container, targetProtein);
    }
  }
  
  /**
   * Resolve the static base URL for fetching data files
   * Works with subpath deploys and relative paths
   */
  function resolveStaticBase() {
    // 1) From data attribute on root div (preferred)
    const el = document.getElementById('geneguessr-root');
    if (el && el.dataset && el.dataset.static) {
      let u = el.dataset.static;
      if (!u.endsWith('/')) u += '/';
      return u;
    }
    
    // 2) From script tag URL (robust if served from /static/geneguessr/app.js)
    const s = document.currentScript && document.currentScript.src;
    if (s) {
      const url = new URL(s);
      // Strip 'app.js' (and query) → leave directory
      return url.href.replace(/app\.js(\?.*)?$/, '');
    }
    
    // 3) Fallback (domain-root; works if site is at '/')
    return '/static/geneguessr/';
  }
  
  const STATIC_BASE = resolveStaticBase();
  
  // Constants
  const MOLSTAR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar-plugin.js";
  const MOLSTAR_FALLBACK_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@3.8.0/build/pdbe-molstar-plugin.js";
  const MOLSTAR_CSS_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar.css";
  const MOLSTAR_PRECONNECT_URL = "https://cdn.jsdelivr.net";
  const RCSB_PDB_DOWNLOAD_URL = "https://files.rcsb.org/download/";
  const DEFAULT_HINT_COST = 1;
  const HINT_REWARD_ON_INCORRECT = 1;
  const MAX_GUESSES = 6;
  const LOCKED_HINT_PLACEHOLDER = 'Hint locked';
  
  // State
  let proteins = [];
  let gameStatus = null;
  let clueData = null;
  let guessEntries = [];
  let targetReveal = null;
  let shareText = '';
  let targetProtein = null;
  let molstarLoaderPromise = null;
  let molstarCssLoaded = false;
  let molstarPreconnectAdded = false;
  let structureViewerLoaded = false;
  let interactivityGuards = null;
  let gameState = {
    date: null,
    guesses: [],
    won: false,
    targetId: null,
    practiceMode: false,
    statsRecorded: false
  };
  let tutorialBootRequested = false;
  const structureTokenCache = new Map();
  let targetStructureInfo = null;
  const viewerStructureInfo = new Map();
  const renderedViewers = new Set();
  let gamePayload = null;
  let collapseDelegationBound = false;
  let spoilerDelegationBound = false;

  function markViewerDirty(containerId) {
    if (!containerId) {
      return;
    }
    renderedViewers.delete(containerId);
    viewerStructureInfo.delete(containerId);
  }

  function markGuessViewersDirty() {
    for (const id of Array.from(renderedViewers)) {
      if (id.startsWith('guess-card-')) {
        markViewerDirty(id);
      }
    }
  }
  let collapseDelegationBound = false;

  async function fetchGameBootstrap() {
    const response = await fetch(`${API_BASE}/api/game/bootstrap`, {
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Bootstrap failed with status ${response.status}`);
    }
    return response.json();
  }

  async function submitGuessRequest(uniprot) {
    const normalized = (uniprot || '').toUpperCase();
    const response = await fetch(`${API_BASE}/api/game/guess`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniprot: normalized })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Guess failed with status ${response.status}`);
    }
    return response.json();
  }

  async function revealHintRequest(hintId) {
    const response = await fetch(`${API_BASE}/api/game/reveal-hint`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hintId })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Hint reveal failed with status ${response.status}`);
    }
    return response.json();
  }

  function hydrateStateFromPayload(payload) {
    if (!payload || !payload.status) {
      return;
    }
    targetStructureInfo = null;
    gamePayload = payload;
    gameStatus = payload.status;
    clueData = payload.clue || { sections: [], allMatches: {}, latestMatches: {} };
    guessEntries = Array.isArray(payload.guesses) ? payload.guesses : [];
    targetProtein = payload.clueTarget || null;
    targetReveal = payload.targetReveal || null;
    shareText = payload.shareText || '';
    gameState.date = gameStatus.date;
    gameState.guesses = guessEntries.map((entry) => ({
      ...entry,
      proteinResolved: resolveGuessProtein(entry)
    }));
    gameState.won = Boolean(gameStatus.won);
    gameState.targetId = targetReveal?.uniprot || null;
    gameState.practiceMode = Boolean(gameStatus.practiceMode);
    gameState.statsRecorded = false;
    updateHintDisplays();
  }

  function generateGuessId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `guess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  
  // DOM elements (will be populated on init)
  let rootEl;
  let layoutHydrated = false;
  const proteinsById = new Map();
  
  function normalizeProtein(protein) {
    const safeArray = (value) => (Array.isArray(value) ? value : []);
    const normalizeGoTerms = (terms) => {
      if (!terms || typeof terms !== 'object') {
        return { bp: [], mf: [], cc: [] };
      }
      return {
        bp: safeArray(terms.bp),
        mf: safeArray(terms.mf),
        cc: safeArray(terms.cc),
      };
    };
    return {
      ...protein,
      domains: safeArray(protein.domains),
      go_slim: safeArray(protein.go_slim),
      go_terms: normalizeGoTerms(protein.go_terms),
      structure: protein && protein.structure ? protein.structure : null,
      structure_id: protein && protein.structure_id ? protein.structure_id : null,
      alphafold_id: protein && protein.alphafold_id ? protein.alphafold_id : null,
      synonyms: safeArray(protein.synonyms),
      subcell: safeArray(protein.subcell),
      tissue: protein && protein.tissue ? protein.tissue : { label: "unknown", score: null },
      links: protein && protein.links ? protein.links : {}
    };
  }

  function resolveGuessProtein(entry) {
    if (!entry || !entry.uniprot) {
      return null;
    }
    const datasetProtein = getProteinById(entry.uniprot);
    if (datasetProtein) {
      return datasetProtein;
    }
    if (entry.protein) {
      return normalizeProtein(entry.protein);
    }
    return null;
  }

  function hydrateGuessProteins() {
    if (!Array.isArray(gameState.guesses)) {
      return;
    }
    gameState.guesses = gameState.guesses.map((entry) => {
      const resolved = resolveGuessProtein(entry);
      return resolved ? { ...entry, proteinResolved: resolved } : entry;
    });
  }
  
  function indexProteins(list) {
    proteinsById.clear();
    list.forEach((protein) => {
      if (protein && protein.uniprot) {
        proteinsById.set(protein.uniprot, protein);
      }
    });
  }
  
  function getProteinById(id) {
    if (!id) {
      return null;
    }
    return proteinsById.get(id) || null;
  }
  
  async function loadSearchIndex() {
    if (proteins.length) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/proteins`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`Protein list failed with status ${response.status}`);
      }
      const payload = await response.json();
      proteins = Array.isArray(payload) ? payload.map(normalizeProtein) : [];
      indexProteins(proteins);
    } catch (err) {
      console.warn('Geneguessr: failed to load protein index', err);
      proteins = [];
      proteinsById.clear();
    }
  }
  
  async function bootstrapGame() {
    const payload = await fetchGameBootstrap();
    hydrateStateFromPayload(payload);
    hydrateGuessProteins();
    await ensureStructureTokenForTarget();
    await hydrateStructureTokensForGuesses(gameState.guesses);
    const solvedOrExhausted = gameState.won || gameState.guesses.length >= MAX_GUESSES;
    if (solvedOrExhausted && targetReveal?.uniprot) {
      await ensureStructureTokenForProtein(targetReveal.uniprot);
    }
  }
  
  /**
   * SHA-256 implementation for deterministic daily selection
   */
  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  /**
   * Pick today's protein deterministically
   */
  async function pickTodaysProtein(eligibleIds, salt) {
    // Use local date YYYY-MM-DD
    const today = new Date().toISOString().slice(0, 10);
    
    // Check for debug override
    const urlParams = new URLSearchParams(window.location.search);
    const answerOverride = urlParams.get('answer');
    if (answerOverride && eligibleIds.includes(answerOverride)) {
      return answerOverride;
    }

    const filteredIds = filterEligibleQuestionIds(eligibleIds);
    const selectionPool = filteredIds.length ? filteredIds : eligibleIds;
    if (!filteredIds.length) {
      console.warn('[Geneguessr] AlphaFold-only question pool detected, falling back to full eligible list.');
    }
    
    // Hash date + salt
    const message = today + '|' + salt;
    const hash = await sha256(message);
    
    // Convert first 16 hex chars to int, mod by array length
    const hashInt = parseInt(hash.slice(0, 16), 16);
    const index = hashInt % selectionPool.length;
    
    return selectionPool[index];
  }

  function filterEligibleQuestionIds(eligibleIds) {
    if (!Array.isArray(eligibleIds)) {
      return [];
    }
    const filtered = [];
    let skipped = 0;
    for (const id of eligibleIds) {
      const protein = getProteinById(id);
      if (protein && isAlphaFoldOnlyProtein(protein)) {
        skipped += 1;
        continue;
      }
      filtered.push(id);
    }
    if (skipped) {
      console.info(`[Geneguessr] Skipped ${skipped} AlphaFold-only proteins from today's question pool.`);
    }
    return filtered;
  }

  /**
   * Local storage helpers
   */
  function saveState() {
    // State is persisted server-side; no-op.
  }
  
  function loadState() {
    return null;
  }
  
  /**
   * Scoring functions
   */
  function scoreGuess(guessEntry) {
    return guessEntry?.score || null;
  }
  
  /**
   * Render functions
   */
  // Unified card section builder - generates sections for both clue and guess cards
  function formatGoTerms(protein, aspect) {
    const names = protein.go_terms_named?.[aspect];
    if (Array.isArray(names) && names.length) {
      return names;
    }
    const raw = protein.go_terms?.[aspect];
    return Array.isArray(raw) ? raw : [];
  }

  function formatReactomeList(protein) {
    return (protein.reactome_pathways || [])
      .map((entry) => {
        if (!entry) return '';
        if (typeof entry === 'string') return entry;
        const trimmed = entry.name && entry.name.trim();
        return trimmed || entry.id || '';
      })
      .filter(Boolean);
  }

  function collectMatchedHintTexts(_target, guessEntry) {
    return guessEntry?.matchedHints || {};
  }

  function buildProteinSections(protein, options = {}) {
    const { forClue = false } = options;
    const goTermsByAspect = protein.go_terms || {};
    const goTermNamesByAspect = protein.go_terms_named || {};
    const domains = Array.isArray(protein.domains) ? protein.domains : [];
    const reactomePaths = Array.isArray(protein.reactome_pathways) ? protein.reactome_pathways : [];
    
    const sections = [];
    const filterTokens = [
      protein.hgnc,
      ...(Array.isArray(protein.synonyms) ? protein.synonyms : []),
    ]
      .filter(Boolean)
      .map(token => token.toLowerCase());
    
    const shouldFilterText = (text) => {
      if (!forClue || !filterTokens.length || typeof text !== 'string') {
        return false;
      }
      const normalized = text.toLowerCase();
      return filterTokens.some(token => token && normalized.includes(token));
    };
    
    const pushSection = (section, { skipFilter = false } = {}) => {
      const items = skipFilter ? section.items : section.items.filter(item => !shouldFilterText(item.text));
      if (!items.length) {
        return;
      }
      sections.push({
        ...section,
        items,
      });
    };
    
    // Gene summary section - only show on feedback cards, never on clue cards
    if (protein.gene_summary && !forClue) {
      const summary = protein.gene_summary;
      const summaryText = typeof summary === 'string' ? summary : summary.text;
      const summaryMeta = typeof summary === 'object' && summary.text ? {
        source: summary.source,
        url: summary.url,
      } : null;
      
      pushSection({
        id: 'summary',
        label: '', // No label for summary
        type: 'summary',
        items: [{ 
          text: summaryText,
          meta: summaryMeta,
        }],
      }, { skipFilter: true });
    }
    
    // Length first
    pushSection({
      id: 'length',
      label: 'Length',
      items: [{ id: forClue ? 'hint-length' : undefined, text: `${protein.length} aa` }],
    });
    
    // Properties (Transmembrane/Secreted)
    pushSection({
      id: 'properties',
      label: 'Properties',
      items: [
        {
          id: forClue ? 'hint-properties-tm' : undefined,
          text: protein.tmh ? 'Transmembrane' : 'Soluble',
        },
        {
          id: forClue ? 'hint-properties-secreted' : undefined,
          text: protein.secreted ? 'Secreted' : 'Intracellular',
        },
      ],
    });
    
    // Tissue specificity
    pushSection({
      id: 'tissue',
      label: 'Tissue specificity',
      items: [{ id: forClue ? 'hint-tissue' : undefined, text: protein.tissue.label }],
    });
    
    // Domains
    if (domains.length) {
      pushSection({
        id: 'domains',
        label: 'Domains',
        items: domains.map((domain, idx) => ({
          id: forClue ? `hint-domain-${idx}` : undefined,
          text: domain,
        })),
      });
    } else {
      pushSection({
        id: 'domains',
        label: 'Domains',
        items: [{ text: 'No structured domains', id: forClue ? 'hint-domain-0' : undefined }],
      });
    }
    
    // Pathways (Reactome)
    const formatReactomeEntry = (entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      const name = entry.name && entry.name.trim() ? entry.name.trim() : '';
      const id = entry.id || '';
      return name || id;
    };
    const formattedReactome = reactomePaths
      .map(formatReactomeEntry)
      .filter(Boolean);

    if (formattedReactome.length) {
      pushSection({
        id: 'reactome',
        label: 'Pathways',
        items: forClue
          ? formattedReactome.map((path, idx) => ({ id: `hint-reactome-${idx}`, text: path }))
          : formattedReactome.map(path => ({ text: path })),
      });
    }
    
    // GO sections last
    const goSectionMeta = [
      { aspect: 'mf', label: 'Molecular function' },
      { aspect: 'cc', label: 'Cellular component' },
      { aspect: 'bp', label: 'Biological process' },
    ];
    let goSectionAdded = false;
    goSectionMeta.forEach(({ aspect, label }) => {
      const namedTerms = Array.isArray(goTermNamesByAspect[aspect]) ? goTermNamesByAspect[aspect] : null;
      const rawTerms = Array.isArray(goTermsByAspect[aspect]) ? goTermsByAspect[aspect] : [];
      const terms = namedTerms && namedTerms.length ? namedTerms : rawTerms;
      if (!terms.length) {
        return;
      }
      goSectionAdded = true;
      pushSection({
        id: `function-${aspect}`,
        label,
        items: forClue
          ? terms.map((term, idx) => ({ id: `hint-${aspect}-${idx}`, text: term }))
          : terms.map(term => ({ text: term })),
      });
    });
    if (!goSectionAdded) {
      pushSection({
        id: 'function-bp',
        label: 'Biological process',
        items: [{ text: forClue ? 'Not available' : 'Not available', id: forClue ? 'hint-bp-0' : undefined }],
      });
    }

    return sections;
  }

  function renderClueSectionsHtml() {
    const sections = Array.isArray(clueData?.sections) ? clueData.sections : [];
    return sections.map(section => renderServerManagedSection(section)).join('');
  }

  function renderServerManagedSection(section) {
    const labelHtml = section.label
      ? `<span class="pg-section-label">${escapeHtml(section.label)}:</span> `
      : '';
    const highlightCandidates = getHighlightCandidates(section.id);
    const itemsHtml = (section.items || []).map(item => {
      const text = typeof item.text === 'string' ? item.text : null;
      const normalizedText = normalizeMatchText(text);
      const isMatched = Boolean(text && highlightCandidates.has(normalizedText));
      const entryClass = isMatched ? 'pg-section-entry matched-highlight' : 'pg-section-entry';
      if (!item.id || item.revealed) {
        if (text) {
          return `<span class="${entryClass}">${escapeHtml(text)}</span>`;
        }
        return `<span class="${entryClass}"></span>`;
      }
      return renderLockedHintPlaceholder(item, entryClass);
    }).join('');
    return `<div class="pg-section">${labelHtml}${itemsHtml}</div>`;
  }

  function normalizeMatchText(value) {
    return (value ?? '').toString().trim().toLowerCase();
  }

  function getHighlightCandidates(sectionId) {
    const latest = clueData?.latestMatches?.[sectionId] || [];
    const fallback = clueData?.allMatches?.[sectionId] || [];
    const source = latest.length ? latest : fallback;
    return new Set(source.map(normalizeMatchText));
  }

  function renderLockedHintPlaceholder(item, entryClass) {
    if (!item?.id) {
      return `<span class="${entryClass}">${escapeHtml(item?.placeholder || LOCKED_HINT_PLACEHOLDER)}</span>`;
    }
    const placeholder = item?.placeholder || LOCKED_HINT_PLACEHOLDER;
    const maskLength = Number(item?.maskLength) || placeholder.length || LOCKED_HINT_PLACEHOLDER.length;
    const width = Math.max(maskLength, placeholder.length, LOCKED_HINT_PLACEHOLDER.length);
    const mask = buildMaskCharacters(width);
    return `<span class="${entryClass}">
      <span class="pg-redaction" data-hint-id="${escapeAttribute(item.id)}" role="button" tabindex="0" aria-label="Click to reveal hint for ${DEFAULT_HINT_COST} hint" style="min-width:${width}ch">
        <span class="pg-redaction-cover" aria-hidden="true">${mask}</span>
      </span>
    </span>`;
  }

  function renderClueCard(gameOver = false) {
    if (gameOver) {
      const solutionTarget = targetReveal || targetProtein;
      const revealStructureInfo = solutionTarget?.uniprot ? getStructureInfoForProtein(solutionTarget.uniprot) : getTargetStructureInfo();
      const revealCard = buildFeedbackCardMarkup(solutionTarget, {
        cardId: 'pg-solution-card',
        collapsible: false,
        expanded: true,
        showSimilarity: false,
        structureInfo: revealStructureInfo,
        linkable: true,
      });
      return `
        ${renderResult()}
        ${revealCard}
      `;
    }
    
    if (!targetProtein) {
      return `
        <div class="pg-clue-card" data-game-over="false">
          <div class="pg-structure-placeholder">
            <p class="pg-structure-tip">Loading structure.</p>
          </div>
        </div>
      `;
    }
    const structureMarkup = renderStructureViewer(targetProtein, 'pg-clue-structure', {
      linkable: false,
      structureInfo: getTargetStructureInfo()
    });
    
    return `
        <div class="pg-clue-card" data-game-over="false">
          ${structureMarkup}
          <div class="pg-clue-sections" data-clue-sections>
            ${renderClueSectionsHtml()}
          </div>
      </div>
    `;
  }

  // Unified section renderer for both clue and feedback cards
  function renderProteinSection(section, options = {}) {
    const {
      showSpoilers = false,
      matchedItems = [],
      allRevealedItems = [],
      removeSpoilers = false,
    } = options;
    const highlightSet = new Set((matchedItems || []).map(normalizeMatchText));
    const normalizedRevealed = allRevealedItems || [];
    const revealSetSource = normalizedRevealed.length > 0 ? normalizedRevealed : matchedItems;
    const revealSet = new Set((revealSetSource || []).map(normalizeMatchText));
    
    // Special handling for gene summary section
    if (section.type === 'summary') {
      const item = section.items[0];
      const summaryText = item.text;
      const meta = item.meta;
      
      // For spoiler mode (clue cards) - hide until revealed
      if (showSpoilers && item.id) {
        const revealed = isHintRevealed(item.id);
        if (!revealed) {
          const placeholderNode = renderLockedHintPlaceholder({
            id: item.id,
            placeholder: 'Gene summary locked',
            maskLength: summaryText.length || 16
          }, 'pg-section-entry');
          return `<div class="pg-section pg-gene-summary">${placeholderNode}</div>`;
        }
      }
      
      // For feedback/revealed mode - show with source attribution
      const sourceLink = meta && meta.url && meta.source
        ? ` <a href="${meta.url}" target="_blank" class="pg-gene-summary-source" title="Retrieved ${meta.retrieved || ''}">Source: ${meta.source}</a>`
        : '';
      
      return `
        <div class="pg-section pg-gene-summary">
          <span class="pg-section-entry">${summaryText}${sourceLink}</span>
        </div>
      `;
    }
    
    const labelHtml = section.label
      ? `<span class="pg-section-label">${section.label}:</span> `
      : '';
    
    // Render all items with commas, applying spoilers or match indicators as needed
    const itemsHtml = section.items.map((item) => {
      const text = typeof item.text === 'string' ? item.text : null;
      const normalizedText = normalizeMatchText(text);
      const isMatched = Boolean(item.matched) || (text && highlightSet.has(normalizedText));
      const shouldReveal = text && revealSet.has(normalizedText);
     
      // For spoiler mode (clue cards)
      if (showSpoilers && item.id) {
        const revealed = isHintRevealed(item.id);
        const forceReveal = removeSpoilers && shouldReveal;
        if ((revealed || forceReveal) && text) {
          const cls = isMatched ? 'pg-section-entry matched-highlight' : 'pg-section-entry';
          return `<span class="${cls}">${escapeHtml(text)}</span>`;
        }
        return renderLockedHintPlaceholder(item, isMatched ? 'pg-section-entry matched-highlight' : 'pg-section-entry');
      }
      
      // For feedback mode (guess cards) - apply match highlighting
      if (text && isMatched) {
        return `<span class="pg-section-entry matched-highlight">${escapeHtml(text)}</span>`;
      }
      
      // Default
      if (text) {
        return `<span class="pg-section-entry">${escapeHtml(text)}</span>`;
      }
      return renderLockedHintPlaceholder(item, 'pg-section-entry');
    }).join('');
    
    return `
      <div class="pg-section">
        ${labelHtml}${itemsHtml}
      </div>
    `;
  }
  
  // Legacy wrapper for clue cards
  function renderSpoilerSection(section, options = {}) {
    return renderProteinSection(section, { showSpoilers: true, ...options });
  }


  
  function renderFeedbackSection(section, score, matchedItemsForSection = []) {
    // Add match indicators for specific sections when score data exists
    let modifiedSection = { ...section };
    
    if (score) {
      if (section.id === 'tissue') {
        modifiedSection.items = section.items.map(item => ({
          ...item,
          matched: Boolean(score.tissueMatch),
        }));
      } else if (section.id === 'properties') {
        modifiedSection.items = section.items.map((item, idx) => ({
          ...item,
          matched: idx === 0 ? Boolean(score.tmMatch) : Boolean(score.secretedMatch),
        }));
      } else if (section.id === 'length') {
        modifiedSection.items = section.items.map(item => ({
          ...item,
          matched: Boolean(score.lengthBinMatch),
        }));
      }
    }
    
    // Use unified renderer with match highlighting for domains
    return renderProteinSection(modifiedSection, { 
      showSpoilers: false, 
      matchedItems: matchedItemsForSection,
    });
  }
  
  function renderResult() {
    const title = gameState.won ? 'You Win!' : 'Game Over';
    const className = gameState.won ? '' : 'failed';
    const practiceMessage = gameState.practiceMode
      ? 'Practice mode active — stats paused.'
      : 'Practice runs do not update your stats.';
    const practiceCta = `
      <div class="pg-result-actions">
        <button class="pg-play-again" type="button" onclick="window.geneguessrPlayAgain()">
          ${gameState.practiceMode ? 'Restart Practice' : 'Play Again (Practice)'}
        </button>
        <div class="pg-practice-tag">${practiceMessage}</div>
      </div>
    `;
    
    const solution = targetReveal || targetProtein || {};
    const hasIdentity = Boolean(solution.hgnc);
    const proteinLabel = hasIdentity
      ? `${solution.hgnc} (${solution.full_name})`
      : 'Protein identity hidden';
    const wikiLink = hasIdentity && solution.links?.wiki ? `<a href="${solution.links.wiki}" class="pg-link-btn">View Protein Page</a>` : '';
    const uniprotLink = hasIdentity && solution.links?.uniprot ? `<a href="${solution.links.uniprot}" target="_blank" class="pg-link-btn">UniProt</a>` : '';
    return `
      <div class="pg-result ${className}">
        <div class="pg-result-title">${title}</div>
        <div class="pg-result-protein">
          ${proteinLabel}
        </div>
        <div>Guesses: ${gameState.guesses.length}/${MAX_GUESSES}</div>
        <div class="pg-result-links">
          ${wikiLink}
          ${uniprotLink}
        </div>
        ${practiceCta}
      </div>
    `;
  }
  
  function hydrateLayoutOnce() {
    if (layoutHydrated || !rootEl) {
      return;
    }
    rootEl.innerHTML = `
      <div id="pg-clue-slot"></div>
      <div id="pg-input-slot"></div>
      <div id="pg-guesses"></div>
      <div id="pg-result-slot"></div>
      <div id="pg-footer-slot"></div>
    `;
    layoutHydrated = true;
    ensureCollapseDelegation();
  }
  
  function renderClueSectionsIntoDom(gameOver = false) {
    const slot = document.getElementById('pg-clue-slot');
    if (!slot) return;
    if (!clueData) {
      slot.innerHTML = '<div class="pg-clue-card"><p>Loading clues...</p></div>';
      return;
    }
    
    markViewerDirty('pg-clue-structure');
    if (gameOver) {
      markViewerDirty('pg-solution-card-structure');
    }
    slot.innerHTML = renderClueCard(gameOver);
    ensureSpoilerDelegation();
  }
  
  function renderInputSection(gameOver) {
    const slot = document.getElementById('pg-input-slot');
    if (!slot) {
      return;
    }
    if (gameOver) {
      slot.innerHTML = '';
      return;
    }
    const hints = getHintsBalance();
    const practiceBadge = gameState.practiceMode
      ? `<div class="pg-practice-badge" aria-live="polite">Practice mode</div>`
      : '';
    slot.innerHTML = `
      <div class="pg-input-section">
        <div class="pg-input-row">
          <div class="pg-autocomplete-wrapper">
            <input 
              type="text" 
              id="pg-input" 
              class="pg-input" 
              placeholder="Type gene name (e.g., TERT, TP53)"
              autocomplete="off"
            />
            <button id="pg-submit" class="pg-submit-inline" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
            <div id="pg-suggestions" class="pg-suggestions"></div>
          </div>
          <div class="pg-hints-badge">
            <span class="pg-hints-label">Hints</span>
            <span class="pg-hints-value">${hints}</span>
          </div>
          ${practiceBadge}
          <button type="button" class="pg-how-to-play" id="pg-how-to-play">How to Play</button>
        </div>
      </div>
    `;
    
    const inputEl = document.getElementById('pg-input');
    const suggestionsEl = document.getElementById('pg-suggestions');
    const submitBtn = document.getElementById('pg-submit');
    
    if (inputEl && suggestionsEl && submitBtn) {
      setupAutocomplete(inputEl, suggestionsEl);
      
      submitBtn.addEventListener('click', submitGuess);
      
      inputEl.addEventListener('input', () => {
        submitBtn.disabled = true;
        delete submitBtn.dataset.uniprot;
      });
    }

    const howToPlayButton = document.getElementById('pg-how-to-play');
    if (howToPlayButton && window.GeneGuessrTutorial && typeof window.GeneGuessrTutorial.open === 'function') {
      howToPlayButton.addEventListener('click', () => {
        window.GeneGuessrTutorial.open();
      });
    }
  }
  
  function renderGuessesSection() {
    const guessesEl = document.getElementById('pg-guesses');
    if (!guessesEl) {
      return;
    }
    ensureCollapseDelegation();
    
    // Check if we only need to add the latest guess (avoid destroying all existing cards)
    const existingCards = guessesEl.querySelectorAll('.pg-feedback-card');
    const expectedCount = gameState.guesses.length;
    const existingCount = existingCards.length;
    
    // Nothing to render and nothing displayed
    if (expectedCount === 0) {
      if (existingCount !== 0) {
        guessesEl.innerHTML = '';
        markGuessViewersDirty();
      }
      return;
    }
    
    // No changes to guess history, keep existing DOM (prevents viewer reload)
    if (existingCount === expectedCount) {
      return;
    }
    
    if (existingCount === expectedCount - 1) {
      // Only latest guess is new - append it instead of recreating everything
      const latestGuess = gameState.guesses[gameState.guesses.length - 1];
      const newCardHtml = renderCollapsibleFeedback(latestGuess, true);
      guessesEl.insertAdjacentHTML('afterbegin', newCardHtml);
      syncFeedbackContentHeights();
      return;
    }
    
    // Full re-render needed (initial load or state mismatch)
    markGuessViewersDirty();
    guessesEl.innerHTML = gameState.guesses
      .map((g, idx) => {
        const isLatest = idx === gameState.guesses.length - 1;
        return renderCollapsibleFeedback(g, isLatest);
      })
      .reverse()
      .join('');
    
    syncFeedbackContentHeights();
  }

  function buildFeedbackCardMarkup(protein, options = {}) {
    const {
      score = null,
      cardId = `feedback-card-${protein.uniprot}`,
      collapsible = false,
      expanded = true,
      showSimilarity = Boolean(score),
      headerLabel = protein.hgnc,
      matchedHintMap = {},
      structureInfo = null,
      linkable = false,
    } = options;
    
    const goPercent = showSimilarity && score && typeof score.goPercent === 'number'
      ? score.goPercent
      : null;
    const goValue = goPercent === null ? 'N/A' : `${goPercent}%`;
    const goWidth = goPercent === null ? 0 : goPercent;
    
    const sections = buildProteinSections(protein, { forClue: false });
    const sectionMarkup = sections
      .map(section => renderFeedbackSection(section, score, matchedHintMap[section.id] || []))
      .join('');
    
    const similarityMarkup = showSimilarity
      ? `
        <div class="pg-bar">
          <div class="pg-bar-fill" style="width: ${goWidth}%"></div>
        </div>
        <span class="pg-feedback-score">${goValue}</span>
      `
      : '';
    
    // Add structure viewer above sections
    const viewerId = `${cardId}-structure`;
    const structureMarkup = renderStructureViewer(protein, viewerId, { linkable, structureInfo });
    
    const contentMarkup = `
      <div class="pg-feedback-content" id="${cardId}-content">
        ${structureMarkup}
        <div class="pg-feedback-protein-name">${protein.full_name}</div>
        ${sectionMarkup}
      </div>
    `;
    
    if (!collapsible) {
      return `
        <div class="pg-feedback-card expanded pg-feedback-final" id="${cardId}" data-expanded="true">
          <div class="pg-collapse-toggle pg-static-toggle" role="heading" aria-level="2">
            <span class="pg-feedback-gene">${headerLabel}</span>
            ${similarityMarkup}
          </div>
          ${contentMarkup}
        </div>
      `;
    }
    
    const chevron = expanded ? '▼' : '▶';
    
    return `
      <div class="pg-feedback-card ${expanded ? 'expanded' : 'collapsed'}" id="${cardId}" data-expanded="${expanded}">
        <button class="pg-collapse-toggle" aria-expanded="${expanded}" aria-controls="${cardId}-content">
          <span class="pg-collapse-chevron">${chevron}</span>
          <span class="pg-feedback-gene">${headerLabel}</span>
          ${similarityMarkup}
        </button>
        ${contentMarkup}
      </div>
    `;
  }
  
  function renderCollapsibleFeedback(guessEntry, isLatest) {
    const cardId = `guess-card-${guessEntry.guessId}`;
    const expanded = getCardExpansionState(cardId, isLatest);
    const matchedHintMap = guessEntry.matchedHints || {};
    const protein = guessEntry.proteinResolved || resolveGuessProtein(guessEntry);
    if (!protein) {
      return '';
    }
    
    return buildFeedbackCardMarkup(protein, {
      score: guessEntry.score,
      cardId,
      collapsible: true,
      expanded,
      showSimilarity: true,
      matchedHintMap,
      structureInfo: getStructureInfoForProtein(guessEntry.uniprot),
      linkable: true
    });
  }
  
  function getCardExpansionState(cardId, isLatest) {
    try {
      const stored = sessionStorage.getItem('guessCardStates');
      if (stored) {
        const states = JSON.parse(stored);
        if (cardId in states) {
          return states[cardId];
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
    // Default: latest expanded, others collapsed
    return isLatest;
  }
  
  function setCardExpansionState(cardId, expanded) {
    try {
      const stored = sessionStorage.getItem('guessCardStates');
      const states = stored ? JSON.parse(stored) : {};
      states[cardId] = expanded;
      sessionStorage.setItem('guessCardStates', JSON.stringify(states));
    } catch (e) {
      // Ignore storage errors
    }
  }
  
  function ensureCollapseDelegation() {
    if (collapseDelegationBound) {
      return;
    }
    const guessesEl = document.getElementById('pg-guesses');
    if (!guessesEl) {
      return;
    }
    const handleClick = (event) => {
      const toggle = event.target.closest('.pg-collapse-toggle:not(.pg-static-toggle)');
      if (!toggle || !guessesEl.contains(toggle)) {
        return;
      }
      event.preventDefault();
      toggleFeedbackCard(toggle);
    };
    const handleKeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const toggle = event.target.closest('.pg-collapse-toggle:not(.pg-static-toggle)');
      if (!toggle || !guessesEl.contains(toggle)) {
        return;
      }
      event.preventDefault();
      toggleFeedbackCard(toggle);
    };
    guessesEl.addEventListener('click', handleClick);
    guessesEl.addEventListener('keydown', handleKeydown);
    collapseDelegationBound = true;
  }

  function toggleFeedbackCard(toggleEl) {
    const card = toggleEl.closest('.pg-feedback-card');
    if (!card || card.classList.contains('pg-feedback-final')) {
      return;
    }
    const content = card.querySelector('.pg-feedback-content');
    const chevron = card.querySelector('.pg-collapse-chevron');
    const currentlyExpanded = card.dataset.expanded === 'true';
    const newExpanded = !currentlyExpanded;
    
    card.classList.toggle('expanded', newExpanded);
    card.classList.toggle('collapsed', !newExpanded);
    card.dataset.expanded = String(newExpanded);
    toggleEl.setAttribute('aria-expanded', newExpanded);
    setFeedbackContentHeight(content, newExpanded);
    if (chevron) {
      chevron.textContent = newExpanded ? '▼' : '▶';
    }
    
    setCardExpansionState(card.id, newExpanded);
    
    if (newExpanded) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function ensureSpoilerDelegation() {
    if (spoilerDelegationBound) {
      return;
    }
    const handleClick = (event) => {
      const redaction = event.target.closest('.pg-redaction[data-hint-id]');
      if (!redaction) {
        return;
      }
      event.preventDefault();
      activateSpoiler(redaction);
    };
    const handleKeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const redaction = event.target.closest('.pg-redaction[data-hint-id]');
      if (!redaction) {
        return;
      }
      event.preventDefault();
      activateSpoiler(redaction);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    spoilerDelegationBound = true;
  }

  async function activateSpoiler(redaction) {
    const hintId = redaction.dataset.hintId;
    if (!hintId || redaction.dataset.loading === 'true') {
      return;
    }
    redaction.dataset.loading = 'true';
    redaction.classList.add('pg-redaction-loading');
    try {
      const payload = await requestHintReveal(hintId);
      hydrateStateFromPayload(payload);
      render();
    } catch (err) {
      console.error('Geneguessr: failed to reveal hint', err);
    } finally {
      redaction.dataset.loading = 'false';
      redaction.classList.remove('pg-redaction-loading');
    }
  }

  function setFeedbackContentHeight(content, expanded) {
    if (!content) {
      return;
    }
    if (expanded) {
      content.style.maxHeight = content.scrollHeight + 'px';
    } else {
      content.style.maxHeight = '0px';
    }
  }

  function syncFeedbackContentHeights() {
    window.requestAnimationFrame(() => {
      const cards = document.querySelectorAll('.pg-feedback-card');
      cards.forEach((card) => {
        const content = card.querySelector('.pg-feedback-content');
        if (!content) {
          return;
        }
        const expanded = card.dataset.expanded === 'true';
        setFeedbackContentHeight(content, expanded || card.classList.contains('pg-feedback-final'));
      });
    });
  }

  let feedbackResizeHandle = null;
  window.addEventListener('resize', () => {
    if (feedbackResizeHandle) {
      clearTimeout(feedbackResizeHandle);
    }
    feedbackResizeHandle = setTimeout(() => {
      feedbackResizeHandle = null;
      syncFeedbackContentHeights();
    }, 200);
  });
  
  function renderResultSection(gameOver) {
    const slot = document.getElementById('pg-result-slot');
    if (!slot) {
      return;
    }
    // Result messaging is now rendered above the clue/feedback card
    slot.innerHTML = '';
  }
  
  function renderFooterSection(gameOver) {
    const slot = document.getElementById('pg-footer-slot');
    if (!slot) {
      return;
    }
    if (gameOver) {
      slot.innerHTML = `
        <div class="pg-share-section">
          <button id="pg-share-btn" class="pg-share-btn">Share Result</button>
          <div id="pg-share-feedback" class="pg-share-feedback"></div>
        </div>
      `;
      const shareBtn = document.getElementById('pg-share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', shareResult);
      }
    } else {
      slot.innerHTML = `
        <div style="text-align: center; margin-top: 1rem; color: var(--gray);">
          ${gameState.guesses.length}/${MAX_GUESSES} guesses
        </div>
      `;
    }
  }
  
  function renderStats() {
    // Load stats from localStorage
    const stats = loadStats();
    
    return `
      <div class="pg-stats">
        <div class="pg-stat">
          <div class="pg-stat-value">${stats.played}</div>
          <div class="pg-stat-label">Played</div>
        </div>
        <div class="pg-stat">
          <div class="pg-stat-value">${Math.round(stats.winRate * 100)}%</div>
          <div class="pg-stat-label">Win Rate</div>
        </div>
        <div class="pg-stat">
          <div class="pg-stat-value">${stats.currentStreak}</div>
          <div class="pg-stat-label">Streak</div>
        </div>
      </div>
    `;
  }

  function renderHintsMeter() {
    const hints = getHintsBalance();
    return `
      <div class="pg-hints" aria-live="polite">
        <span class="pg-hints-label">Hints</span>
        <span class="pg-hints-value">${hints}</span>
      </div>
    `;
  }
  
  function loadStats() {
    const saved = localStorage.getItem('geneguessr_stats');
    return saved ? JSON.parse(saved) : {
      played: 0,
      won: 0,
      winRate: 0,
      currentStreak: 0,
      maxStreak: 0
    };
  }
  
  async function loadStatsFromAPI() {
    if (!currentUser) {
      return loadStats(); // Fall back to localStorage if not authenticated
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/stats`, {
        method: 'GET',
        credentials: 'include'
      });
      
      if (!response.ok) {
        console.warn('Failed to load stats from API, using localStorage');
        return loadStats();
      }
      
      return await response.json();
    } catch (err) {
      console.error('Error loading stats from API:', err);
      return loadStats();
    }
  }
  
  function updateStats(won) {
    const stats = loadStats();
    stats.played++;
    if (won) {
      stats.won++;
      stats.currentStreak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }
    stats.winRate = stats.played > 0 ? stats.won / stats.played : 0;
    localStorage.setItem('geneguessr_stats', JSON.stringify(stats));
  }
  
  async function updateStatsAPI(won) {
    // Always update localStorage for offline support
    updateStats(won);
    
    // If authenticated, also update D1
    if (!currentUser) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/stats/update`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ won })
      });
      
      if (!response.ok) {
        console.warn('Failed to update stats on server');
      }
    } catch (err) {
      console.error('Error updating stats on server:', err);
    }
  }

  async function recordStatsOnce(won) {
    if (gameState.practiceMode || gameState.statsRecorded) {
      return;
    }
    try {
      await updateStatsAPI(won);
    } finally {
      gameState.statsRecorded = true;
    }
  }
  
  async function promptStatsMigration() {
    // Only prompt if user is authenticated and has localStorage stats
    if (!currentUser) {
      return;
    }
    
    const localStats = loadStats();
    if (localStats.played === 0) {
      return; // No stats to migrate
    }
    
    // Check if already migrated
    try {
      const response = await fetch(`${API_BASE}/api/stats`, {
        method: 'GET',
        credentials: 'include'
      });
      
      if (response.ok) {
        const serverStats = await response.json();
        if (serverStats.migratedAt) {
          return; // Already migrated
        }
      }
    } catch (err) {
      console.error('Error checking migration status:', err);
      return;
    }
    
    // Prompt user to migrate
    const migrate = confirm(
      `Sync your existing stats to your Discord account?\n\n` +
      `You have played ${localStats.played} game${localStats.played !== 1 ? 's' : ''} with ${localStats.won} win${localStats.won !== 1 ? 's' : ''}.\n\n` +
      `This will allow your stats to persist across devices.`
    );
    
    if (!migrate) {
      return;
    }
    
    // Migrate stats
    try {
      const response = await fetch(`${API_BASE}/api/migrate-stats`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localStats)
      });
      
      if (response.ok) {
        alert('Stats synced successfully! Your progress is now saved to your Discord account.');
      } else {
        const error = await response.json();
        console.error('Migration failed:', error);
        alert('Failed to sync stats. Please try again later.');
      }
    } catch (err) {
      console.error('Error migrating stats:', err);
      alert('Failed to sync stats. Please try again later.');
    }
  }
  
  /**
   * Autocomplete
   */
  const SEARCH_MAX_RESULTS = 8;

  function normalizeText(value) {
    return (value || '').toLowerCase();
  }

  function getSearchScore(protein, query) {
    if (!query) return Number.POSITIVE_INFINITY;
    const normalizedQuery = query.toLowerCase();
    const hgnc = normalizeText(protein.hgnc);

    if (hgnc === normalizedQuery) return 0;
    if (hgnc.startsWith(normalizedQuery)) return 1;

    const primarySynonyms = (protein.synonyms || []).map(normalizeText);
    if (primarySynonyms.some(s => s === normalizedQuery)) return 2;
    if (primarySynonyms.some(s => s.startsWith(normalizedQuery))) return 3;

    const fullName = normalizeText(protein.full_name);
    if (fullName.startsWith(normalizedQuery)) return 4;
    if (fullName.includes(normalizedQuery)) return 5;

    const subSynonym = primarySynonyms.find(s => s.includes(normalizedQuery));
    if (subSynonym) return 6;

    return Number.POSITIVE_INFINITY;
  }

  function searchProteins(query) {
    const cleanedQuery = query.trim().toLowerCase();
    if (!cleanedQuery) {
      return [];
    }
    const guessedSet = new Set(gameState.guesses.map(g => g.uniprot));

    return proteins
      .filter((p) => !guessedSet.has(p.uniprot))
      .map((protein) => ({
        protein,
        score: getSearchScore(protein, cleanedQuery),
      }))
      .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.protein.hgnc.localeCompare(b.protein.hgnc);
      })
      .slice(0, SEARCH_MAX_RESULTS)
      .map((entry) => entry.protein);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSuggestionSubtitle(protein) {
    const parts = [protein.hgnc];
    const firstSynonym = (protein.synonyms || []).find(s => !!s && s !== protein.hgnc);
    if (firstSynonym) {
      parts.push(firstSynonym);
    }
    return parts.filter(Boolean).join(' • ');
  }

  function setupAutocomplete(inputEl, suggestionsEl) {
    let selectedIndex = -1;
    
    inputEl.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      
      if (query.length < 1) {
        suggestionsEl.innerHTML = '';
        suggestionsEl.style.display = 'none';
        return;
      }
      
      // Find matches
      const matches = searchProteins(query);
      
      if (matches.length === 0) {
        suggestionsEl.innerHTML = '<div class="pg-suggestion">No matches found</div>';
        suggestionsEl.style.display = 'block';
        return;
      }
      
      suggestionsEl.innerHTML = matches.map((p, idx) => `
        <div class="pg-suggestion" data-uniprot="${p.uniprot}" data-index="${idx}" title="${escapeHtml(p.full_name)}">
          <div class="pg-suggestion-title">${escapeHtml(p.hgnc)}</div>
          <div class="pg-suggestion-sub">${escapeHtml(p.full_name || p.hgnc)}</div>
        </div>
      `).join('');
      suggestionsEl.style.display = 'block';
      selectedIndex = -1;
      
      // Click handler
      suggestionsEl.querySelectorAll('.pg-suggestion').forEach(el => {
        el.addEventListener('click', () => {
          const uniprot = el.dataset.uniprot;
          selectProtein(uniprot);
        });
      });
    });
    
    inputEl.addEventListener('keydown', (e) => {
      const suggestions = suggestionsEl.querySelectorAll('.pg-suggestion');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
        updateSelectedSuggestion(suggestions);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedSuggestion(suggestions);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          const uniprot = suggestions[selectedIndex].dataset.uniprot;
          selectProtein(uniprot);
        }
      } else if (e.key === 'Escape') {
        suggestionsEl.innerHTML = '';
        suggestionsEl.style.display = 'none';
        selectedIndex = -1;
      }
    });
    
    function updateSelectedSuggestion(suggestions) {
      suggestions.forEach((el, idx) => {
        el.classList.toggle('selected', idx === selectedIndex);
      });
    }
  }
  
  function selectProtein(uniprot) {
    const protein = proteins.find(p => p.uniprot === uniprot);
    if (!protein) return;
    
    // Clear input and suggestions
    const inputEl = document.getElementById('pg-input');
    const suggestionsEl = document.getElementById('pg-suggestions');
    inputEl.value = protein.hgnc;
    suggestionsEl.innerHTML = '';
    suggestionsEl.style.display = 'none';
    
    // Enable submit button
    document.getElementById('pg-submit').disabled = false;
    document.getElementById('pg-submit').dataset.uniprot = uniprot;
  }

  
  /**
   * Handle guess submission
   */
  async function submitGuess() {
    const submitBtn = document.getElementById('pg-submit');
    const uniprot = submitBtn.dataset.uniprot;
    
    if (!uniprot) return;
    
    const guessProtein = proteins.find(p => p.uniprot === uniprot);
    if (!guessProtein) return;
    
    if (submitBtn.disabled) return;
    
    submitBtn.disabled = true;
    const previousLabel = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    
    try {
      const payload = await submitGuessRequest(uniprot);
      hydrateStateFromPayload(payload);
      await ensureStructureTokenForProtein(uniprot);
      const reachedEndOfRound = gameState.won || gameState.guesses.length >= MAX_GUESSES;
      if (reachedEndOfRound && targetReveal?.uniprot) {
        await ensureStructureTokenForProtein(targetReveal.uniprot);
      }
      render();
    } catch (err) {
      console.error('Geneguessr: failed to submit guess', err);
      alert(err?.message || 'Failed to submit guess. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = previousLabel;
      submitBtn.removeAttribute('data-uniprot');
      const inputEl = document.getElementById('pg-input');
      if (inputEl) {
        inputEl.value = '';
      }
    }
  }
  
  /**
   * Share functionality
   */
  function generateShareText() {
    if (shareText) {
      return shareText;
    }
    const emoji = gameState.won ? 'You Win!' : 'Game Over';
    const guessCount = gameState.guesses.length;
    const today = new Date().toISOString().slice(0, 10);
    
    // Build emoji grid
    const grid = gameState.guesses.map(g => {
      if (g.correct) {
        return '🟩';
      }
      const simScore = typeof g.score.goSimilarity === 'number' ? g.score.goSimilarity : 0;
      return simScore >= 0.35 ? '🟨' : '⬜';
    }).join('');
    
    return `Geneguessr ${today}
${emoji} ${guessCount}/${MAX_GUESSES}

${grid}

https://brinedew.bio/apps/geneguessr/`;
  }
  
  function shareResult() {
    const shareText = generateShareText();
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText).then(() => {
        const feedbackEl = document.getElementById('pg-share-feedback');
        feedbackEl.textContent = 'Copied to clipboard!';
        setTimeout(() => {
          feedbackEl.textContent = '';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
      });
    } else {
      // Fallback
      alert(shareText);
    }
  }
  
  /**
   * Main render function
   */
  function render() {
    try {
      const gameOver = Boolean(gameState.won || (gameStatus && gameStatus.lost) || gameState.guesses.length >= MAX_GUESSES);

      hydrateLayoutOnce();
      renderClueSectionsIntoDom(gameOver);
      renderInputSection(gameOver);
      renderGuessesSection();
      renderResultSection(gameOver);
      renderFooterSection(gameOver);
      
    ensureSpoilerDelegation();
      setupStructureInteractions();
      updateSidebarStats();
    } catch (err) {
      console.error('Geneguessr: render() failed', err);
      reportError('render-failed', err?.stack || err?.message || String(err));
    }
  }
  
  // Auth state
  let currentUser = null;
  const API_BASE = 'https://geneguessr-api.decap.workers.dev';

  /**
   * Check auth status
   */
  async function checkAuth() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.authenticated) {
          currentUser = data.user;
          return true;
        }
      }
    } catch (err) {
      console.warn('Auth check failed:', err);
    }
    currentUser = null;
    return false;
  }

  /**
   * Inject stats/hints into sidebar
   */
  function injectSidebarStats() {
    // Find Quartz right sidebar (where tags are)
    const sidebar = document.querySelector('.right.sidebar');
    if (!sidebar) {
      console.warn('Geneguessr: right sidebar not found, skipping stats injection');
      return;
    }
    
    const sidebarStats = document.createElement('div');
    sidebarStats.id = 'pg-sidebar-stats';
    sidebarStats.className = 'pg-sidebar-stats';
    
    const hints = getHintsBalance();
    const stats = loadStats();
    
    const formatTierLabel = (tier) => {
      if (!tier) {
        return '';
      }
      const normalized = `${tier}`.toLowerCase();
      if (normalized === 'registered') {
        return '';
      }
      return normalized
        .split(/[\s_]+/)
        .map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
        .join(' ');
    };
    const tierLabel = currentUser ? formatTierLabel(currentUser.tier) : '';
    const discordInvite = 'https://discord.com/invite/kx8FVzUrpf';
    
    const authSection = currentUser ? `
      <div class="pg-sidebar-section pg-auth-section">
        <div class="pg-sidebar-label">Account</div>
        <div class="pg-auth-info">
          <div class="pg-auth-username">${currentUser.username}</div>
          ${tierLabel ? `<div class="pg-auth-tier">${tierLabel}</div>` : ''}
          <div class="pg-auth-buttons">
            <a href="${discordInvite}" class="pg-auth-discord" target="_blank" rel="noopener noreferrer">
              Join Brinedew Discord
            </a>
            <button class="pg-auth-logout" onclick="window.geneguessrLogout()">Sign Out</button>
          </div>
        </div>
      </div>
    ` : `
      <div class="pg-sidebar-section pg-auth-section">
        <div class="pg-sidebar-label">Account</div>
        <a href="${API_BASE}/api/auth/login" class="pg-auth-signin">
          <svg width="16" height="16" viewBox="0 0 71 55" fill="none">
            <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.655 45.5182 70.6886 45.459 70.6942 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="currentColor"/>
          </svg>
          Sign in with Discord
        </a>
      </div>
    `;
    
    sidebarStats.innerHTML = `
      ${authSection}
      <div class="pg-sidebar-section">
        <div class="pg-sidebar-label">Hints</div>
        <div class="pg-sidebar-value pg-sidebar-hints">${hints}</div>
      </div>
      <div class="pg-sidebar-section">
        <div class="pg-sidebar-label">Stats</div>
        <div class="pg-sidebar-stats-grid">
          <div><span class="pg-sidebar-stat-label">Played:</span> ${stats.played}</div>
          <div><span class="pg-sidebar-stat-label">Win Rate:</span> ${Math.round(stats.winRate * 100)}%</div>
          <div><span class="pg-sidebar-stat-label">Streak:</span> ${stats.currentStreak}</div>
        </div>
      </div>
    `;
    
    // Insert before tags section
    const tagsSection = sidebar.querySelector('.page-tags-section');
    if (tagsSection) {
      sidebar.insertBefore(sidebarStats, tagsSection);
    } else {
      sidebar.appendChild(sidebarStats);
    }
  }

  /**
   * Logout handler
   */
  window.geneguessrLogout = async function() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      currentUser = null;
      // Reload to update UI
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  window.geneguessrPlayAgain = function() {
    window.location.reload();
  };
  
  function updateSidebarStats() {
    const sidebarHints = document.querySelector('.pg-sidebar-hints');
    if (sidebarHints) {
      sidebarHints.textContent = getHintsBalance();
    }
    
    // Update inline hints badge
    const inlineHints = document.querySelector('.pg-hints-value');
    if (inlineHints) {
      inlineHints.textContent = getHintsBalance();
    }
    
    const statsGrid = document.querySelector('.pg-sidebar-stats-grid');
    if (statsGrid) {
      const stats = loadStats();
      statsGrid.innerHTML = `
        <div><span class="pg-sidebar-stat-label">Played:</span> ${stats.played}</div>
        <div><span class="pg-sidebar-stat-label">Win Rate:</span> ${Math.round(stats.winRate * 100)}%</div>
        <div><span class="pg-sidebar-stat-label">Streak:</span> ${stats.currentStreak}</div>
      `;
    }
  }

  /**
   * Initialize app
   */
  async function init() {
    setStatus('init-start');
    rootEl = document.getElementById('geneguessr-root');
    
    if (!rootEl) {
      console.error('Geneguessr root element not found!');
      reportError('root-element-missing', '');
      return;
    }
    
    // Show loading
    rootEl.innerHTML = '<div style="text-align: center; padding: 2rem;">Loading Geneguessr...</div>';
    
    // Check auth status
    await checkAuth();
    
    // Prompt for stats migration if needed
    await promptStatsMigration();
    
    // Inject stats into sidebar
    injectSidebarStats();
    
    setStatus('loading-data');
    
    await loadSearchIndex();
    
    try {
      await bootstrapGame();
    } catch (err) {
      console.error('Geneguessr: failed to initialise game state', err);
      const detail = err?.stack || err?.message || String(err);
      reportError('init-game-failed', detail);
      return;
    }
    
    // Render
    render();
    setStatus('rendered');

    if (!tutorialBootRequested && window.GeneGuessrTutorial && typeof window.GeneGuessrTutorial.boot === 'function') {
      tutorialBootRequested = true;
      window.GeneGuessrTutorial.boot();
    }

    // Attach collapse logic for Attribution & Data Sources card
    attachAttributionCollapseLogic();
  }
  
  // Start when DOM ready (but only if root element exists)
  function boot() {
    // Guard: do nothing if root doesn't exist (helps when loaded on wrong pages)
    if (!document.getElementById('geneguessr-root')) {
      console.info('Geneguessr: root element not found, skipping initialization');
      reportError('root-element-missing', '');
      return;
    }
    setStatus('booting');
    init();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  

// Collapse logic for Attribution & Data Sources card
function attachAttributionCollapseLogic() {
  // Find the attribution button by its text content
  const buttons = Array.from(document.querySelectorAll('button'));
  const attributionBtn = buttons.find(btn => btn.textContent && btn.textContent.includes('Attribution & Data Sources'));
  if (!attributionBtn) return;

  // Find or create the chevron (assume first child span or create one)
  let chevron = attributionBtn.querySelector('span');
  if (!chevron) {
    chevron = document.createElement('span');
    chevron.textContent = '▶';
    attributionBtn.insertBefore(chevron, attributionBtn.firstChild);
  }

  // Find or create the content region after the button
  let attributionContent = attributionBtn.nextElementSibling;
  if (!attributionContent || !attributionContent.classList.contains('pg-attribution-content')) {
    attributionContent = document.createElement('div');
    attributionContent.className = 'pg-attribution-content';
    attributionContent.style.display = 'none';
    attributionContent.innerHTML = `
      <div style="padding: 1em; background: #f9f9f9; border-radius: 6px; margin-top: 0.5em;">
        <b>Attribution & Data Sources</b><br>
        <ul style="margin: 0.5em 0 0 1em;">
          <li>Protein/gene data: <a href='https://www.uniprot.org/' target='_blank'>UniProt</a></li>
          <li>Structure viewer: <a href='https://www.ebi.ac.uk/pdbe/' target='_blank'>PDBe Molstar</a></li>
          <li>Pathways: <a href='https://reactome.org/' target='_blank'>Reactome</a></li>
        </ul>
      </div>
    `;
    attributionBtn.parentNode.insertBefore(attributionContent, attributionBtn.nextSibling);
  }

  // Attach click handler to toggle
  attributionBtn.addEventListener('click', function () {
    const expanded = attributionContent.style.display !== 'none';
    attributionContent.style.display = expanded ? 'none' : 'block';
    chevron.textContent = expanded ? '▶' : '▼';
  });
}

})();

  function buildMaskCharacters(length) {
    const cap = Math.min(Math.max(Number(length) || LOCKED_HINT_PLACEHOLDER.length, LOCKED_HINT_PLACEHOLDER.length), 64);
    return '█'.repeat(cap);
  }
