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
    return Boolean(structure && (structure.primary_source || (structure.alphafold && structure.alphafold.model_url)));
  }

  function getStructureMetaLabel(structure) {
    if (!structure) {
      return '';
    }
    if (structure.primary_source === 'pdb' && structure.structure_id) {
      const resolution = structure.pdb && typeof structure.pdb.resolution === 'number'
        ? `${structure.pdb.resolution.toFixed(2)} Å`
        : (structure.pdb && structure.pdb.resolution_raw) || '';
      return resolution ? `PDB ${structure.structure_id} · ${resolution}` : `PDB ${structure.structure_id}`;
    }
    if (structure.primary_source === 'alphafold' && structure.alphafold && structure.alphafold.id) {
      return `AlphaFold ${structure.alphafold.id}`;
    }
    return '';
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
    gameState.guesses.forEach((guess, idx) => {
      const guessNum = gameState.guesses.length - idx;
      const viewerId = `guess-card-${guessNum}-structure`;
      const container = document.getElementById(viewerId);
      if (container && hasStructureData(guess.protein) && !container.querySelector('canvas')) {
        loadStructureViewerInContainer(container, guess.protein).catch((err) => {
          console.error(`Geneguessr: failed to load structure viewer for guess ${guessNum}`, err);
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

  function getStructureViewerOptions(structure) {
    if (!structure) {
      return null;
    }
    if (structure.primary_source === 'pdb' && structure.structure_id) {
      return {
        moleculeId: structure.structure_id,
        assemblyId: '1',
        customData: {
          url: `${RCSB_PDB_DOWNLOAD_URL}${structure.structure_id}.cif`,
          format: 'cif'
        }
      };
    }
    if (structure.primary_source === 'alphafold' && structure.alphafold && structure.alphafold.model_url) {
      return {
        moleculeId: structure.alphafold.id || structure.structure_id || targetProtein?.uniprot,
        customData: {
          url: structure.alphafold.model_url,
          format: 'cif'
        },
        alphafoldView: true
      };
    }
    return null;
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

  function getHintsBalance() {
    const api = hintsApi();
    try {
      return api?.getHints?.() ?? DEFAULT_HINT_COST;
    } catch {
      return DEFAULT_HINT_COST;
    }
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
    try {
      const result = api.revealHint(currentRoundId, hintId, cost);
      if (result && result.success) {
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
  const DEBUG_STYLIZATION = {
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
    const theme = getViewerThemeColors(container);
    safeApplyCanvasProps(viewer, {
      renderer: {
        backgroundColor: toMolstarColor(theme.background),
        ambientColor: toMolstarColor(theme.background),
        ambientIntensity: 0.55,
        interiorDarkening: 0,
      }
    }, 'theme background & ambient colors');
    safeApplyCanvasProps(viewer, {
      postprocessing: {
        outline: {
          name: 'on',
          params: {
            scale: 0.5,
            threshold: 0.35,
            color: toMolstarColor(theme.background),
          },
        },
      },
    }, 'theme outline color');
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
      { name: 'lighting', enabled: DEBUG_STYLIZATION.lighting, fn: () => safeApplyCanvasProps(viewer, {
        renderer: {
          light: [
            {
              inclination: 170,
              azimuth: 45,
              color: toMolstarColor({ r: 255, g: 255, b: 255 }),
              intensity: 1.1,
            },
            {
              inclination: 25,
              azimuth: 200,
              color: toMolstarColor({ r: 255, g: 236, b: 210 }),
              intensity: 0.6,
            }
          ],
        },
      }, 'custom lighting'), delay: 200 },
      { name: 'occlusion', enabled: DEBUG_STYLIZATION.occlusion, fn: () => safeApplyCanvasProps(viewer, {
        postprocessing: {
          occlusion: {
            name: 'on',
            params: {
              samples: 32,
              radius: 4,
              bias: 0.8,
              blurKernelSize: 7,
              resolutionScale: 1
            }
          }
        }
      }, 'ambient occlusion'), delay: 200 },
      { name: 'antialiasing', enabled: DEBUG_STYLIZATION.antialiasing, fn: () => safeApplyCanvasProps(viewer, {
        postprocessing: {
          antialiasing: {
            name: 'fxaa',
            params: {
              edgeThresholdMin: 0.125,
              edgeThresholdMax: 0.25,
              iterations: 2,
              subpixelQuality: 0.75
            }
          }
        }
      }, 'antialiasing'), delay: 150 },
      { name: 'fog', enabled: DEBUG_STYLIZATION.fog, fn: () => safeApplyCanvasProps(viewer, {
        cameraFog: {
          name: 'on',
          params: { intensity: 0.5 }
        }
      }, 'camera fog'), delay: 150 },
      { name: 'outline', enabled: DEBUG_STYLIZATION.outline, fn: () => safeApplyCanvasProps(viewer, {
        postprocessing: {
          outline: {
            name: 'on',
            params: {
              scale: 0.5,
              threshold: 0.35,
              color: toMolstarColor(getViewerThemeColors(container).background)
            }
          }
        }
      }, 'outline'), delay: 150 },
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
    const options = getStructureViewerOptions(structure);
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
      if (viewer.events?.loadComplete) {
        viewer.events.loadComplete.subscribe(() => {
          applyViewerStylizationProfile(viewer, container);
        });
      } else {
        // Fallback: apply shortly after render
        setTimeout(() => applyViewerStylizationProfile(viewer, container), 500);
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
    hintsUnlocked: 1 // Start with 1 hint visible
  };
  
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
        targetId: saved.targetId || null
      };
    } else {
      gameState = {
        date: today,
        guesses: [],
        won: false,
        hintsUnlocked: 1,
        targetId: null
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
        const guessId =
          (entry && entry.protein && entry.protein.uniprot) ||
          entry.uniprot ||
          null;
        const protein = getProteinById(guessId);
        if (!protein) {
          return null;
        }
        const score = scoreGuess(protein, targetProtein);
        const correct =
          typeof entry.correct === "boolean"
            ? entry.correct
            : protein.uniprot === targetProtein.uniprot;
        
        return {
          protein,
          score,
          correct,
          uniprot: protein.uniprot
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
  function buildProteinSections(protein, options = {}) {
    const { forClue = false, matchedDomains = [] } = options;
    const goTermsByAspect = protein.go_terms || {};
    const goTermNamesByAspect = protein.go_terms_named || {};
    const domains = Array.isArray(protein.domains) ? protein.domains : [];
    const reactomePaths = Array.isArray(protein.reactome_pathways) ? protein.reactome_pathways : [];
    
    const sections = [];
    
    // Gene summary section - only show on feedback cards, never on clue cards
    if (protein.gene_summary && !forClue) {
      const summary = protein.gene_summary;
      const summaryText = typeof summary === 'string' ? summary : summary.text;
      const summaryMeta = typeof summary === 'object' && summary.text ? {
        source: summary.source,
        url: summary.url,
      } : null;
      
      sections.push({
        id: 'summary',
        label: '', // No label for summary
        type: 'summary',
        items: [{ 
          text: summaryText,
          meta: summaryMeta,
        }],
      });
    }
    
    const goSectionMeta = [
      { aspect: 'bp', label: 'Biological process' },
      { aspect: 'mf', label: 'Molecular function' },
      { aspect: 'cc', label: 'Cellular component' },
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
      sections.push({
        id: `function-${aspect}`,
        label,
        items: forClue
          ? terms.map((term, idx) => ({ id: `hint-${aspect}-${idx}`, text: term }))
          : terms.map(term => ({ text: term })),
      });
    });
    if (!goSectionAdded) {
      sections.push({
        id: 'function-bp',
        label: 'Biological process',
        items: [{ text: forClue ? 'Not available' : 'Not available', id: forClue ? 'hint-bp-0' : undefined }],
      });
    }

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
      sections.push({
        id: 'reactome',
        label: 'Pathways',
        items: forClue
          ? formattedReactome.map((path, idx) => ({ id: `hint-reactome-${idx}`, text: path }))
          : formattedReactome.map(path => ({ text: path })),
      });
    }
    
    // Domains section
    if (domains.length) {
      sections.push({
        id: 'domains',
        label: 'Domains',
        items: forClue
          ? domains.map((domain, idx) => ({ id: `hint-domain-${idx}`, text: domain }))
          : domains.map(d => ({ 
              text: d, 
              matched: matchedDomains.includes(d) 
            })),
      });
    } else {
      sections.push({
        id: 'domains',
        label: 'Domains',
        items: [{ text: 'No structured domains', id: forClue ? 'hint-domain-0' : undefined }],
      });
    }
    
    // Tissue specificity
    sections.push({
      id: 'tissue',
      label: 'Tissue specificity',
      items: [{ id: forClue ? 'hint-tissue' : undefined, text: protein.tissue.label }],
    });
    
    // Properties (Transmembrane/Secreted)
    sections.push({
      id: 'properties',
      label: 'Properties',
      items: [{
        id: forClue ? 'hint-properties' : undefined,
        text: `${protein.tmh ? 'Transmembrane' : 'Soluble'} · ${protein.secreted ? 'Secreted' : 'Intracellular'}`,
      }],
    });
    
    // Length
    sections.push({
      id: 'length',
      label: 'Length',
      items: [{ id: forClue ? 'hint-length' : undefined, text: `${protein.length} aa` }],
    });
    
    return sections;
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
    
    const sections = buildProteinSections(targetProtein, { forClue: true });
    const structureMarkup = renderStructureViewer(targetProtein, 'pg-clue-structure');
    
    return `
      <div class="pg-clue-card">
        ${structureMarkup}
        <div class="pg-clue-sections" data-clue-sections>
          ${sections.map(renderSpoilerSection).join('')}
        </div>
      </div>
    `;
  }

  // Unified section renderer for both clue and feedback cards
  function renderProteinSection(section, options = {}) {
    const { showSpoilers = false, matchedItems = [] } = options;
    
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
      const text = item.text;
      const isMatched = item.matched || matchedItems.includes(item.text);
     
      // For spoiler mode (clue cards)
      if (showSpoilers && item.id) {
        const revealed = isHintRevealed(item.id);
        return revealed
          ? `<span class="pg-section-entry">${text}</span>`
          : `<span class="pg-section-entry">
              <span class="pg-redaction" 
                    data-hint-id="${item.id}" 
                    role="button" 
                    tabindex="0"
                    aria-label="Click to reveal hint for ${DEFAULT_HINT_COST} hint">
                <span class="pg-redaction-shadow" aria-hidden="true">${text}</span>
                <span class="pg-redaction-cover" aria-hidden="true">${text}</span>
              </span>
            </span>`;
      }
      
      // For feedback mode (guess cards) - apply match highlighting
      if (isMatched) {
        return `<span class="pg-section-entry pg-matched">${text}</span>`;
      }
      
      // Default
      return `<span class="pg-section-entry">${text}</span>`;
    }).join(' ');
    
    return `
      <div class="pg-section">
        ${labelHtml}${itemsHtml}
      </div>
    `;
  }
  
  // Legacy wrapper for clue cards
  function renderSpoilerSection(section) {
    return renderProteinSection(section, { showSpoilers: true });
  }


  
  function renderFeedbackSection(section, score) {
    // Add match indicators for specific sections when score data exists
    let modifiedSection = { ...section };
    
    if (score) {
      if (section.id === 'tissue') {
        modifiedSection.items = section.items.map(item => ({
          ...item,
          text: `${item.text} ${score.tissueMatch ? '✓' : ''}`
        }));
      } else if (section.id === 'properties') {
        modifiedSection.items = section.items.map(item => {
          const text = item.text;
          const parts = text.split(' · ');
          const enhanced = parts.map((part, idx) => {
            const match = idx === 0 ? score.tmMatch : score.secretedMatch;
            return `${part} ${match ? '✓' : ''}`;
          }).join(' · ');
          return { ...item, text: enhanced };
        });
      } else if (section.id === 'length') {
        modifiedSection.items = section.items.map(item => ({
          ...item,
          text: `${item.text} ${score.lengthBinMatch ? '✓' : ''}`
        }));
      }
    }
    
    // Use unified renderer with match highlighting for domains
    const matchedItems = score && section.id === 'domains' 
      ? section.items.filter(item => item.matched).map(item => item.text)
      : [];
    
    return renderProteinSection(modifiedSection, { 
      showSpoilers: false, 
      matchedItems 
    });
  }
  
  function renderResult() {
    const title = gameState.won ? 'You Win!' : 'Game Over';
    const className = gameState.won ? '' : 'failed';
    
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
    
    const newContent = renderClueCard(gameOver);
    
    if (!gameOver) {
      const existingCard = slot.querySelector('.pg-clue-card');
      if (existingCard) {
        const sectionsContainer = existingCard.querySelector('[data-clue-sections]');
        if (sectionsContainer) {
          const sections = buildProteinSections(targetProtein, { forClue: true });
          sectionsContainer.innerHTML = sections.map(renderSpoilerSection).join('');
          setupSpoilerHandlers();
          return;
        }
      }
    }
    
    slot.innerHTML = newContent;
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
            <span class="pg-hints-value">${gameState.hints}</span>
          </div>
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
      const guessNum = gameState.guesses.length;
      const newCardHtml = renderCollapsibleFeedback(latestGuess.protein, latestGuess.score, guessNum, true);
      guessesEl.insertAdjacentHTML('afterbegin', newCardHtml);
      attachCollapseListeners();
      return;
    }
    
    // Full re-render needed (initial load or state mismatch)
    guessesEl.innerHTML = gameState.guesses
      .map((g, idx) => {
        const guessNum = gameState.guesses.length - idx;
        const isLatest = idx === gameState.guesses.length - 1;
        return renderCollapsibleFeedback(g.protein, g.score, guessNum, isLatest);
      })
      .reverse()
      .join('');
    
    // Attach collapse toggle listeners
    attachCollapseListeners();
  }

  function buildFeedbackCardMarkup(protein, options = {}) {
    const {
      score = null,
      cardId = `feedback-card-${protein.uniprot}`,
      collapsible = false,
      expanded = true,
      showSimilarity = Boolean(score),
      headerLabel = protein.hgnc,
    } = options;
    
    const goPercent = showSimilarity && score && typeof score.goPercent === 'number'
      ? score.goPercent
      : null;
    const goValue = goPercent === null ? 'N/A' : `${goPercent}%`;
    const goWidth = goPercent === null ? 0 : goPercent;
    
    const matchedDomains = Array.isArray(score?.domainMatches) ? score.domainMatches : [];
    const sections = buildProteinSections(protein, { forClue: false, matchedDomains });
    const sectionMarkup = sections.map(section => renderFeedbackSection(section, score)).join('');
    
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
  
  function renderCollapsibleFeedback(guess, score, guessNum, isLatest) {
    const cardId = `guess-card-${guessNum}`;
    const expanded = getCardExpansionState(cardId, isLatest);
    
    return buildFeedbackCardMarkup(guess, {
      score,
      cardId,
      collapsible: true,
      expanded,
      showSimilarity: true,
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
      const handleReveal = () => {
        const hintId = redaction.dataset.hintId;
        if (!hintId) return;
        const success = attemptReveal(hintId, DEFAULT_HINT_COST);
        if (success) {
          render();
        }
      };
      
      redaction.addEventListener('click', handleReveal);
      redaction.addEventListener('keydown', (e) => {
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
  function submitGuess() {
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
    gameState.guesses.push({
      protein: guessProtein,
      score: score,
      correct: isCorrect,
      uniprot: guessProtein.uniprot
    });
    
    // Unlock next hint
    if (!isCorrect) {
      gameState.hintsUnlocked = Math.min(gameState.hintsUnlocked + 1, 5);
      awardHints(HINT_REWARD_ON_INCORRECT);
    }
    
    // Check win/loss
    if (isCorrect) {
      gameState.won = true;
      updateStats(true);
    } else if (gameState.guesses.length >= MAX_GUESSES) {
      updateStats(false);
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
    
    sidebarStats.innerHTML = `
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
  
})();
