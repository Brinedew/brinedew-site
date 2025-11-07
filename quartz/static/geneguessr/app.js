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

  function renderStructureHint() {
    if (!targetProtein || !hasStructureData(targetProtein)) {
      return '';
    }
    const structure = targetProtein.structure || {};
    const meta = getStructureMetaLabel(structure);
    const subtitle = meta ? `<div class="pg-structure-meta">${meta}</div>` : '';
    const guidance = structure.primary_source === 'alphafold'
      ? 'Predicted structure provided by AlphaFold DB.'
      : 'Experimental structure from the Protein Data Bank.';
    
    const btnLabel = structureViewerLoaded ? '3D Loaded' : 'View 3D';
    const btnDisabledAttr = structureViewerLoaded ? 'disabled' : '';
    return `
      <div class="pg-structure-card">
        <div class="pg-structure-header">
          <div>
            <div class="pg-structure-title">3D Structure</div>
            ${subtitle}
          </div>
          <button id="pg-view-3d-btn" class="pg-view-3d-btn" type="button" ${btnDisabledAttr}>${btnLabel}</button>
        </div>
        <div class="pg-structure-viewer" id="pg-structure-viewer" role="region" aria-label="3D structure viewer">
          <div class="pg-structure-placeholder" id="pg-structure-placeholder">
            <p>${guidance}</p>
            <p class="pg-structure-tip">Viewer loads on demand via PDBe Mol★.</p>
          </div>
          <div class="pg-structure-loading" id="pg-structure-loading" hidden>Loading viewer…</div>
          <div class="pg-structure-error" id="pg-structure-error" hidden></div>
        </div>
      </div>
    `;
  }

  function setupStructureInteractions() {
    const btn = document.getElementById('pg-view-3d-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        loadStructureViewer().catch((err) => {
          console.error('Geneguessr: failed to load structure viewer', err);
        });
      });
      if (structureViewerLoaded && hasStructureData(targetProtein)) {
        loadStructureViewer().catch((err) => {
          console.error('Geneguessr: failed to restore structure viewer', err);
        });
      }
    }
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

  async function loadStructureViewer() {
    if (!targetProtein || !hasStructureData(targetProtein)) {
      return;
    }
    const container = document.getElementById('pg-structure-viewer');
    const placeholder = document.getElementById('pg-structure-placeholder');
    const loadingEl = document.getElementById('pg-structure-loading');
    const errorEl = document.getElementById('pg-structure-error');
    const button = document.getElementById('pg-view-3d-btn');
    
    if (!container) {
      return;
    }
    
    const structure = targetProtein.structure || {};
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
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading…';
    }
    
    try {
      await ensureMolstarAssets();
      if (!window.PDBeMolstarPlugin) {
        throw new Error('PDBeMolstarPlugin missing after script load');
      }
      container.innerHTML = '';
      const viewer = new window.PDBeMolstarPlugin();
      viewer.render(container, {
        ...options,
        loadControls: true,
        hideControls: [],
        hideCanvasControls: [],
      });
      container.dataset.viewerLoaded = 'true';
      structureViewerLoaded = true;
      if (button) {
        button.textContent = '3D Loaded';
      }
    } catch (err) {
      console.error('Geneguessr: Mol* render failed', err);
      if (errorEl) {
        errorEl.textContent = 'Could not load 3D viewer. Please try again.';
        errorEl.hidden = false;
      }
      if (placeholder) placeholder.hidden = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'View 3D';
      }
    } finally {
      if (loadingEl) loadingEl.hidden = true;
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
  let gameState = {
    date: null,
    guesses: [],
    won: false,
    hintsUnlocked: 1 // Start with 1 hint visible
  };
  
  // DOM elements (will be populated on init)
  let rootEl;
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
    const meta = getGoSimilarityMetadata();
    if (!meta) {
      return 'GO Similarity';
    }
    const aspect = meta.aspect === 'biological_process'
      ? 'BP'
      : (meta.aspect || '');
    const metric = meta.metric ? meta.metric.toUpperCase() : '';
    const aggregation = meta.aggregation ? meta.aggregation.toUpperCase() : '';
    const metricPart = metric && aggregation ? `${metric}+${aggregation}` : (metric || aggregation);
    const pieces = [aspect, metricPart].filter(Boolean);
    return pieces.length ? `GO Similarity (${pieces.join(', ')})` : 'GO Similarity';
  }
  
  function formatGoSimilarityNote() {
    const meta = getGoSimilarityMetadata();
    if (!meta) {
      return '';
    }
    const details = [];
    if (meta.go_release) {
      details.push(`GO ${meta.go_release}`);
    }
    if (meta.evidence_policy) {
      details.push(meta.evidence_policy);
    }
    if (meta.generated_at) {
      const built = String(meta.generated_at);
      details.push(`built ${built.slice(0, 10)}`);
    }
    return details.join(' · ');
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
  function renderClueCard() {
    const maxHints = Math.min(gameState.hintsUnlocked, 5);
    
    return `
      ${renderStructureHint()}
      <div class="pg-clue-card">
        ${maxHints >= 1 ? `
          <div class="pg-clue-section">
            <div class="pg-clue-label">Function</div>
            <div class="pg-chips">
              ${targetProtein.go_slim.slice(0, maxHints >= 3 ? 5 : 2).map(term => 
                `<span class="pg-chip">${term}</span>`
              ).join('')}
            </div>
          </div>
        ` : ''}
        
        ${maxHints >= 2 ? `
          <div class="pg-clue-section">
            <div class="pg-clue-label">Tissue Specificity</div>
            <div class="pg-chip">${targetProtein.tissue.label}</div>
          </div>
        ` : ''}
        
        ${maxHints >= 3 ? `
          <div class="pg-clue-section">
            <div class="pg-clue-label">Domains</div>
            <div class="pg-chips">
              ${targetProtein.domains.slice(0, 2).map(domain => 
                `<span class="pg-chip">${domain}</span>`
              ).join('')}
            </div>
          </div>
        ` : ''}
        
        ${maxHints >= 4 ? `
          <div class="pg-clue-section">
            <div class="pg-clue-label">Properties</div>
            <div class="pg-flags">
              <div class="pg-flag">
                <span>${targetProtein.tmh ? 'Transmembrane' : 'Soluble'}</span>
              </div>
              <div class="pg-flag">
                <span>${targetProtein.secreted ? 'Secreted' : 'Intracellular'}</span>
              </div>
            </div>
          </div>
        ` : ''}
        
        ${maxHints >= 5 ? `
          <div class="pg-clue-section">
            <div class="pg-clue-label">Length</div>
            <div>${targetProtein.length} amino acids</div>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  function renderFeedbackPanel(guess, score) {
    const goLabel = formatGoSimilarityLabel();
    const goPercent = typeof score.goPercent === 'number' ? score.goPercent : null;
    const goValue = goPercent === null ? 'N/A' : `${goPercent}%`;
    const goWidth = goPercent === null ? 0 : goPercent;
    const goNote = formatGoSimilarityNote();
    
    return `
      <div class="pg-feedback">
        <div class="pg-feedback-header">
          <span class="pg-feedback-protein">${guess.hgnc}</span>
          <span>${guess.length} aa</span>
        </div>
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">${goLabel}</span>
          <div class="pg-bar">
            <div class="pg-bar-fill" style="width: ${goWidth}%"></div>
          </div>
          <span class="pg-feedback-value">${goValue}</span>
        </div>
        ${goNote ? `<div class="pg-feedback-note">${goNote}</div>` : ''}
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">Domains</span>
          <div class="pg-chips">
            ${guess.domains.map(d => `
              <span class="pg-chip ${score.domainMatches.includes(d) ? 'matched' : 'unmatched'}">${d}</span>
            `).join('')}
          </div>
        </div>
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">Length Bin</span>
          <span class="pg-feedback-value">${score.lengthBinMatch ? 'Yes' : 'No'}</span>
        </div>
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">Transmembrane</span>
          <span class="pg-feedback-value">${score.tmMatch ? 'Yes' : 'No'}</span>
        </div>
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">Secreted</span>
          <span class="pg-feedback-value">${score.secretedMatch ? 'Yes' : 'No'}</span>
        </div>
        
        <div class="pg-feedback-row">
          <span class="pg-feedback-label">Tissue</span>
          <span class="pg-feedback-value">${score.tissueMatch ? 'Yes' : 'No'}</span>
        </div>
      </div>
    `;
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
      const matches = proteins.filter(p => {
        return p.hgnc.toLowerCase().includes(query) ||
               p.synonyms.some(s => s.toLowerCase().includes(query)) ||
               p.full_name.toLowerCase().includes(query);
      }).slice(0, 8); // limit to 8 suggestions
      
      if (matches.length === 0) {
        suggestionsEl.innerHTML = '<div class="pg-suggestion">No matches found</div>';
        suggestionsEl.style.display = 'block';
        return;
      }
      
      suggestionsEl.innerHTML = matches.map((p, idx) => `
        <div class="pg-suggestion" data-uniprot="${p.uniprot}" data-index="${idx}">
          <strong>${p.hgnc}</strong> — ${p.full_name}
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
    const gameOver = gameState.won || gameState.guesses.length >= MAX_GUESSES;
    
    rootEl.innerHTML = `
      ${renderStats()}
      
      <h2>Today's Protein</h2>
      ${renderClueCard()}
      
      ${!gameOver ? `
        <div class="pg-input-section">
          <div class="pg-autocomplete-wrapper">
            <input 
              type="text" 
              id="pg-input" 
              class="pg-input" 
              placeholder="Type protein name (e.g., TP53, EGFR)..."
              autocomplete="off"
            />
            <div id="pg-suggestions" class="pg-suggestions"></div>
          </div>
          <button id="pg-submit" class="pg-submit-btn" disabled>Submit Guess</button>
        </div>
      ` : ''}
      
      <div id="pg-guesses">
        ${gameState.guesses.map(g => renderFeedbackPanel(g.protein, g.score)).reverse().join('')}
      </div>
      
      ${gameOver ? renderResult() : ''}
      
      ${gameOver ? `
        <div class="pg-share-section">
          <button id="pg-share-btn" class="pg-share-btn">Share Result</button>
          <div id="pg-share-feedback" class="pg-share-feedback"></div>
        </div>
      ` : `
        <div style="text-align: center; margin-top: 1rem; color: var(--gray);">
          ${gameState.guesses.length}/${MAX_GUESSES} guesses
        </div>
      `}
    `;
    
    // Setup event listeners
    if (!gameOver) {
      const inputEl = document.getElementById('pg-input');
      const suggestionsEl = document.getElementById('pg-suggestions');
      const submitBtn = document.getElementById('pg-submit');
      
      setupAutocomplete(inputEl, suggestionsEl);
      
      submitBtn.addEventListener('click', submitGuess);
      
      // Clear button state on input change
      inputEl.addEventListener('input', () => {
        submitBtn.disabled = true;
        delete submitBtn.dataset.uniprot;
      });
    } else {
      const shareBtn = document.getElementById('pg-share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', shareResult);
      }
    }
    
    setupStructureInteractions();
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
