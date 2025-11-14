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
        ? ${structure.pdb.resolution.toFixed(2)} A
        : (structure.pdb && structure.pdb.resolution_raw) || '';
      return resolution ? PDB  -  : PDB ;
    }
    if (structure.primary_source === 'swissmodel' && swissModel) {
      return formatSwissLabel(swissModel);
    }
    if (structure.primary_source === 'alphafold' && structure.alphafold && structure.alphafold.id) {
      return AlphaFold ;
    }
    if (swissModel) {
      return formatSwissLabel(swissModel);
    }
    if (structure.pdb && structure.pdb.id) {
      const resolution = typeof structure.pdb.resolution === 'number'
        ? ${structure.pdb.resolution.toFixed(2)} A
        : structure.pdb.resolution_raw || '';
      return resolution ? PDB  -  : PDB ;
    }
    if (structure.alphafold && structure.alphafold.id) {
      return AlphaFold ;
    }
    return '';
  }

  function formatSwissLabel(model) {
    if (!model) {
      return 'SWISS-MODEL';
    }
    const labelId = model.model_id || model.template || model.pdb_id || 'SWISS-MODEL';
    const coveragePart = typeof model.coverage === 'number' ? ${Math.round(model.coverage * 100)}% : '';
    const qmeanPart = typeof model.qmean === 'number' ? QMEAN  : '';
    const extras = [coveragePart, qmeanPart].filter(Boolean).join(', ');
    return extras ? SWISS-MODEL  () : SWISS-MODEL ;
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

  function buildMolstarOptionsFromRepresentation(representation) {
    if (!representation) {
      return null;
    }
    if (representation.source === 'pdb' && representation.pdb && representation.pdb.id) {
      return {
        moleculeId: representation.pdb.id,
        assemblyId: '1',
        customData: {
          url: `${RCSB_PDB_DOWNLOAD_URL}${representation.pdb.id}.cif`,
          format: 'cif'
        }
      };
    }
    if (representation.source === 'alphafold' && representation.alphafold && representation.alphafold.model_url) {
      return {
        moleculeId: representation.alphafold.id || representation.structureId || targetProtein?.uniprot,
        customData: {
          url: representation.alphafold.model_url,
          format: 'cif'
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

  function renderStructureViewer(protein, viewerId) {
    if (!protein || !hasStructureData(protein)) {
      return '';
    }
    const structure = protein.structure || {};
    const meta = getStructureMetaLabel(structure);
    
    return `
      <div class="pg-card-structure-viewer" id="${viewerId}" role="region" aria-label="3D structure viewer">
        <div class="pg-structure-placeholder" id="${viewerId}-placeholder" hidden>
          <p class="pg-structure-tip">Loading structure…</p>
        </div>
        <div class="pg-structure-loading" id="${viewerId}-loading" hidden>Loading viewer…</div>
        <div class="pg-structure-error" id="${viewerId}-error" hidden></div>
      </div>
    `;
  }
  
  function renderStructureHint() {
    // Legacy function - no longer used in layout
    return '';
  }

  function setupStructureInteractions() {
    // Auto-load structure viewer for clue card if present
    const clueViewer = document.getElementById('pg-clue-structure');
    if (clueViewer && hasStructureData(targetProtein) && !clueViewer.querySelector('canvas')) {
      loadStructureViewerInContainer(clueViewer, targetProtein).catch((err) => {
        console.error('Geneguessr: failed to load clue structure viewer', err);
      });
    }
    
    // Auto-load structure viewer for solution card if present (game over)
    const solutionViewer = document.getElementById('pg-solution-card-structure');
    if (solutionViewer && hasStructureData(targetProtein) && !solutionViewer.querySelector('canvas')) {
      loadStructureViewerInContainer(solutionViewer, targetProtein).catch((err) => {
        console.error('Geneguessr: failed to load solution structure viewer', err);
      });
    }
    
    // Auto-load structure viewers for guess cards if present
    gameState.guesses.forEach((guess) => {
      const viewerId = `guess-card-${guess.guessId}-structure`;
      const container = document.getElementById(viewerId);
      if (container && hasStructureData(guess.protein) && !container.querySelector('canvas')) {
        loadStructureViewerInContainer(container, guess.protein).catch((err) => {
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

  function hintsApi() {
    return window.GeneGuessrHints || null;
  }

  function initHintsForRound(roundId) {
    const api = hintsApi();
    if (!api || !roundId) return;
    try {
      api.initRound(roundId);
    } catch (err) {
      console.warn('Geneguessr: failed to init hints', err);
    }
  }

  function readHintsBalanceDirect(api) {
    if (!api?.getHints) return null;
    try {
      const value = api.getHints();
      return typeof value === 'number' ? value : null;
    } catch (err) {
      console.warn('Geneguessr: failed to read hint balance', err);
      return null;
    }
  }

  function getHintsBalance() {
    const direct = readHintsBalanceDirect(hintsApi());
    return direct ?? DEFAULT_HINT_COST;
  }

  function updateHintDisplays(explicitValue) {
    const value = typeof explicitValue === 'number' ? explicitValue : getHintsBalance();
    document.querySelectorAll('.pg-hints-value, .pg-sidebar-hints').forEach((el) => {
      el.textContent = value;
    });
  }

  function isHintRevealed(hintId) {
    if (!hintId) return true;
    const api = hintsApi();
    if (!api || !currentRoundId) return true;
    try {
      return api.isHintRevealed(currentRoundId, hintId);
    } catch {
      return true;
    }
  }

  function attemptReveal(hintId, cost = DEFAULT_HINT_COST) {
    const api = hintsApi();
    if (!api || !currentRoundId) {
      return true;
    }
    const before = readHintsBalanceDirect(api);
    try {
      const result = api.revealHint(currentRoundId, hintId, cost);
      if (result && result.success) {
        const after = readHintsBalanceDirect(api);
        updateHintDisplays(after ?? before);
        if (typeof before === 'number' && typeof after === 'number' && api?.earnHints) {
          const actualCost = before - after;
          if (actualCost > cost) {
            try {
              api.earnHints(actualCost - cost);
              const refundBalance = readHintsBalanceDirect(api);
              updateHintDisplays(refundBalance ?? after);
            } catch (refundErr) {
              console.warn('Geneguessr: failed to refund excess hint cost', refundErr);
            }
          }
        }
        return true;
      }
      flashHintsWarning();
      return false;
    } catch (err) {
      console.warn('Geneguessr: failed to reveal hint', err);
      flashHintsWarning();
      return false;
    }
  }

  function awardHints(amount = HINT_REWARD_ON_INCORRECT) {
    const api = hintsApi();
    if (!api || !amount) return;
    try {
      api.earnHints(amount);
      const balance = readHintsBalanceDirect(api);
      updateHintDisplays(balance);
    } catch (err) {
      console.warn('Geneguessr: unable to earn hints', err);
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
    const placeholder = document.getElementById(`${containerId}-placeholder`);
    const loadingEl = document.getElementById(`${containerId}-loading`);
    const errorEl = document.getElementById(`${containerId}-error`);
    
    const structure = protein.structure || {};
    const representation = resolveStructureRepresentation(structure, protein.length);
    const options = buildMolstarOptionsFromRepresentation(representation);
    if (!options) {
      if (errorEl) {
        errorEl.textContent = 'No 3D structure available for this protein.';
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
        // UI lockdown (conservative approach)
        hideControls: true,
        hideCanvasControls: ['expand', 'controlToggle', 'controlInfo', 'selection', 'animation', 'trajectory', 'screenshot', 'reset'],
        pdbeLink: false,
        // Appearance
        visualStyle: 'cartoon',
        lighting: 'glossy',
        // Data/behavior
        loadMaps: false,  // Disable electron density maps - they cause streaming hang
        selectInteraction: false,
        // Disable streaming to prevent hangs
        lowPrecisionCoords: false,
        // Disable hover tooltip
        hideStructureSourceTooltip: true,
      });

      // Apply incremental stylization after render completes
      const finalizeViewerStyling = () => {
        applyViewerStylizationProfile(viewer, container);
        applyChainColoring(viewer, representation, container);
      };
      if (viewer.events?.loadComplete) {
        viewer.events.loadComplete.subscribe(finalizeViewerStyling);
      } else {
        // Fallback: apply shortly after render
        setTimeout(finalizeViewerStyling, 500);
      }

      container.dataset.viewerLoaded = 'true';
      structureViewerLoaded = true;
    } catch (err) {
      console.error('Geneguessr: Mol* render failed', err);
      if (errorEl) {
        errorEl.textContent = 'Could not load 3D viewer. Please try again.';
        errorEl.hidden = false;
      }
      if (placeholder) placeholder.hidden = false;
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
  const DATA_URL = `${STATIC_BASE}data.json`;
  const INDEX_URL = `${STATIC_BASE}index.json`;
  const SIMILARITY_URL = `${STATIC_BASE}similarity.json`;
  const MOLSTAR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar-plugin.js";
  const MOLSTAR_FALLBACK_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@3.8.0/build/pdbe-molstar-plugin.js";
  const MOLSTAR_CSS_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar.css";
  const MOLSTAR_PRECONNECT_URL = "https://cdn.jsdelivr.net";
  const RCSB_PDB_DOWNLOAD_URL = "https://files.rcsb.org/download/";
  const DEFAULT_HINT_COST = 1;
  const HINT_REWARD_ON_INCORRECT = 1;
  const MAX_GUESSES = 6;
  const STORAGE_KEY = 'geneguessr_state';
  
  // State
  let proteins = [];
  let indexData = null;
  let targetProtein = null;
  let similarityMatrix = null;
  let molstarLoaderPromise = null;
  let molstarCssLoaded = false;
  let molstarPreconnectAdded = false;
  let structureViewerLoaded = false;
  let interactivityGuards = null;
  let currentRoundId = null;
let gameState = {
  date: null,
  guesses: [],
  won: false,
  hintsUnlocked: 1, // Start with 1 hint visible
  targetId: null,
  practiceMode: false,
  statsRecorded: false
};

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
  
  async function loadData() {
    try {
      const [proteinsResp, indexResp, similarityResp] = await Promise.all([
        fetch(DATA_URL, { cache: "no-store" }),
        fetch(INDEX_URL, { cache: "no-store" }),
        fetch(SIMILARITY_URL, { cache: "no-store" })
      ]);
      
      if (!proteinsResp.ok) {
        throw new Error(`data.json request failed with status ${proteinsResp.status}`);
      }
      if (!indexResp.ok) {
        throw new Error(`index.json request failed with status ${indexResp.status}`);
      }
      if (!similarityResp.ok) {
        throw new Error(`similarity.json request failed with status ${similarityResp.status}`);
      }
      
      const [proteinsJson, indexJson, similarityJson] = await Promise.all([
        proteinsResp.json(),
        indexResp.json(),
        similarityResp.json()
      ]);
      
      if (!Array.isArray(proteinsJson)) {
        throw new Error("data.json payload must be an array");
      }
      
      proteins = proteinsJson.map(normalizeProtein);
      indexData = indexJson || null;
      similarityMatrix = similarityJson || null;
      if (!similarityMatrix || !similarityMatrix.scores) {
        throw new Error("similarity.json payload missing scores");
      }
      
      if (!indexData || !Array.isArray(indexData.eligible_ids) || indexData.eligible_ids.length === 0) {
        throw new Error("index.json payload missing eligible_ids");
      }
      
      indexProteins(proteins);
      return true;
    } catch (err) {
      console.error("Geneguessr: failed to load static data", err);
      const detail = err?.stack || err?.message || String(err);
      reportError('load-data-failed', detail);
      return false;
    }
  }
  
  async function initGame() {
    if (!Array.isArray(proteins) || proteins.length === 0 || !indexData) {
      throw new Error("Geneguessr data has not been loaded yet");
    }
    
    const today = new Date().toISOString().slice(0, 10);
    const saved = loadState();
    
    if (saved && saved.date === today) {
      gameState = {
        date: today,
        guesses: Array.isArray(saved.guesses) ? saved.guesses : [],
        won: Boolean(saved.won),
        hintsUnlocked: Math.max(1, Math.min(5, saved.hintsUnlocked || 1)),
        targetId: saved.targetId || null,
        practiceMode: Boolean(saved.practiceMode),
        statsRecorded: Boolean(saved.statsRecorded)
      };
    } else {
      gameState = {
        date: today,
        guesses: [],
        won: false,
        hintsUnlocked: 1,
        targetId: null,
        practiceMode: false,
        statsRecorded: false
      };
    }
    
    const targetId = await pickTodaysProtein(indexData.eligible_ids, indexData.salt_hash);
    const target = getProteinById(targetId);
    
    if (!target) {
      throw new Error(`Target protein ${targetId} not found in dataset`);
    }
    
    targetProtein = target;
    gameState.targetId = targetId;
    currentRoundId = gameState.date;
    initHintsForRound(currentRoundId);
    structureViewerLoaded = false;
    
    gameState.guesses = gameState.guesses
      .map((entry) => {
        const guessProteinId =
          (entry && entry.protein && entry.protein.uniprot) ||
          entry.uniprot ||
          null;
        const protein = getProteinById(guessProteinId);
        if (!protein) {
          return null;
        }
        const score = scoreGuess(protein, targetProtein);
        const correct =
          typeof entry.correct === "boolean"
            ? entry.correct
            : protein.uniprot === targetProtein.uniprot;
        const guessId = entry.guessId || entry.cardId || generateGuessId();
        
        return {
          protein,
          score,
          correct,
          uniprot: protein.uniprot,
          guessId
        };
      })
      .filter(Boolean);
    
    if (saved && saved.date === today && saved.targetId && saved.targetId !== targetId) {
      gameState.guesses = [];
      gameState.won = false;
      gameState.hintsUnlocked = 1;
    }
    
    saveState();
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
    
    // Hash date + salt
    const message = today + '|' + salt;
    const hash = await sha256(message);
    
    // Convert first 16 hex chars to int, mod by array length
    const hashInt = parseInt(hash.slice(0, 16), 16);
    const index = hashInt % eligibleIds.length;
    
    return eligibleIds[index];
  }

  /**
   * Local storage helpers
   */
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
  }
  
  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  }
  
  /**
   * Scoring functions
   */
  function getGoSimilarityScore(guessId, targetId) {
    if (!similarityMatrix || !similarityMatrix.scores) {
      return null;
    }
    if (!guessId || !targetId) {
      return null;
    }
    const direct = similarityMatrix.scores[guessId];
    if (direct && typeof direct[targetId] === 'number') {
      return direct[targetId];
    }
    const inverse = similarityMatrix.scores[targetId];
    if (inverse && typeof inverse[guessId] === 'number') {
      return inverse[guessId];
    }
    return null;
  }
  
  function getGoSimilarityMetadata() {
    if (!similarityMatrix || !similarityMatrix.metadata) {
      return null;
    }
    return similarityMatrix.metadata;
  }
  
  function formatGoSimilarityLabel() {
    return 'Similarity';
  }
  
  function formatGoSimilarityNote() {
    // Removed metadata display to reduce mobile clutter (B-69)
    return '';
  }
  
  function scoreGuess(guess, target) {
    const goSimilarity = getGoSimilarityScore(guess.uniprot, target.uniprot);
    const goPercent = typeof goSimilarity === 'number' ? Math.round(goSimilarity * 100) : null;
    
    // Domain overlap
    const domainIntersection = guess.domains.filter(d => target.domains.includes(d));
    const domainOverlap = domainIntersection.length;
    
    // Length bin match
    const binLength = (len) => {
      if (len < 400) return 0;
      if (len < 800) return 1;
      if (len < 1600) return 2;
      return 3;
    };
    const lengthBinMatch = binLength(guess.length) === binLength(target.length);
    
    // Binary flags
    const tmMatch = guess.tmh === target.tmh;
    const secretedMatch = guess.secreted === target.secreted;
    
    // Tissue specificity match
    const tissueMatch = guess.tissue.label === target.tissue.label;
    
    return {
      goSimilarity,
      goPercent,
      domainOverlap,
      domainMatches: domainIntersection,
      lengthBinMatch,
      tmMatch,
      secretedMatch,
      tissueMatch
    };
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

  function collectMatchedHintTexts(target, guessEntry) {
    const matches = {};
    if (!target || !guessEntry) {
      return matches;
    }
    const guess = guessEntry.protein;
    const score = guessEntry.score || {};
    const addMatches = (sectionId, values) => {
      const filtered = values.filter(Boolean);
      if (filtered.length) {
        matches[sectionId] = filtered;
      }
    };
    const intersect = (a, b) => {
      if (!a.length || !b.length) {
        return [];
      }
      const setB = new Set(b);
      return a.filter((item) => setB.has(item));
    };

    addMatches('domains', score.domainMatches || []);
    ['mf', 'cc', 'bp'].forEach((aspect) => {
      const overlap = intersect(
        formatGoTerms(target, aspect),
        formatGoTerms(guess, aspect)
      );
      if (overlap.length) {
        matches[`function-${aspect}`] = overlap;
      }
    });
    addMatches('reactome', intersect(formatReactomeList(target), formatReactomeList(guess)));
    if (score.tissueMatch) {
      addMatches('tissue', [target.tissue.label]);
    }
    const propertyMatches = [];
    if (score.tmMatch) {
      propertyMatches.push(target.tmh ? 'Transmembrane' : 'Soluble');
    }
    if (score.secretedMatch) {
      propertyMatches.push(target.secreted ? 'Secreted' : 'Intracellular');
    }
    addMatches('properties', propertyMatches);
    if (score.lengthBinMatch) {
      addMatches('length', [`${target.length} aa`]);
    }
    return matches;
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

  function renderClueSectionsHtml(allMatches, latestMatches) {
    const sections = buildProteinSections(targetProtein, { forClue: true });
    return sections.map(section => renderSpoilerSection(section, {
      matchedItems: latestMatches[section.id] || [],  // Only highlight latest matches
      allRevealedItems: allMatches[section.id] || [], // But keep all revealed
      removeSpoilers: true,
    })).join('');
  }

  function renderClueCard(gameOver = false) {
    if (gameOver) {
      const revealCard = buildFeedbackCardMarkup(targetProtein, {
        cardId: 'pg-solution-card',
        collapsible: false,
        expanded: true,
        showSimilarity: false,
      });
      return `
        ${renderResult()}
        ${revealCard}
      `;
    }
    
    // Collect matches from ALL guesses (for revealing items)
    const allClueMatches = {};
    gameState.guesses.forEach(guessEntry => {
      const guessMatches = collectMatchedHintTexts(targetProtein, guessEntry);
      // Merge matches - each section ID should accumulate unique values
      Object.keys(guessMatches).forEach(sectionId => {
        if (!allClueMatches[sectionId]) {
          allClueMatches[sectionId] = [];
        }
        guessMatches[sectionId].forEach(value => {
          if (!allClueMatches[sectionId].includes(value)) {
            allClueMatches[sectionId].push(value);
          }
        });
      });
    });
    
    // Get matches from ONLY the latest guess (for accent highlighting)
    const latestGuessEntry = gameState.guesses[gameState.guesses.length - 1] || null;
    const latestClueMatches = latestGuessEntry 
      ? collectMatchedHintTexts(targetProtein, latestGuessEntry)
      : {};
    // Important: renderStructureViewer builds the 3D placeholder once per guess.
    // We only re-render the sections beneath to avoid tearing down Mol*.
    const structureMarkup = renderStructureViewer(targetProtein, 'pg-clue-structure');
    
    return `
      <div class="pg-clue-card">
        ${structureMarkup}
        <div class="pg-clue-sections" data-clue-sections>
          ${renderClueSectionsHtml(allClueMatches, latestClueMatches)}
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
    const highlightSet = new Set(matchedItems || []);
    const normalizedRevealed = allRevealedItems || [];
    const revealSet = new Set(normalizedRevealed.length > 0 ? normalizedRevealed : matchedItems);
    
    // Special handling for gene summary section
    if (section.type === 'summary') {
      const item = section.items[0];
      const summaryText = item.text;
      const meta = item.meta;
      
      // For spoiler mode (clue cards) - hide until revealed
      if (showSpoilers && item.id) {
        const revealed = isHintRevealed(item.id);
        if (!revealed) {
          return `
            <div class="pg-section pg-gene-summary">
              <span class="pg-redaction" 
                    data-hint-id="${item.id}" 
                    role="button" 
                    tabindex="0"
                    aria-label="Click to reveal gene summary for ${DEFAULT_HINT_COST} hint">
                <span class="pg-redaction-shadow" aria-hidden="true">${summaryText}</span>
                <span class="pg-redaction-cover" aria-hidden="true"></span>
              </span>
            </div>
          `;
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
      const text = (item && typeof item.text === 'string') ? item.text : String(item.text ?? '');
      const isMatched = item.matched || highlightSet.has(item.text);
      const shouldReveal = revealSet.has(item.text);
     
      // For spoiler mode (clue cards)
      if (showSpoilers && item.id) {
        const revealed = isHintRevealed(item.id);
        const forceReveal = removeSpoilers && shouldReveal;
        if (revealed || forceReveal) {
          const cls = isMatched ? 'pg-section-entry matched-highlight' : 'pg-section-entry';
          return `<span class="${cls}">${text}</span>`;
        }
        return `<span class="pg-section-entry"><span class="pg-redaction" 
                    data-hint-id="${item.id}" 
                    role="button" 
                    tabindex="0"
                    aria-label="Click to reveal hint for ${DEFAULT_HINT_COST} hint">${text}</span></span>`;
      }
      
      // For feedback mode (guess cards) - apply match highlighting
      if (isMatched) {
        return `<span class="pg-section-entry matched-highlight">${text}</span>`;
      }
      
      // Default
      return `<span class="pg-section-entry">${text}</span>`;
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
    
    return `
      <div class="pg-result ${className}">
        <div class="pg-result-title">${title}</div>
        <div class="pg-result-protein">
          ${targetProtein.hgnc} (${targetProtein.full_name})
        </div>
        <div>Guesses: ${gameState.guesses.length}/${MAX_GUESSES}</div>
        <div class="pg-result-links">
          <a href="${targetProtein.links.wiki}" class="pg-link-btn">View Protein Page</a>
          <a href="${targetProtein.links.uniprot}" target="_blank" class="pg-link-btn">UniProt</a>
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
  }
  
  function renderClueSectionsIntoDom(gameOver = false) {
    const slot = document.getElementById('pg-clue-slot');
    if (!slot) return;
    
    if (gameOver) {
      slot.innerHTML = renderClueCard(true);
      setupSpoilerHandlers();
      return;
    }
    
    // Collect matches from ALL guesses (for revealing items)
    const allClueMatches = {};
    gameState.guesses.forEach(guessEntry => {
      const guessMatches = collectMatchedHintTexts(targetProtein, guessEntry);
      Object.keys(guessMatches).forEach(sectionId => {
        if (!allClueMatches[sectionId]) {
          allClueMatches[sectionId] = [];
        }
        guessMatches[sectionId].forEach(value => {
          if (!allClueMatches[sectionId].includes(value)) {
            allClueMatches[sectionId].push(value);
          }
        });
      });
    });
    
    // Get matches from ONLY the latest guess (for accent highlighting)
    const latestGuessEntry = gameState.guesses[gameState.guesses.length - 1] || null;
    const latestClueMatches = latestGuessEntry 
      ? collectMatchedHintTexts(targetProtein, latestGuessEntry)
      : {};
    
    const existingCard = slot.querySelector('.pg-clue-card');
    
    if (existingCard) {
      const sectionsContainer = existingCard.querySelector('[data-clue-sections]');
      if (sectionsContainer) {
        // Keep the Mol* viewer intact; only swap the sections beneath it.
        sectionsContainer.innerHTML = renderClueSectionsHtml(allClueMatches, latestClueMatches);
        setupSpoilerHandlers();
        return;
      }
    }
    
    slot.innerHTML = renderClueCard(false);
    setupSpoilerHandlers();
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
  }
  
  function renderGuessesSection() {
    const guessesEl = document.getElementById('pg-guesses');
    if (!guessesEl) {
      return;
    }
    
    // Check if we only need to add the latest guess (avoid destroying all existing cards)
    const existingCards = guessesEl.querySelectorAll('.pg-feedback-card');
    const expectedCount = gameState.guesses.length;
    const existingCount = existingCards.length;
    
    // Nothing to render and nothing displayed
    if (expectedCount === 0) {
      if (existingCount !== 0) {
        guessesEl.innerHTML = '';
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
      attachCollapseListeners();
      syncFeedbackContentHeights();
      // Preserve existing Mol* canvases: never touch earlier cards when inserting the new one.
      guessesEl.querySelectorAll('.pg-feedback-card:not(:first-child) .matched-highlight').forEach((el) => {
        el.classList.remove('matched-highlight');
      });
      return;
    }
    
    // Full re-render needed (initial load or state mismatch)
    guessesEl.innerHTML = gameState.guesses
      .map((g, idx) => {
        const isLatest = idx === gameState.guesses.length - 1;
        return renderCollapsibleFeedback(g, isLatest);
      })
      .reverse()
      .join('');
    
    // Attach collapse toggle listeners
    attachCollapseListeners();
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
    const structureMarkup = renderStructureViewer(protein, viewerId);
    
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
    const matchedHintMap = isLatest ? collectMatchedHintTexts(targetProtein, guessEntry) : {};
    
    return buildFeedbackCardMarkup(guessEntry.protein, {
      score: guessEntry.score,
      cardId,
      collapsible: true,
      expanded,
      showSimilarity: true,
      matchedHintMap,
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
  
  function attachCollapseListeners() {
    const toggles = document.querySelectorAll('.pg-collapse-toggle:not(.pg-static-toggle)');
    toggles.forEach(toggle => {
      toggle.addEventListener('click', function() {
        const card = this.closest('.pg-feedback-card');
        const content = card.querySelector('.pg-feedback-content');
        const chevron = card.querySelector('.pg-collapse-chevron');
        const currentlyExpanded = card.dataset.expanded === 'true';
        const newExpanded = !currentlyExpanded;
        
        // Update UI
        card.classList.toggle('expanded', newExpanded);
        card.classList.toggle('collapsed', !newExpanded);
        card.dataset.expanded = newExpanded;
        this.setAttribute('aria-expanded', newExpanded);
        setFeedbackContentHeight(content, newExpanded);
        chevron.textContent = newExpanded ? '▼' : '▶';
        
        // Persist state
        setCardExpansionState(card.id, newExpanded);
        
        // Scroll into view if expanding
        if (newExpanded) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      
      // Keyboard support
      toggle.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });
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

  function setupSpoilerHandlers() {
    document.querySelectorAll('.pg-redaction[data-hint-id]').forEach((redaction) => {
      // Remove any existing handlers by cloning the node (drops all listeners)
      const clean = redaction.cloneNode(true);
      redaction.replaceWith(clean);
      
      const handleReveal = () => {
        const hintId = clean.dataset.hintId;
        if (!hintId) return;
        const success = attemptReveal(hintId, DEFAULT_HINT_COST);
        if (success) {
          render();
        }
      };
      
      clean.addEventListener('click', handleReveal);
      clean.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleReveal();
        }
      });
    });
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
    
    // Check if already guessed
    if (gameState.guesses.some(g => g.uniprot === uniprot)) {
      alert('You already guessed this protein!');
      return;
    }
    
    // Score the guess
    const score = scoreGuess(guessProtein, targetProtein);
    
    // Check if correct
    const isCorrect = guessProtein.uniprot === targetProtein.uniprot;
    
    // Add to guesses
    const guessId = generateGuessId();
    gameState.guesses.push({
      protein: guessProtein,
      score: score,
      correct: isCorrect,
      uniprot: guessProtein.uniprot,
      guessId
    });
    
    // Unlock next hint
    if (!isCorrect) {
      gameState.hintsUnlocked = Math.min(gameState.hintsUnlocked + 1, 5);
      awardHints(HINT_REWARD_ON_INCORRECT);
    }
    
    // Check win/loss
    if (isCorrect) {
      gameState.won = true;
      await recordStatsOnce(true);
    } else if (gameState.guesses.length >= MAX_GUESSES) {
      await recordStatsOnce(false);
    }
    
    // Save state
    gameState.targetId = targetProtein.uniprot;
    saveState();
    
    // Re-render
    render();
  }
  
  /**
   * Share functionality
   */
  function generateShareText() {
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
      const gameOver = gameState.won || gameState.guesses.length >= MAX_GUESSES;

      hydrateLayoutOnce();
      renderClueSectionsIntoDom(gameOver);
      renderInputSection(gameOver);
      renderGuessesSection();
      renderResultSection(gameOver);
      renderFooterSection(gameOver);
      
      setupSpoilerHandlers();
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
    if (!(gameState.won || gameState.guesses.length >= MAX_GUESSES)) {
      return;
    }
    const api = hintsApi();
    if (api?.resetRound && currentRoundId) {
      try {
        api.resetRound(currentRoundId);
      } catch (err) {
        console.warn('Geneguessr: failed to reset hints for practice mode', err);
      }
    }
    gameState.guesses = [];
    gameState.won = false;
    gameState.hintsUnlocked = 1;
    gameState.practiceMode = true;
    saveState();
    updateHintDisplays();
    render();
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
    
    // Load data
    const success = await loadData();
    if (!success) {
      reportError('load-data-returned-false', '');
      return;
    }
    
    // Initialize game
    try {
      await initGame();
    } catch (err) {
      console.error('Geneguessr: failed to initialise game state', err);
      const detail = err?.stack || err?.message || String(err);
      reportError('init-game-failed', detail);
      return;
    }
    
    // Render
    render();
    setStatus('rendered');
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
