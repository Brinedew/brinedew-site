// ⚡ PERFORMANCE: Mark navigation start for pre-zero timing measurement
const NAVIGATION_START = performance.now();
console.log(`[TIMING] navigation-start | 0ms (performance.now baseline)`);

/**
 * =============================================================
 * GeneGuessr - Daily Protein Guessing Game
 * =============================================================
 *
 * DATA FLOW (so future-you doesn't get confused):
 * ------------------------------------------------
 * 1. Source of truth: tools/thoteins/data/geneguessr/proteins.json
 *    - Contains all protein metadata including: clans, domain_names, domains, etc.
 *    - This file is NOT deployed via GitHub Pages / normal site build.
 *
 * 2. Database upload: tools/thoteins/scripts/upload_local_database.py --remote
 *    - Uploads proteins.json to Cloudflare D1 database
 *    - Each protein's full JSON is stored in the `metadata` column
 *    - Must run this script after updating proteins.json to see changes live!
 *
 * 3. Cloudflare Worker: workers/index.js
 *    - Serves /api/protein, /api/game/bootstrap, etc.
 *    - Returns protein data including parsed `metadata` JSON from D1
 *
 * 4. Frontend (this file):
 *    - Fetches from API_BASE/api/protein?uniprot=...
 *    - Receives pre-built sections from server in guess entries
 *    - Renders sections directly (server is single source of truth)
 *
 * If new fields aren't showing up:
 *   1. Check proteins.json has the field
 *   2. Run upload_local_database.py --remote
 *   3. Verify worker returns the field in /api/protein response
 *   4. Check buildProteinSections() in workers/lib/game-engine.js uses the field
 * =============================================================
 *
 * Features:
 * - Date-based daily selection
 * - Autocomplete for protein guessing
 * - Progressive hint unlocking
 * - Similarity scoring (GO, domains, length, flags)
 * - Share functionality
 */

(function () {
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

  function safeJsonParse(raw, options = {}) {
    const {
      label = 'value',
      storageKey,
      storageArea = 'local',
      fallback = null
    } = options;
    if (typeof raw !== 'string' || !raw.length) {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      console.error(`[Geneguessr] Failed to parse ${label}`, preview, err);
      if (storageKey) {
        try {
          const storage = storageArea === 'session' ? sessionStorage : localStorage;
          storage.removeItem(storageKey);
        } catch (storageErr) {
          console.warn('Geneguessr: unable to clear corrupt storage for', storageKey, storageErr);
        }
      }
      return fallback;
    }
  }

  function prunePersistedState() {
    try {
      safeJsonParse(localStorage.getItem('geneguessr_stats'), {
        label: 'stats cache',
        storageKey: 'geneguessr_stats',
        storageArea: 'local'
      });
    } catch {
      // ignore localStorage access issues
    }
    try {
      safeJsonParse(sessionStorage.getItem('guessCardStates'), {
        label: 'guessCardStates',
        storageKey: 'guessCardStates',
        storageArea: 'session'
      });
    } catch {
      // ignore sessionStorage access issues
    }
  }

  prunePersistedState();

  // =========================================================================
  // Structure Cache (IndexedDB)
  // =========================================================================
  // Caches structure files and metadata locally to avoid re-downloading.
  // 
  // Stores:
  // - 'structures': cacheKey → ArrayBuffer (the actual structure data)
  // - 'meta': cacheKey → { lastAccess, size } (for LRU eviction)
  // - 'structureInfo': uniprot → { cacheKey, format, sourceLabel, ... } (skip API calls)
  //
  // For guessed proteins, we store by UniProt ID so repeat guesses across
  // days/months skip the API call entirely.
  // =========================================================================
  const STRUCTURE_CACHE_DB = 'geneguessr-structures';
  const STRUCTURE_CACHE_STORE = 'structures';
  const STRUCTURE_CACHE_META_STORE = 'meta';
  const STRUCTURE_INFO_STORE = 'structureInfo'; // NEW: UniProt → structureInfo mapping
  const STRUCTURE_CACHE_VERSION = 4; // v4: force cache clear for linkUrl field
  const STRUCTURE_CACHE_MAX_BYTES = 150 * 1024 * 1024; // 150 MB max cache
  const STRUCTURE_CACHE_MAX_FILE_SIZE = 15 * 1024 * 1024; // Don't cache files > 15 MB
  
  let structureCacheDb = null;
  
  async function openStructureCache() {
    if (structureCacheDb) return structureCacheDb;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STRUCTURE_CACHE_DB, STRUCTURE_CACHE_VERSION);
      
      request.onerror = () => {
        console.warn('[Geneguessr] IndexedDB open failed:', request.error);
        resolve(null);
      };
      
      request.onsuccess = () => {
        structureCacheDb = request.result;
        resolve(structureCacheDb);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        
        if (!db.objectStoreNames.contains(STRUCTURE_CACHE_STORE)) {
          db.createObjectStore(STRUCTURE_CACHE_STORE); // key = cacheKey
        }
        if (!db.objectStoreNames.contains(STRUCTURE_CACHE_META_STORE)) {
          const metaStore = db.createObjectStore(STRUCTURE_CACHE_META_STORE); // key = cacheKey
          metaStore.createIndex('lastAccess', 'lastAccess');
        }
        if (!db.objectStoreNames.contains(STRUCTURE_INFO_STORE)) {
          db.createObjectStore(STRUCTURE_INFO_STORE); // key = uniprot
        }
        
        // Clear STRUCTURE_INFO_STORE when upgrading to v3+ (added linkUrl field)
        if (oldVersion < 4 && db.objectStoreNames.contains(STRUCTURE_INFO_STORE)) {
          const tx = event.target.transaction;
          const store = tx.objectStore(STRUCTURE_INFO_STORE);
          store.clear();
          console.log('[GeneGuessr] Cleared structure info cache for v4 upgrade (added linkUrl)');
        }
      };
    });
  }
  
  // Get cached structureInfo by UniProt ID (skips API call for repeat guesses)
  async function getCachedStructureInfo(uniprot) {
    try {
      const db = await openStructureCache();
      if (!db) return null;
      
      return new Promise((resolve) => {
        const tx = db.transaction(STRUCTURE_INFO_STORE, 'readonly');
        const store = tx.objectStore(STRUCTURE_INFO_STORE);
        const getReq = store.get(uniprot.toUpperCase());
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[Geneguessr] StructureInfo cache read error:', err);
      return null;
    }
  }
  
  // Store structureInfo by UniProt ID
  async function putCachedStructureInfo(uniprot, info) {
    try {
      const db = await openStructureCache();
      if (!db) return;
      
      return new Promise((resolve) => {
        const tx = db.transaction(STRUCTURE_INFO_STORE, 'readwrite');
        const store = tx.objectStore(STRUCTURE_INFO_STORE);
        store.put(info, uniprot.toUpperCase());
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      console.warn('[Geneguessr] StructureInfo cache write error:', err);
    }
  }
  
  async function getStructureFromCache(cacheKey) {
    try {
      const db = await openStructureCache();
      if (!db) return null;
      
      return new Promise((resolve) => {
        const tx = db.transaction([STRUCTURE_CACHE_STORE, STRUCTURE_CACHE_META_STORE], 'readwrite');
        const store = tx.objectStore(STRUCTURE_CACHE_STORE);
        const metaStore = tx.objectStore(STRUCTURE_CACHE_META_STORE);
        
        const getReq = store.get(cacheKey);
        getReq.onsuccess = () => {
          const data = getReq.result;
          if (data) {
            // Update last access time (LRU)
            metaStore.put({ lastAccess: Date.now(), size: data.byteLength || data.size || 0 }, cacheKey);
            resolve(data);
          } else {
            resolve(null);
          }
        };
        getReq.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[Geneguessr] Cache read error:', err);
      return null;
    }
  }
  
  async function putStructureInCache(cacheKey, data, sizeBytes) {
    try {
      // Don't cache files that are too large
      if (sizeBytes > STRUCTURE_CACHE_MAX_FILE_SIZE) {
        console.log(`[Geneguessr] Skipping cache for ${cacheKey} (${Math.round(sizeBytes/1024/1024)}MB > ${STRUCTURE_CACHE_MAX_FILE_SIZE/1024/1024}MB limit)`);
        return;
      }
      
      const db = await openStructureCache();
      if (!db) return;
      
      // Check cache size and evict if needed
      await evictIfNeeded(db, sizeBytes);
      
      return new Promise((resolve) => {
        const tx = db.transaction([STRUCTURE_CACHE_STORE, STRUCTURE_CACHE_META_STORE], 'readwrite');
        const store = tx.objectStore(STRUCTURE_CACHE_STORE);
        const metaStore = tx.objectStore(STRUCTURE_CACHE_META_STORE);
        
        store.put(data, cacheKey);
        metaStore.put({ lastAccess: Date.now(), size: sizeBytes }, cacheKey);
        
        tx.oncomplete = () => {
          console.log(`[Geneguessr] Cached structure ${cacheKey} (${Math.round(sizeBytes/1024)}KB)`);
          resolve();
        };
        tx.onerror = () => resolve();
      });
    } catch (err) {
      console.warn('[Geneguessr] Cache write error:', err);
    }
  }
  
  async function evictIfNeeded(db, incomingSize) {
    try {
      const tx = db.transaction(STRUCTURE_CACHE_META_STORE, 'readonly');
      const metaStore = tx.objectStore(STRUCTURE_CACHE_META_STORE);
      const index = metaStore.index('lastAccess');
      
      // Calculate current cache size
      let totalSize = 0;
      const entries = [];
      
      await new Promise((resolve) => {
        const cursor = index.openCursor();
        cursor.onsuccess = (event) => {
          const c = event.target.result;
          if (c) {
            entries.push({ key: c.primaryKey, ...c.value });
            totalSize += c.value.size || 0;
            c.continue();
          } else {
            resolve();
          }
        };
        cursor.onerror = () => resolve();
      });
      
      // Evict oldest entries until we have room
      if (totalSize + incomingSize > STRUCTURE_CACHE_MAX_BYTES) {
        const evictTx = db.transaction([STRUCTURE_CACHE_STORE, STRUCTURE_CACHE_META_STORE], 'readwrite');
        const evictStore = evictTx.objectStore(STRUCTURE_CACHE_STORE);
        const evictMetaStore = evictTx.objectStore(STRUCTURE_CACHE_META_STORE);
        
        // entries are already sorted by lastAccess (oldest first)
        let freed = 0;
        for (const entry of entries) {
          if (totalSize - freed + incomingSize <= STRUCTURE_CACHE_MAX_BYTES * 0.8) break; // Target 80% after eviction
          evictStore.delete(entry.key);
          evictMetaStore.delete(entry.key);
          freed += entry.size || 0;
          console.log(`[Geneguessr] Evicted ${entry.key} from cache (freed ${Math.round(entry.size/1024)}KB)`);
        }
      }
    } catch (err) {
      console.warn('[Geneguessr] Cache eviction error:', err);
    }
  }
  // =========================================================================

  async function parseJsonResponse(resp, context) {
    if (!resp) {
      throw new Error(`No response for ${context}`);
    }
    const clone = resp.clone();
    try {
      return await resp.json();
    } catch (err) {
      let raw = '';
      try {
        raw = await clone.text();
      } catch (textErr) {
        raw = `[unreadable: ${textErr?.message || textErr}]`;
      }
      const snippet = typeof raw === 'string' && raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      console.error(`[Geneguessr] ${context} JSON parse failed`, snippet, err);
      throw new Error(`Invalid JSON in ${context}`);
    }
  }

  function hasStructureData(protein) {
    if (!protein) {
      return false;
    }
    if (protein.structure_id) {
      return true;
    }
    const structure = protein.structure;
    if (structure &&
      (
        structure.primary_source ||
        (structure.pdb && structure.pdb.id) ||
        (structure.swiss_model && structure.swiss_model.coordinates_url) ||
        (structure.alphafold && structure.alphafold.model_url)
      )) {
      return true;
    }
    // Check for cached structure info
    if (protein.uniprot) {
      const cached = structureTokenCache.get(String(protein.uniprot).toUpperCase());
      if (cached && cached.url) {
        return true;
      }
    }
    return false;
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
      const url = representation.pdb.url || (id ? `https://www.rcsb.org/structure/${id}` : null);
      return { shortLabel: 'PDB', longLabel: id ? `PDB (${id})` : 'PDB', url };
    }
    if (representation.source === 'swissmodel' && representation.swissModel) {
      const url = representation.swissModel.model_url || representation.swissModel.coordinates_url || null;
      return { shortLabel: 'SWISS-MODEL', longLabel: 'SWISS-MODEL', url };
    }
    if (representation.source === 'alphafold' && representation.alphafold) {
      const url = representation.alphafold.viewer_url || representation.alphafold.model_url || null;
      return { shortLabel: 'AlphaFold', longLabel: 'AlphaFold', url };
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
      return { source: representation.source, shortLabel: meta.shortLabel, longLabel: meta.longLabel, url: meta.url, representation };
    }
    return { source: representation.source, shortLabel: representation.source, longLabel: representation.source, representation };
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
      // If we have a chain ID, use PDBe Model Server to extract just that chain
      // This avoids showing massive complexes when we only want the target protein
      const pdbId = representation.pdb.id.toLowerCase();
      const chainId = representation.pdb.chain_id;
      
      let url;
      if (chainId) {
        // PDBe Model Server can filter to specific chain
        url = `https://www.ebi.ac.uk/pdbe/model-server/v1/${pdbId}/atoms?auth_asym_id=${chainId}&encoding=cif`;
      } else {
        // Fall back to full structure
        url = `${RCSB_PDB_DOWNLOAD_URL}${representation.pdb.id}.cif`;
      }
      
      const obj = {
        moleculeId: representation.pdb.id,
        customData: {
          url: url,
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
    // Fast path: use token already hydrated from bootstrap or previous fetch
    // ⚡ PERFORMANCE: Bootstrap embeds token - this should hit immediately after game load
    if (targetStructureInfo && targetStructureInfo.url) {
      console.log(`[TIMING] ensureStructureTokenForTarget | using hydrated token (no API call)`);
      return targetStructureInfo;
    }
    // Fallback: fetch from API (only happens if bootstrap didn't include token)
    console.log(`[TIMING] ensureStructureTokenForTarget | fetching from API (fallback)`);
    try {
      const practiceQuery = gameState.practiceMode ? '&practice=1' : '';
      const resp = await fetch(`${API_BASE}/api/structure-token?type=target${practiceQuery}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        if (resp.status === 404) {
          console.warn('Geneguessr: target structure unavailable (404)');
          targetStructureInfo = null;
          return null;
        }
        throw new Error(`Token request failed: ${resp.status}`);
      }
      const data = await parseJsonResponse(resp, 'target structure token');
      if (!data || !data.url) {
        throw new Error('Missing url in response');
      }
      console.log(`[TIMING] ensureStructureTokenForTarget | API fallback succeeded`);
      targetStructureInfo = {
        sourceLabel: data.sourceLabel || 'Source unavailable',
        displayLabel: data.displayLabel || data.sourceLabel || 'Source unavailable',
        format: data.format || 'cif',
        url: data.url,
        // For client-side IndexedDB caching
        cacheKey: data.cacheKey || null,
        sizeBytes: data.sizeBytes || 0,
        // Convert targetChainHints to chainLabels format for rendering
        // Server sends redacted hints (just chains array), we add is_target=true
        chainLabels: data.targetChainHints?.map(h => ({ ...h, is_target: true })) || null,
        // Total chain count from original structure (for deciding whether to show labels)
        totalChainCount: data.totalChainCount || 0
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
    
    // 1. Check in-memory cache (same session)
    const memCached = structureTokenCache.get(key);
    if (memCached && memCached.url) {
      console.log(`[TIMING] structureInfo for ${key} | memory cache hit`);
      return memCached;
    }
    
    // 2. Check IndexedDB structureInfo cache (persists across sessions)
    //    If we have structureInfo AND the structure blob is cached, skip API entirely
    const t0 = performance.now();
    try {
      const cachedInfo = await getCachedStructureInfo(key);
      // Validate cache has linkUrl field (added in v4) - refetch if null/missing
      // Old cache entries may have linkUrl: null, so check for truthy value
      if (cachedInfo && cachedInfo.cacheKey && cachedInfo.linkUrl) {
        // Verify the structure blob still exists in cache
        const structureBlob = await getStructureFromCache(cachedInfo.cacheKey);
        if (structureBlob) {
          console.log(`[TIMING] token for ${key} | IndexedDB cache hit | ${(performance.now() - t0).toFixed(0)}ms | SKIPPED API`);
          // Reconstruct the URL from cacheKey (IndexedDB doesn't store URLs)
          // CRITICAL: Include upstream URL for SWISS-MODEL and AlphaFold structures.
          // SWISS-MODEL URLs are custom per-protein (with template/range params).
          // AlphaFold URLs include isoform numbers (e.g., AF-P11532-3-F1 not AF-P11532-F1).
          // Only PDB has truly predictable URLs. The worker needs this to lazy-fetch
          // from upstream servers if not already cached in R2.
          let reconstructedUrl = `${API_BASE}/api/structure-cached?key=${encodeURIComponent(cachedInfo.cacheKey)}`;
          if (cachedInfo.upstreamUrl) {
            reconstructedUrl += `&upstream=${encodeURIComponent(cachedInfo.upstreamUrl)}`;
          }
          const hydratedInfo = {
            ...cachedInfo,
            url: reconstructedUrl
          };
          // Store in memory cache too for fast subsequent access
          structureTokenCache.set(key, hydratedInfo);
          return hydratedInfo;
        }
        // Structure blob evicted, need fresh token - fall through to API
        console.log(`[TIMING] token for ${key} | IndexedDB info found but blob evicted, fetching...`);
      } else if (cachedInfo && !cachedInfo.linkUrl) {
        // Old cache entries with linkUrl: null need to be refreshed
        console.log(`[TIMING] token for ${key} | stale cache (linkUrl missing/null), fetching fresh...`);
      }
    } catch (err) {
      console.warn('[Geneguessr] IndexedDB cache check failed:', err);
      // Fall through to API
    }
    
    // 3. Fetch from API
    try {
      console.log(`[TIMING] token for ${key} | fetching from API...`);
      const resp = await fetch(`${API_BASE}/api/structure-token?uniprot=${encodeURIComponent(key)}`, {
        credentials: 'include'
      });
      console.log(`[TIMING] token for ${key} | API responded | ${(performance.now() - t0).toFixed(0)}ms`);
      if (!resp.ok) {
        if (resp.status === 404) {
          console.warn('Geneguessr: structure unavailable for', key);
          structureTokenCache.set(key, null);
          return null;
        }
        throw new Error(`Token request failed: ${resp.status}`);
      }
      const data = await parseJsonResponse(resp, `structure token ${key}`);
      if (!data || !data.url) {
        throw new Error('Missing url in response');
      }
      // Security: don't log data - it may contain chainLabels with gene names
      const info = {
        sourceLabel: data.sourceLabel || 'Source unavailable',
        displayLabel: data.displayLabel || data.sourceLabel || 'Source unavailable',
        format: data.format || 'cif',
        url: data.url,
        // For client-side IndexedDB caching
        cacheKey: data.cacheKey || null,
        sizeBytes: data.sizeBytes || 0,
        chainLabels: data.chainLabels || null,
        linkUrl: data.linkUrl || null,
        // CRITICAL: Store upstreamUrl for SWISS-MODEL and AlphaFold lazy loading.
        // SWISS-MODEL URLs have custom template/range params.
        // AlphaFold URLs include isoform numbers (e.g., AF-P11532-3-F1).
        // Only PDB URLs can be derived from r2Key. This gets stored in IndexedDB.
        upstreamUrl: data.upstreamUrl || null
      };
      structureTokenCache.set(key, info);
      
      // 4. Store structureInfo in IndexedDB for future sessions (token-independent fields only)
      //    When retrieved from cache, we use the blob directly - never need token/url
      if (info.cacheKey) {
        const cacheableInfo = {
          sourceLabel: info.sourceLabel,
          displayLabel: info.displayLabel,
          format: info.format,
          cacheKey: info.cacheKey,
          sizeBytes: info.sizeBytes,
          chainLabels: info.chainLabels,
          linkUrl: info.linkUrl,
          // CRITICAL: Persist upstreamUrl so SWISS-MODEL and AlphaFold work across sessions.
          // Without this, returning users would get 404 for non-PDB guess cards.
          upstreamUrl: info.upstreamUrl
        };
        putCachedStructureInfo(key, cacheableInfo).catch(() => {});
      }
      
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
    if (!protein) {
      return '';
    }
    const linkable = Boolean(options.linkable);
    const structureInfo = options.structureInfo || null;
    const structureSourceSpec = options.structureSource
      || (protein?.uniprot ? { type: 'uniprot', id: protein.uniprot } : null);
    if (structureSourceSpec) {
      viewerStructureSources.set(viewerId, structureSourceSpec);
    } else {
      viewerStructureSources.delete(viewerId);
    }
    const structureSource = getStructureSourceInfo(protein);
    if (structureInfo) {
      viewerStructureInfo.set(viewerId, structureInfo);
    } else {
      viewerStructureInfo.delete(viewerId);
    }
    const linkableAttr = ` data-source-linkable="${linkable ? 'true' : 'false'}"`;
    // Quiz cards: shortLabel (no ID). Feedback cards: longLabel (with ID, linkable).
    // For feedback cards without structureInfo yet, show loading placeholder instead of guessing wrong source.
    const shortLabel = structureInfo?.sourceLabel || structureSource?.shortLabel || 'Source unavailable';
    const longLabel = structureInfo?.displayLabel || structureSource?.longLabel || shortLabel;
    const hasRealData = Boolean(structureInfo?.sourceLabel || structureInfo?.displayLabel);
    const displayLabel = linkable 
      ? (hasRealData ? longLabel : 'Loading...')
      : shortLabel;
    // Prefer linkUrl from structureInfo (API), fall back to structureSource (protein object)
    const linkUrl = linkable && hasRealData ? (structureInfo?.linkUrl || structureSource?.url) : null;
    // Build source text: only link the ID portion (parenthetical), not the whole label
    let sourceText;
    if (linkable && linkUrl && displayLabel.includes('(')) {
      // Extract the ID from parentheses and link only that part
      const match = displayLabel.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (match) {
        const prefix = escapeAttribute(match[1]);
        const id = escapeAttribute(match[2]);
        sourceText = `Source: ${prefix} (<a href="${escapeAttribute(linkUrl)}" target="_blank" rel="noopener" class="pg-structure-source-link">${id}</a>)`;
      } else {
        sourceText = `Source: ${escapeAttribute(displayLabel)}`;
      }
    } else {
      sourceText = `Source: ${escapeAttribute(displayLabel)}`;
    }

    // Toggle is now injected dynamically after viewer loads (see injectChainToggle)

    return `
      <div class="pg-card-structure">
        <div class="pg-card-structure-viewer" id="${viewerId}" role="region" aria-label="3D structure viewer">
          <div class="pg-structure-placeholder" id="${viewerId}-placeholder" hidden>
            <p class="pg-structure-tip">Loading structure.</p>
          </div>
          <div class="pg-structure-loading" id="${viewerId}-loading" hidden>Loading viewer.</div>
          <div class="pg-structure-error" id="${viewerId}-error" hidden></div>
        </div>
        <div class="pg-structure-footer">
          <div class="pg-structure-source" id="${viewerId}-source"${linkableAttr}>
            ${sourceText}
          </div>
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
    // Strip parenthetical ID from fallback to avoid spoiling the answer
    const stripIdFromLabel = (label) => label ? label.replace(/\s*\([^)]*\)$/, '') : label;
    const rawFallbackLabel = metadata?.label || 'Source unavailable';
    const shortLabel = metadata?.shortLabel || stripIdFromLabel(rawFallbackLabel);
    const longLabel = metadata?.longLabel || rawFallbackLabel;
    const label = linkable ? (longLabel || shortLabel) : shortLabel;
    const safeUrl = linkable && metadata?.linkUrl ? escapeAttribute(metadata.linkUrl) : null;
    // Build source text: only link the ID portion (parenthetical), not the whole label
    let inner;
    if (linkable && safeUrl && label.includes('(')) {
      const match = label.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (match) {
        const prefix = escapeAttribute(match[1]);
        const id = escapeAttribute(match[2]);
        inner = `Source: ${prefix} (<a href="${safeUrl}" target="_blank" rel="noopener" class="pg-structure-source-link">${id}</a>)`;
      } else {
        inner = `Source: ${escapeAttribute(label)}`;
      }
    } else {
      inner = `Source: ${escapeAttribute(label)}`;
    }
    sourceEl.innerHTML = inner;
  }

  function renderStructureHint() {
    // Legacy function - no longer used in layout
    return '';
  }

  // Max guess card viewers to load on initial render (clue card and solution card are ALWAYS protected)
  const MAX_GUESS_VIEWERS_ON_LOAD = 4;

  function setupStructureInteractions() {
    // Ensure chain toggle event delegation is set up
    ensureChainToggleDelegation();

    // CRITICAL: Auto-load clue card viewer FIRST and ALWAYS - it must never be evicted
    const clueViewer = document.getElementById('pg-clue-structure');
    if (clueViewer && !renderedViewers.has('pg-clue-structure')) {
      loadStructureViewerInContainer(clueViewer, targetProtein).catch((err) => {
        console.error('Geneguessr: failed to load clue structure viewer', err);
      });
    }

    // Auto-load structure viewer for solution card if present (game over) - also protected
    const solutionViewer = document.getElementById('pg-solution-card-structure');
    const solutionTarget = targetReveal || targetProtein;
    if (solutionViewer && !renderedViewers.has('pg-solution-card-structure')) {
      loadStructureViewerInContainer(solutionViewer, solutionTarget).catch((err) => {
        console.error('Geneguessr: failed to load solution structure viewer', err);
      });
    }

    // Auto-load structure viewers for guess cards - LIMITED to prevent WebGL context exhaustion
    // Only load viewers for the N most recent expanded cards
    let loadedGuessViewers = 0;
    const guessesToLoad = [...gameState.guesses].reverse(); // Most recent first
    
    for (const guess of guessesToLoad) {
      if (loadedGuessViewers >= MAX_GUESS_VIEWERS_ON_LOAD) {
        break;
      }
      
      const cardId = `guess-card-${guess.guessId}`;
      const card = document.getElementById(cardId);
      const viewerId = `${cardId}-structure`;
      const container = document.getElementById(viewerId);
      
      // Only load viewer if card is expanded and not already rendered
      const isExpanded = card?.dataset?.expanded === 'true';
      if (container && isExpanded && !renderedViewers.has(viewerId)) {
        loadStructureViewerInContainer(container, { uniprot: guess.uniprot }).catch((err) => {
          console.error(`Geneguessr: failed to load structure viewer for guess ${guess.guessId}`, err);
        });
        loadedGuessViewers++;
        
        // Track in expansion order for proper eviction later
        if (!expandedGuessCardsOrder.includes(cardId)) {
          expandedGuessCardsOrder.push(cardId);
        }
      }
    }
    
    console.log(`[GeneGuessr] setupStructureInteractions: loaded ${loadedGuessViewers} guess viewers (limit: ${MAX_GUESS_VIEWERS_ON_LOAD})`);
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
      return null;
    }
    // Just fetch and return payload - caller handles state hydration and rendering
    // This avoids double render() calls that cause 3D viewer flash (B-179)
    return revealHintRequest(hintId);
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

  // ==========================================
  // 3D CHAIN CALLOUTS
  // ==========================================
  // One map holds everything: { rafId, positions, lastCamera }
  const calloutState = new Map();
  
  // Mol*'s 'many-distinct' palette (chain-id default)
  // Combines dark-2, set-1, and set-2 from ColorBrewer
  const CHAIN_COLORS = [
    // dark-2 (8 colors)
    '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666',
    // set-1 (9 colors)
    '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999',
    // set-2 (8 colors)
    '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'
  ];
  
  function updateCallouts(viewerId) {
    const viewer = activeViewers.get(viewerId);
    const container = document.getElementById(viewerId);
    if (!viewer?.plugin?.canvas3d?.camera) return;
    
    const overlay = container?.querySelector('.pg-chain-callouts');
    if (!overlay || overlay.style.display === 'none') return;
    
    const state = calloutState.get(viewerId);
    if (!state?.positions) return;
    
    const cam = viewer.plugin.canvas3d.camera;
    
    // Skip if camera hasn't moved (check projectionView matrix)
    const m = cam.projectionView;
    const camKey = m[0] + m[5] + m[10] + m[12] + m[13] + m[14]; // cheap hash
    if (state.lastCamera === camKey) return;
    state.lastCamera = camKey;
    
    // B-177 fix: Use DOM container size instead of canvas viewport.
    // Canvas viewport is in WebGL pixels, but CSS positioning uses browser-zoomed pixels.
    // This ensures callouts stay aligned regardless of browser zoom level.
    const rect = container.getBoundingClientRect();
    const vp = { x: 0, y: 0, width: rect.width, height: rect.height };
    
    overlay.querySelectorAll('.pg-chain-callout[data-chain-id]').forEach(el => {
      const p = state.positions.get(el.dataset.chainId);
      if (!p) { el.style.opacity = '0'; return; }
      
      // Project: homogeneous transform + perspective divide + viewport map
      const w = m[3]*p.x + m[7]*p.y + m[11]*p.z + m[15];
      if (w <= 0) { el.style.opacity = '0'; return; }
      
      const ndcX = (m[0]*p.x + m[4]*p.y + m[8]*p.z + m[12]) / w;
      const ndcY = (m[1]*p.x + m[5]*p.y + m[9]*p.z + m[13]) / w;
      let sx = (ndcX + 1) * 0.5 * vp.width + vp.x;
      let sy = (1 - ndcY) * 0.5 * vp.height + vp.y;
      
      // Edge bias: push 15% of viewport away from center
      const dx = sx - vp.width/2, dy = sy - vp.height/2;
      const d = Math.sqrt(dx*dx + dy*dy) || 1;
      sx += (dx/d) * vp.width * 0.15;
      sy += (dy/d) * vp.height * 0.15;
      
      // Clamp to viewport
      const pad = 10, ew = el.offsetWidth || 80, eh = el.offsetHeight || 24;
      el.style.left = Math.max(pad, Math.min(vp.width - ew - pad, sx - ew/2)) + 'px';
      el.style.top = Math.max(pad, Math.min(vp.height - eh - pad, sy - eh/2)) + 'px';
      el.style.opacity = '1';
    });
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

  // Resolve API base URL (worker lives on geneguessr.brinedew.bio)
  const GRAPHICS_API_BASE = window.location.hostname === 'geneguessr.brinedew.bio'
    ? window.location.origin
    : 'https://geneguessr.brinedew.bio';

  // Fetch graphics settings from API and update DEBUG_STYLIZATION
  fetch(`${GRAPHICS_API_BASE}/api/graphics-settings`, {
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
  const practiceParam = urlParams.get('practice');
  const restartParam = urlParams.get('restart');
  const initialPracticeMode = practiceParam === '1' || (practiceParam || '').toLowerCase() === 'true';
  const initialPracticeRestart = initialPracticeMode && (restartParam === '1' || (restartParam || '').toLowerCase() === 'true');
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

  /**
   * Get 3D position for chain label (10th residue CA, or middle if short).
   */
  function getChainPos(viewer, chainId) {
    const struct = viewer.getStructure?.(1)?.cell?.obj?.data;
    if (!struct?.model?.atomicHierarchy) return null;
    
    const hier = struct.model.atomicHierarchy;
    const conf = struct.model.atomicConformation;
    
    // Find chain by auth_asym_id
    let ci = -1;
    for (let i = 0; i < hier.chains._rowCount; i++) {
      if (hier.chains.auth_asym_id.value(i) === chainId) { ci = i; break; }
    }
    if (ci < 0) return null;
    
    const atomStart = hier.chainAtomSegments.offsets[ci];
    const atomEnd = hier.chainAtomSegments.offsets[ci + 1];
    if (atomStart >= atomEnd) return null;
    
    // Target 10th residue or middle
    const firstRes = hier.residueAtomSegments.index[atomStart];
    const lastRes = hier.residueAtomSegments.index[atomEnd - 1];
    const resCount = lastRes - firstRes + 1;
    const targetRes = firstRes + Math.min(9, Math.floor(resCount / 2));
    
    // Find CA in target residue
    const resStart = hier.residueAtomSegments.offsets[targetRes];
    const resEnd = hier.residueAtomSegments.offsets[targetRes + 1];
    let ai = resStart;
    for (let i = resStart; i < resEnd; i++) {
      if (hier.atoms.label_atom_id.value(i) === 'CA') { ai = i; break; }
    }
    
    return { x: conf.x[ai], y: conf.y[ai], z: conf.z[ai] };
  }
  
  /**
   * Get polymer chain index for color lookup.
   * Only counts polymer chains (not water, ligands, etc.) to match Mol*'s polymer-index coloring.
   */
  function getChainIndex(viewer, chainId) {
    const struct = viewer.getStructure?.(1)?.cell?.obj?.data;
    if (!struct?.model?.atomicHierarchy) return -1;
    const hier = struct.model.atomicHierarchy;
    const entities = struct.model.entities;
    
    // Build a map of polymer chains in order (Mol* uses label_asym_id for polymer-index)
    let polymerIndex = 0;
    for (let i = 0; i < hier.chains._rowCount; i++) {
      // Check if this chain belongs to a polymer entity
      const entityId = hier.chains.label_entity_id.value(i);
      const entityIndex = entities.getEntityIndex(entityId);
      const entityType = entities.data.type.value(entityIndex);
      
      const authAsymId = hier.chains.auth_asym_id.value(i);
      
      if (entityType === 'polymer') {
        if (authAsymId === chainId) return polymerIndex;
        polymerIndex++;
      }
    }
    return -1;
  }

  /**
   * Count total chains across all labels.
   * Needed because homomers have 1 label with multiple chains.
   */
  function countTotalChains(chainLabels) {
    if (!chainLabels) return 0;
    return chainLabels.reduce((sum, l) => sum + (l.chains?.length || 0), 0);
  }

  /**
   * Render chain callouts. Creates DOM, computes positions, sets up RAF loop.
   * Creates one callout per chain (not per label), so multi-chain genes get multiple labels.
   * @param {HTMLElement} container - The viewer container
   * @param {Array} chainLabels - Chain label data
   * @param {number} [totalChainCount] - Optional override for total chain count (for target structures)
   */
  function renderChainLabelCallouts(container, chainLabels, totalChainCount) {
    // Use totalChainCount if provided (for target structures where we only have target chains)
    // Otherwise count from chainLabels
    const effectiveCount = totalChainCount != null ? totalChainCount : countTotalChains(chainLabels);
    if (!container || !chainLabels || effectiveCount <= 1) return;

    const viewerId = container.id;
    const viewer = activeViewers.get(viewerId);
    
    container.querySelector('.pg-chain-callouts')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'pg-chain-callouts pg-chain-callouts-3d';
    // B-171: Toggle removed, labels always visible by default
    overlay.style.display = 'flex';

    // Expand labels to individual chain entries (one callout per chain)
    const expandedChains = [];
    chainLabels.forEach(label => {
      if (!label.chains || !label.chains.length) return;
      label.chains.forEach(chainId => {
        expandedChains.push({
          chainId,
          gene: label.gene,
          name: label.name,
          is_target: label.is_target
        });
      });
    });

    // Target chains first, then all others (no limit)
    const targets = expandedChains.filter(c => c.is_target);
    const others = expandedChains.filter(c => !c.is_target);
    const display = [...targets, ...others];

    // Build state for this viewer
    const positions = new Map();
    
    display.forEach((entry) => {
      const chainId = entry.chainId;
      if (!chainId) return;
      
      const el = document.createElement('div');
      el.className = 'pg-chain-callout pg-chain-callout-3d' + (entry.is_target ? ' pg-chain-callout-target' : '');
      el.dataset.chainId = chainId;
      
      // For target hints (no gene name), show "Target"; otherwise show gene name
      const gene = entry.gene || entry.name?.split(' ')[0] || (entry.is_target ? 'Target' : '?');
      const full = entry.name || entry.gene || (entry.is_target ? 'Target' : '?');
      el.innerHTML = `<span class="pg-chain-label-gene">${escapeAttribute(gene)}</span>` +
                     `<span class="pg-chain-label-full">${escapeAttribute(full)}</span>`;
      
      // Color from chain index
      if (viewer) {
        const ci = getChainIndex(viewer, chainId);
        if (ci >= 0) el.style.color = CHAIN_COLORS[ci % CHAIN_COLORS.length];
        
        const pos = getChainPos(viewer, chainId);
        if (pos) positions.set(chainId, pos);
      }
      
      el.style.opacity = '0';
      overlay.appendChild(el);
    });

    container.appendChild(overlay);
    calloutState.set(viewerId, { rafId: null, positions });
  }
  
  /**
   * Start callout position updates (RAF loop).
   */
  function initializeChainCallouts(viewerId) {
    const state = calloutState.get(viewerId);
    if (!state || state.rafId) return;
    
    const loop = () => {
      updateCallouts(viewerId);
      state.rafId = requestAnimationFrame(loop);
    };
    state.rafId = requestAnimationFrame(loop);
    updateCallouts(viewerId); // immediate first frame
  }
  
  /**
   * Stop callout updates.
   */
  function stopChainCallouts(viewerId) {
    const state = calloutState.get(viewerId);
    if (state?.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  /**
   * Dynamically inject chain visibility toggle into the structure footer.
   * Only adds toggle if this is a linkable viewer (feedback card) with multiple chains.
   */
  function injectChainToggle(container, chainLabels) {
    // MOTHBALLED: Toggle disabled, always show complex (B-171)
    // if (!container || !chainLabels || countTotalChains(chainLabels) <= 1) {
    //   return;
    // }
    return; // Skip toggle injection entirely for now
    
    // Find the structure footer (sibling of the viewer container)
    const structureCard = container.closest('.pg-card-structure');
    if (!structureCard) {
      return;
    }
    
    const footer = structureCard.querySelector('.pg-structure-footer');
    if (!footer) {
      return;
    }
    
    // Check if this is a linkable source (feedback card, not clue card)
    const sourceEl = footer.querySelector('.pg-structure-source');
    if (!sourceEl || sourceEl.dataset.sourceLinkable !== 'true') {
      return;
    }
    
    // Don't add toggle if already present
    if (footer.querySelector('.pg-chain-toggle')) {
      return;
    }
    
    const viewerId = container.id;
    const toggleHtml = `
      <label class="pg-chain-toggle" title="Show chain callouts">
        <input type="checkbox" id="${viewerId}-chain-toggle" class="pg-chain-toggle-input">
        <span class="pg-chain-toggle-track"><span class="pg-chain-toggle-thumb"></span></span>
        <span class="pg-chain-toggle-label">Show complex</span>
      </label>
    `;
    
    // Insert toggle at the start of footer (before source)
    footer.insertAdjacentHTML('afterbegin', toggleHtml);
  }

  /**
   * Set up event delegation for chain visibility toggles.
   * Toggle controls whether non-target chains are visible in the 3D viewer.
   */
  function ensureChainToggleDelegation() {
    if (chainToggleDelegationBound) {
      return;
    }
    
    document.addEventListener('change', async (event) => {
      const toggle = event.target.closest('.pg-chain-toggle-input');
      if (!toggle) {
        return;
      }
      
      const viewerId = toggle.id.replace('-chain-toggle', '');
      const showComplex = toggle.checked;
      
      await applyChainVisibility(viewerId, showComplex);
    });
    
    chainToggleDelegationBound = true;
  }

  // Store per-chain component refs for each viewer
  const viewerChainComponentRefs = new Map();

  /**
   * Create per-chain components using MolScript expressions.
   * This allows us to toggle visibility of individual chains.
   * 
   * Called after structure loads, creates a component for each chain
   * and stores refs in viewerChainComponentRefs for later visibility control.
   */
  async function createPerChainComponents(viewerId, chainLabels) {
    if (viewerChainComponentRefs.get(viewerId)?.size) {
      return true;
    }

    const viewer = activeViewers.get(viewerId);
    if (!viewer || !viewer.plugin) {
      console.warn('[Geneguessr] createPerChainComponents: no viewer/plugin for', viewerId);
      return false;
    }

    const plugin = viewer.plugin;
    const structRef = typeof viewer.getStructure === 'function' ? viewer.getStructure(1) : null;
    const structureCell = structRef?.cell;
    
    if (!structureCell || !structureCell.obj) {
      console.warn('[Geneguessr] createPerChainComponents: no structure cell');
      return false;
    }

    // Collect all chain IDs from chainLabels
    const allChains = [];
    const targetChainSet = new Set();
    const nonTargetChainSet = new Set();
    
    for (const label of chainLabels) {
      for (const chainId of label.chains) {
        allChains.push({ chainId, isTarget: label.is_target, labelName: label.name });
        if (label.is_target) {
          targetChainSet.add(chainId);
        } else {
          nonTargetChainSet.add(chainId);
        }
      }
    }

    console.log('[Geneguessr] createPerChainComponents: creating components for chains:', allChains.map(c => c.chainId));

    try {
      const chainRefs = new Map();
      const builder = plugin.builders?.structure;
      if (!builder || typeof builder.tryCreateComponentFromSelection !== 'function') {
        console.warn('[Geneguessr] createPerChainComponents: builder unavailable');
        return false;
      }

      for (const { chainId, isTarget, labelName } of allChains) {
        try {
          const selections = typeof viewer.getSelections === 'function'
            ? viewer.getSelections([{ auth_asym_id: chainId }], 1)
            : [];
          const selection = selections && selections.length > 0 ? selections[0] : null;

          if (!selection || !selection.loci || !selection.loci.elements || selection.loci.elements.length === 0) {
            console.warn('[Geneguessr] No loci for chain', chainId);
            continue;
          }

          const chainComponent = await builder.tryCreateComponentFromSelection(
            structureCell,
            selection,
            `chain-${chainId}`,
            { label: `Chain ${chainId}${labelName ? ` (${labelName})` : ''}` }
          );

          if (chainComponent) {
            await plugin.builders.structure.representation.addRepresentation(
              chainComponent,
              {
                type: 'cartoon',
                color: 'chain-id',
                size: 'uniform'
              }
            );
            chainRefs.set(chainId, {
              ref: chainComponent.ref,
              isTarget,
              labelName
            });
          } else {
            console.warn('[Geneguessr] Failed to create component for chain', chainId);
          }
        } catch (chainErr) {
          console.warn('[Geneguessr] Error creating component for chain', chainId, chainErr);
        }
      }

      if (chainRefs.size > 0) {
        viewerChainComponentRefs.set(viewerId, chainRefs);

        const polymerComponent = (structRef?.components || []).find(component => {
          const tags = component.cell?.transform?.tags || [];
          return tags.includes('structure-component-static-polymer');
        });
        if (polymerComponent) {
          const polymerRef = polymerComponent.cell.transform.ref;
          const polymerCell = plugin.state?.data?.cells.get(polymerRef);
          if (polymerCell && !polymerCell.state?.isHidden) {
            plugin.state.data.updateCellState(polymerRef, { isHidden: true });
          }
        }

        console.log('[Geneguessr] Stored', chainRefs.size, 'chain component refs for', viewerId);
        return true;
      }

    } catch (err) {
      console.warn('[Geneguessr] createPerChainComponents failed:', err);
    }

    return false;
  }

  /**
   * Apply chain visibility based on toggle state.
   * When OFF (default): Only target chain visible, callouts hidden
   * When ON: All chains visible with coloring, callouts shown
   * 
   * Uses per-chain components created by createPerChainComponents() for granular control.
   * Falls back to hiding the entire default "Polymer" component if per-chain components exist.
   */
  async function applyChainVisibility(viewerId, showComplex) {
    const viewer = activeViewers.get(viewerId);
    const chainData = viewerChainData.get(viewerId);
    const container = document.getElementById(viewerId);
    
    if (!viewer || !chainData || !container) {
      console.warn('[Geneguessr] applyChainVisibility: missing viewer or chain data for', viewerId);
      return;
    }
    
    const { chainLabels, pdbId } = chainData;
    if (!chainLabels || countTotalChains(chainLabels) <= 1) {
      console.log('[Geneguessr] applyChainVisibility: skipping (single chain or no labels)', viewerId);
      return;
    }
    
    // Find target chain(s) and non-target chains
    const targetLabel = chainLabels.find(l => l.is_target);
    const targetChains = new Set(targetLabel ? targetLabel.chains : []);
    const nonTargetChains = new Set(
      chainLabels
        .filter(l => !l.is_target)
        .flatMap(l => l.chains)
    );
    
    console.log('[Geneguessr] applyChainVisibility:', viewerId, { 
      showComplex, 
      targetChains: [...targetChains], 
      nonTargetChains: [...nonTargetChains], 
      pdbId 
    });
    
    // Toggle callout visibility and start/stop position updates
    const callouts = container.querySelector('.pg-chain-callouts');
    if (callouts) {
      callouts.style.display = showComplex ? 'flex' : 'none';
      
      // Start or stop the 3D position update loop
      if (showComplex) {
        initializeChainCallouts(viewerId);
      } else {
        stopChainCallouts(viewerId);
      }
    }
    
    try {
      const plugin = viewer.plugin;
      if (!plugin) {
        console.warn('[Geneguessr] applyChainVisibility: no plugin context available');
        return;
      }
      
      const state = plugin.state.data;
      let chainRefs = viewerChainComponentRefs.get(viewerId);

      if (!chainRefs || chainRefs.size === 0) {
        const created = await createPerChainComponents(viewerId, chainLabels);
        chainRefs = created ? viewerChainComponentRefs.get(viewerId) : null;
      }

      if (!chainRefs || chainRefs.size === 0) {
        console.warn('[Geneguessr] applyChainVisibility: no chain components available');
        return;
      }

      console.log('[Geneguessr] Using per-chain component refs:', chainRefs.size, 'chains');

      for (const [chainId, refData] of chainRefs) {
        const { ref, isTarget } = refData;
        const shouldBeVisible = isTarget || showComplex;
        const shouldBeHidden = !shouldBeVisible;

        const cell = state.cells.get(ref);
        if (cell) {
          const currentlyHidden = Boolean(cell.state?.isHidden);
          if (currentlyHidden !== shouldBeHidden) {
            console.log('[Geneguessr] Toggling chain', chainId, ':', currentlyHidden, '->', shouldBeHidden);
            state.updateCellState(ref, { isHidden: shouldBeHidden });
          }
        }
      }

      console.log('[Geneguessr] applyChainVisibility completed with per-chain refs (showComplex=' + showComplex + ')');
      
    } catch (err) {
      console.warn('[Geneguessr] applyChainVisibility failed:', err);
    }
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
      {
        name: 'lighting', enabled: DEBUG_STYLIZATION.lighting, fn: () => {
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
        }, delay: 200
      },
      {
        name: 'occlusion', enabled: DEBUG_STYLIZATION.occlusion, fn: () => {
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
        }, delay: 200
      },
      {
        name: 'antialiasing', enabled: DEBUG_STYLIZATION.antialiasing, fn: () => {
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
        }, delay: 150
      },
      {
        name: 'fog', enabled: DEBUG_STYLIZATION.fog, fn: () => {
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
        }, delay: 150
      },
      {
        name: 'outline', enabled: DEBUG_STYLIZATION.outline, fn: () => {
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
        }, delay: 150
      },
      {
        name: 'disableMarking', enabled: DEBUG_STYLIZATION.disableMarking, fn: () => safeApplyCanvasProps(viewer, {
          marking: {
            enabled: false,
            edgeScale: 0,
            ghostEdgeStrength: 0,
            innerEdgeFactor: 0,
          }
        }, 'marking disable'), delay: 100
      },
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

  function stopAutoRotationOnInteraction(viewer, containerId) {
    // Only set up once per viewer
    if (viewerInteractionState.get(containerId)) {
      return;
    }

    try {
      // Stop rotation on first drag (rotate/pan gesture)
      const dragSub = viewer.plugin?.canvas3d?.input?.drag?.subscribe(() => {
        if (!viewerInteractionState.get(containerId)) {
          viewerInteractionState.set(containerId, true);
          viewer.visual?.toggleSpin?.(false);
          // Unsubscribe to avoid wasted cycles
          dragSub?.unsubscribe?.();
        }
      });

      // Store subscription for cleanup
      if (!viewer._autoRotateGuards) {
        viewer._autoRotateGuards = { dragSub };
      }
    } catch (err) {
      console.warn('Geneguessr: failed to set up auto-rotation interaction handler', err);
    }
  }

  async function resolveStructureInfoForViewer(containerId, protein) {
    const sourceSpec = viewerStructureSources.get(containerId);
    try {
      if (sourceSpec?.type === 'target') {
        const info = await ensureStructureTokenForTarget();
        if (info?.url) {
          viewerStructureInfo.set(containerId, info);
          return info;
        }
        viewerStructureInfo.set(containerId, { unavailable: true });
        return null;
      } else {
        const uniprot = sourceSpec?.id || protein?.uniprot;
        if (uniprot) {
          const info = await ensureStructureTokenForProtein(uniprot);
          if (info?.url) {
            viewerStructureInfo.set(containerId, info);
            return info;
          }
          viewerStructureInfo.set(containerId, { unavailable: true });
          return null;
        }
      }
    } catch (err) {
      console.warn('Geneguessr: failed to resolve structure info for viewer', containerId, err);
    }
    return viewerStructureInfo.get(containerId) || null;
  }

  async function loadStructureViewerInContainer(container, protein) {
    if (!container || !protein) {
      console.warn('[Geneguessr] loadStructureViewerInContainer: missing container or protein', { container: !!container, protein: !!protein });
      return;
    }

    const containerId = container.id;
    const t0 = performance.now();
    const timing = (label) => console.log(`[TIMING] ${containerId} | ${label} | ${(performance.now() - t0).toFixed(0)}ms`);
    timing('start');
    
    if (renderedViewers.has(containerId)) {
      console.debug('[Geneguessr] loadStructureViewerInContainer: already rendered', containerId);
      return;
    }
    // Mark immediately to prevent duplicate async calls
    renderedViewers.add(containerId);
    const placeholder = document.getElementById(`${containerId}-placeholder`);
    const loadingEl = document.getElementById(`${containerId}-loading`);
    const errorEl = document.getElementById(`${containerId}-error`);
    let structureInfo = viewerStructureInfo.get(containerId);
    timing('got DOM elements');
    console.debug('[Geneguessr] loadStructureViewerInContainer: initial structureInfo', containerId, structureInfo);
    if (!structureInfo || !structureInfo.url) {
      timing('resolving structureInfo (API call)...');
      structureInfo = await resolveStructureInfoForViewer(containerId, protein);
      timing('structureInfo resolved');
      console.debug('[Geneguessr] loadStructureViewerInContainer: resolved structureInfo', containerId, structureInfo);
    } else {
      timing('structureInfo was cached');
    }

    if (structureInfo && structureInfo.unavailable) {
      console.warn('[Geneguessr] loadStructureViewerInContainer: structureInfo marked unavailable', containerId);
      if (errorEl) {
        errorEl.textContent = 'Structure unavailable.';
        errorEl.hidden = false;
      }
      renderedViewers.delete(containerId); // Allow retry on next render
      return;
    }

    if (!structureInfo || !structureInfo.url) {
      console.warn('[Geneguessr] loadStructureViewerInContainer: no structureInfo or url', containerId, structureInfo);
      if (errorEl) {
        errorEl.textContent = 'Structure unavailable.';
        errorEl.hidden = false;
      }
      renderedViewers.delete(containerId); // Allow retry on next render
      return;
    }

    const structureUrl = structureInfo.url;
    console.debug('[Geneguessr] loadStructureViewerInContainer: structureUrl resolved', containerId, structureUrl);
    if (!structureUrl) {
      console.warn('[Geneguessr] loadStructureViewerInContainer: no structureUrl', containerId, structureInfo);
      if (errorEl) {
        errorEl.textContent = 'No 3D structure available for this protein.';
        errorEl.hidden = false;
      }
      renderedViewers.delete(containerId); // Allow retry on next render
      return;
    }

    // Start Mol* asset load in parallel with structure fetch to hide latency on first paint
    const molstarAssetsPromise = ensureMolstarAssets();

    let moleculeId;
    if (structureInfo.sourceLabel === 'PDB') {
      const match = structureInfo.displayLabel.match(/PDB \(([^)]+)\)/);
      moleculeId = match ? match[1] : 'unknown';
    } else if (structureInfo.sourceLabel === 'AlphaFold') {
      moleculeId = protein.uniprot || 'unknown';
    } else if (structureInfo.sourceLabel === 'SWISS-MODEL') {
      const match = structureInfo.displayLabel.match(/SWISS-MODEL \(([^)]+)\)/);
      moleculeId = match ? match[1] : 'unknown';
    } else {
      moleculeId = 'unknown';
    }

    // Check IndexedDB cache first (uses cacheKey which is the r2Key, e.g., "pdb/8J07.bcif")
    const cacheKey = structureInfo.cacheKey;
    const sizeBytes = structureInfo.sizeBytes || 0;
    let finalStructureUrl = structureUrl;
    let blobUrlToRevoke = null;
    
    if (cacheKey) {
      timing('checking IndexedDB cache...');
      const cachedData = await getStructureFromCache(cacheKey);
      if (cachedData) {
        // Cache hit - use blob URL
        timing('cache HIT - using cached structure');
        const blob = new Blob([cachedData], { type: 'application/octet-stream' });
        finalStructureUrl = URL.createObjectURL(blob);
        blobUrlToRevoke = finalStructureUrl;
        console.log(`[Geneguessr] Using cached structure for ${cacheKey}`);
      } else if (sizeBytes > 0 && sizeBytes <= STRUCTURE_CACHE_MAX_FILE_SIZE) {
        // Cache miss but file is small enough to cache - fetch and cache first
        timing('cache MISS - fetching to cache...');
        try {
          // Use cache: 'no-store' to bypass browser HTTP cache and always get fresh data from worker
          const resp = await fetch(structureUrl, { cache: 'no-store' });
          if (resp.ok) {
            const arrayBuffer = await resp.arrayBuffer();
            timing('fetched structure, caching...');
            // Do not block first render on IndexedDB write; fire-and-forget
            putStructureInCache(cacheKey, arrayBuffer, arrayBuffer.byteLength).catch(() => {});
            const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
            finalStructureUrl = URL.createObjectURL(blob);
            blobUrlToRevoke = finalStructureUrl;
            timing('cached and ready');
          }
        } catch (err) {
          console.warn('[Geneguessr] Failed to fetch for caching, will use direct URL:', err);
          // Fall through to use original URL
        }
      } else {
        timing('cache MISS - file too large to cache, using direct URL');
      }
    } else {
      // No cacheKey means this structure wasn't pre-cached (common for target clue structures).
      // Server-side target selection already validated that upstream sources are reachable,
      // so this should succeed. If it fails, Mol* shows its error state gracefully.
      timing('no cacheKey - passing URL to Mol* (will fetch on render)');
      const timestampedUrl = structureUrl + (structureUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
      finalStructureUrl = timestampedUrl;
    }

    // PDBe Molstar requires format: 'cif' with binary: true for BCIF files
    const detectedFormat = detectStructureFormat(structureUrl, structureInfo.format);
    const isBinary = detectedFormat === 'bcif';
    const options = {
      moleculeId,
      customData: {
        url: finalStructureUrl,
        format: isBinary ? 'cif' : detectedFormat,
        binary: isBinary
      }
    };
    
    // If we didn't have a cache hit but the file is small enough, we'll cache it after loading
    const usedCache = blobUrlToRevoke !== null;
    
    // Note: Intentionally not logging options to avoid leaking moleculeId (protein identity)
    console.debug('[Geneguessr] Mol* viewer loading', containerId, 'format:', detectedFormat, 'binary:', isBinary, 'cached:', usedCache);
    if (!options) {
      if (errorEl) {
        errorEl.textContent = 'Could not build viewer options.';
        errorEl.hidden = false;
      }
      renderedViewers.delete(containerId); // Allow retry on next render
      return;
    }

    if (loadingEl) loadingEl.hidden = false;
    if (placeholder) placeholder.hidden = true;
    if (errorEl) errorEl.hidden = true;
    timing('UI updated, loading Mol* assets...');

    try {
      // Use the already-started Mol* load; it may already be warm after the structure fetch
      await molstarAssetsPromise;
      timing('Mol* assets loaded');
      if (!window.PDBeMolstarPlugin) {
        throw new Error('PDBeMolstarPlugin missing after script load');
      }
      container.innerHTML = '';
      timing('container cleared, creating viewer...');
      const viewer = new window.PDBeMolstarPlugin();
      timing('viewer instance created, calling render...');
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
      timing('render() called (async fetch starts)');

      const finalizeViewerStyling = () => {
        timing('loadComplete fired - structure fully rendered');
        
        // Clean up blob URL if we created one (memory cleanup)
        if (blobUrlToRevoke) {
          URL.revokeObjectURL(blobUrlToRevoke);
        }
        
        applyViewerStylizationProfile(viewer, container);
        // Render chain label callouts if available (B-189: includes Target labels for quiz cards)
        // Use totalChainCount for target structures (where chainLabels only has target chains)
        const effectiveCount = structureInfo.totalChainCount || countTotalChains(structureInfo.chainLabels);
        if (structureInfo.chainLabels && effectiveCount > 1) {
          renderChainLabelCallouts(container, structureInfo.chainLabels, structureInfo.totalChainCount);
          // Start the position update loop for 3D callouts
          initializeChainCallouts(containerId);
        }
        // B-201: Start auto-rotation (stops on first user interaction)
        // Use slow spin speed (0.1 = 10x slower than default)
        if (viewer.plugin?.canvas3d) {
          const trackball = viewer.plugin.canvas3d.props.trackball;
          viewer.plugin.canvas3d.setProps({
            trackball: {
              ...trackball,
              animate: { name: 'spin', params: { speed: 0.025 } }
            }
          });
          stopAutoRotationOnInteraction(viewer, containerId);
        }
        // CRITICAL: Recompute card heights AFTER viewer finishes loading.
        // The CSS maxHeight is calculated before Mol* canvas has real dimensions.
        // Without this call, the viewer gets clipped to 0px height and "disappears"
        // after initial render. This was a major bug where viewers would flash
        // briefly then vanish. The loadComplete event fires when canvas is ready.
        syncFeedbackContentHeights();
        timing('styling applied - DONE');
      };
      if (viewer.events?.loadComplete) {
        viewer.events.loadComplete.subscribe(finalizeViewerStyling);
      } else {
        setTimeout(() => {
          timing('fallback timeout fired');
          finalizeViewerStyling();
        }, 500);
      }

      const metadata = {
        shortLabel: structureInfo.sourceLabel,
        longLabel: structureInfo.displayLabel,
        linkUrl: structureInfo.linkUrl
      };
      updateStructureSourceDisplay(containerId, metadata);
      container.dataset.viewerLoaded = 'true';
      structureViewerLoaded = true;
      // renderedViewers.add already called at function start
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
  // Pinned Mol* version for consistent load times (avoids slow @latest npm lookups)
  // Version 3.8.0 is current latest (published Nov 2024, confirmed via npm)
  const MOLSTAR_VERSION = "3.8.0";
  const MOLSTAR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar-plugin.js`;
  const MOLSTAR_FALLBACK_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdbe-molstar@3.7.1/build/pdbe-molstar-plugin.js";
  const MOLSTAR_CSS_URL = `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar.css`;
  const MOLSTAR_PRECONNECT_URL = "https://cdn.jsdelivr.net";
  const RCSB_PDB_DOWNLOAD_URL = "https://files.rcsb.org/download/";
  const DEFAULT_HINT_COST = 1;
  const HINT_REWARD_ON_INCORRECT = 1;
  // MAX_GUESSES: read from gameStatus.maxGuesses (server is single source of truth)
  const LOCKED_HINT_PLACEHOLDER = 'Hint locked';

  // State
  let gameStatus = null;
  let clueData = null;
  let guessEntries = [];
  let targetReveal = null;
  let targetRevealSections = null;
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
    maxGuesses: 10, // Default, overwritten by server on bootstrap
    statsRecorded: false,
    revealedHints: []
  };
  let tutorialBootRequested = false;
  const structureTokenCache = new Map();
  let targetStructureInfo = null;
  const viewerStructureInfo = new Map();
  const viewerStructureSources = new Map();
  const viewerChainData = new Map(); // Track chain labels and state per viewer
  const viewerInteractionState = new Map(); // Track whether user has interacted with each viewer
  const renderedViewers = new Set();
  let chainToggleDelegationBound = false;
  let gamePayload = null;
  let collapseDelegationBound = false;
  let spoilerDelegationBound = false;
  // B-199 + B-206: Track game session to detect when we need to recreate the clue viewer.
  // Date alone is insufficient - same-day restarts with new random targets must trigger viewer rebuild.
  // gameSessionKey = composite of date + restart counter + targetId (when available)
  let lastRenderedGameDate = null;
  let lastRenderedWasGameOver = false;
  let lastRenderedSessionKey = null;
  let practiceRestartCounter = 0; // Increments on each random practice restart
  
  // WebGL context limit enforcement
  // Browser limit is typically 8-16 contexts. Reserve 2 for clue + solution viewers.
  const MAX_EXPANDED_GUESS_CARDS = 4; // Conservative limit to prevent context exhaustion
  const expandedGuessCardsOrder = []; // Track expansion order for auto-collapse

  function markViewerDirty(containerId) {
    if (!containerId) {
      return;
    }
    renderedViewers.delete(containerId);
    viewerStructureInfo.delete(containerId);
    viewerStructureSources.delete(containerId);
    viewerChainData.delete(containerId);
    viewerChainComponentRefs.delete(containerId);
  }

  /**
   * Dispose a Mol* viewer and free its WebGL context.
   * Called when guess cards collapse to stay under browser WebGL limits.
   */
  function disposeViewer(containerId) {
    if (!containerId) {
      return;
    }
    
    const viewer = activeViewers.get(containerId);
    if (viewer && typeof viewer.dispose === 'function') {
      try {
        viewer.dispose();
        console.log(`[GeneGuessr] Disposed viewer for ${containerId}`);
      } catch (err) {
        console.warn(`[GeneGuessr] Error disposing viewer ${containerId}:`, err);
      }
    }
    
    activeViewers.delete(containerId);
    markViewerDirty(containerId);
  }

  function markGuessViewersDirty() {
    for (const id of Array.from(renderedViewers)) {
      if (id.startsWith('guess-card-')) {
        markViewerDirty(id);
      }
    }
  }

  function buildPracticeQuery(options = {}) {
    const practice = typeof options.practice === 'boolean' ? options.practice : Boolean(gameState.practiceMode);
    if (!practice) {
      return '';
    }
    const params = ['practice=1'];
    if (options.restart) {
      params.push('restart=1');
    }
    if (options.sameTarget) {
      params.push('same_target=1');
    }
    if (options.targetId) {
      params.push(`target_id=${encodeURIComponent(options.targetId)}`);
    }
    return `?${params.join('&')}`;
  }

  async function fetchGameBootstrap(options = {}) {
    const response = await fetch(`${API_BASE}/api/game/bootstrap${buildPracticeQuery({
      practice: options.practice,
      restart: options.restart,
      sameTarget: options.sameTarget,
      targetId: options.targetId,
    })}`, {
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Bootstrap failed with status ${response.status}`);
    }
    return response.json();
  }

  async function fetchProteinDetails(uniprot) {
    if (!uniprot) {
      throw new Error('Missing uniprot id');
    }
    const response = await fetch(`${API_BASE}/api/protein?uniprot=${encodeURIComponent(uniprot)}`, {
      credentials: 'include'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Protein lookup failed (${response.status})`);
    }
    return response.json();
  }

  async function submitGuessRequest(uniprot) {
    const normalized = (uniprot || '').toUpperCase();
    const t0 = performance.now();
    const response = await fetch(`${API_BASE}/api/game/guess${buildPracticeQuery()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniprot: normalized })
    });
    console.log(`[TIMING] guess-api-call (network + worker compute) | ${Math.round(performance.now() - t0)}ms`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Guess failed with status ${response.status}`);
    }
    return response.json();
  }

  // Fetch similarity score for a guess (lazy loading)
  async function fetchGuessSimilarity(guessId) {
    const t0 = performance.now();
    const response = await fetch(`${API_BASE}/api/game/guess-similarity${buildPracticeQuery()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guessId })
    });
    console.log(`[TIMING] similarity-api-call | ${Math.round(performance.now() - t0)}ms`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Similarity fetch failed with status ${response.status}`);
    }
    return response.json();
  }

  async function revealHintRequest(hintId) {
    const response = await fetch(`${API_BASE}/api/game/reveal-hint${buildPracticeQuery()}`, {
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
    // B-206: Don't clear targetStructureInfo here - it's cleared in bootstrapGame for new random targets only
    // B-199: Removed lastRenderedTargetStructureId reset - we now track by date/gameOver state
    // The clue viewer persists for the entire game session, not based on targetId
    gamePayload = payload;
    gameStatus = payload.status;
    clueData = payload.clue || { sections: [], allMatches: {}, latestMatches: {} };
    guessEntries = Array.isArray(payload.guesses) ? payload.guesses : [];
    targetProtein = payload.clueTarget ? (cacheEnrichedProtein(payload.clueTarget) || payload.clueTarget) : null;
    targetReveal = payload.targetReveal ? (cacheEnrichedProtein(payload.targetReveal) || payload.targetReveal) : null;
    targetRevealSections = payload.targetRevealSections || null;
    shareText = payload.shareText || '';
    gameState.date = gameStatus.date;
    gameState.guesses = guessEntries;
    gameState.won = Boolean(gameStatus.won);
    gameState.targetId = gameStatus.targetId || targetReveal?.uniprot || targetProtein?.uniprot || null;
    gameState.practiceMode = Boolean(gameStatus.practiceMode);
    gameState.maxGuesses = gameStatus.maxGuesses || 10; // Server is single source of truth
    gameState.statsRecorded = false;
    gameState.revealedHints = Array.isArray(gameStatus.revealedHints) ? [...gameStatus.revealedHints] : [];
    
    // ⚡ PERFORMANCE: Use embedded structure token from bootstrap (eliminates 3s API round-trip)
    if (payload.targetStructureToken && payload.targetStructureToken.url) {
      const preZeroTime = performance.now() - NAVIGATION_START;
      console.log(`[TIMING] pre-zero-time (navigation → first timing log) | ${Math.round(preZeroTime)}ms`);
      console.log('[TIMING] targetStructureInfo hydrated from bootstrap (skipped API call)');
      targetStructureInfo = {
        sourceLabel: payload.targetStructureToken.sourceLabel || 'Source unavailable',
        displayLabel: payload.targetStructureToken.displayLabel || payload.targetStructureToken.sourceLabel || 'Source unavailable',
        format: payload.targetStructureToken.format || 'cif',
        url: payload.targetStructureToken.url,
        cacheKey: null,  // SECURITY: target structures don't expose cacheKey
        sizeBytes: payload.targetStructureToken.sizeBytes || 0,
        chainLabels: payload.targetStructureToken.targetChainHints?.map(h => ({ ...h, is_target: true })) || null,
        totalChainCount: payload.targetStructureToken.totalChainCount || 0
      };
      console.log('[TIMING] targetStructureInfo hydrated from bootstrap (skipped API call)');
    }
    
    // B-206 DEBUG: Log state changes (without exposing target)
    console.log(`[B-206 DEBUG] Hydrated state - date: ${payload.status.date}, guesses: ${guessEntries.length}`);
    
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
  const enrichedProteinsById = new Map();

  function normalizeUniprotId(uniprot) {
    return (uniprot || '').toUpperCase();
  }

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
      go_terms_named: protein.go_terms_named || undefined,
      reactome_pathways: protein.reactome_pathways || undefined,
      gene_summary: protein.gene_summary || undefined,
      structure: protein && protein.structure ? protein.structure : null,
      structure_id: protein && protein.structure_id ? protein.structure_id : null,
      alphafold_id: protein && protein.alphafold_id ? protein.alphafold_id : null,
      synonyms: safeArray(protein.synonyms),
      subcell: safeArray(protein.subcell),
      tissue: protein && protein.tissue ? protein.tissue : { label: "unknown", score: null },
      links: protein && protein.links ? protein.links : {}
    };
  }

  function rememberProteinRecord(protein, options = {}) {
    if (!protein || !protein.uniprot) {
      return null;
    }
    const normalized = normalizeProtein(protein);
    const key = normalizeUniprotId(normalized.uniprot);
    const preferExisting = options.preferExisting !== false;
    if (preferExisting && proteinsById.has(key)) {
      return proteinsById.get(key);
    }
    proteinsById.set(key, normalized);
    return normalized;
  }

  function cacheEnrichedProtein(protein) {
    if (!protein || !protein.uniprot) {
      return null;
    }
    const normalized = normalizeProtein(protein);
    const key = normalizeUniprotId(normalized.uniprot);
    enrichedProteinsById.set(key, normalized);
    proteinsById.set(key, normalized);
    return normalized;
  }

  function getEnrichedProteinById(uniprot) {
    if (!uniprot) {
      return null;
    }
    return enrichedProteinsById.get(normalizeUniprotId(uniprot)) || null;
  }

  function mergeProteinRecords(base, overrides) {
    if (!base) {
      return overrides || null;
    }
    if (!overrides) {
      return base;
    }
    return {
      ...base,
      ...overrides,
      go_terms: overrides.go_terms || base.go_terms,
      go_terms_named: overrides.go_terms_named || base.go_terms_named,
      reactome_pathways: Array.isArray(overrides.reactome_pathways) ? overrides.reactome_pathways : base.reactome_pathways,
      tissue: overrides.tissue || base.tissue,
      structure: overrides.structure || base.structure,
      links: {
        ...(base.links || {}),
        ...(overrides.links || {})
      }
    };
  }

  function getProteinById(id) {
    if (!id) {
      return null;
    }
    const key = normalizeUniprotId(id);
    return proteinsById.get(key) || enrichedProteinsById.get(key) || null;
  }

  async function bootstrapGame(options = {}) {
    // B-206 FIX: Distinguish between "retry same target" and "new random target" restarts.
    // Only clear the clue viewer when getting a NEW random target.
    // Do NOT clear when sameTarget=true (retry with same protein) - viewer stays valid.
    // 
    // Two distinct flows:
    //   - "Try Again" (sameTarget: true): Keep same protein, clear guesses only. Viewer persists.
    //   - "Random Practice" (restart without sameTarget): New protein. Viewer must be recreated.
    //
    // This fixes desync when ?restart=1 gives a new protein but same date.
    const isNewRandomTarget = options.restart && !options.sameTarget;
    if (isNewRandomTarget) {
      practiceRestartCounter++;
      console.log(`[B-206 DEBUG] New random target restart #${practiceRestartCounter}`);
      // Clear viewer tracking + structure token cache to force fresh load
      markViewerDirty('pg-clue-structure');
      targetStructureInfo = null; // Force ensureStructureTokenForTarget to re-fetch
      lastRenderedGameDate = null; // Force full re-render
      lastRenderedSessionKey = null; // Invalidate session key
    } else if (options.restart && options.sameTarget) {
      console.log(`[B-206 DEBUG] Retry same target - viewer persists`);
    }
    const preBootstrapTime = performance.now() - NAVIGATION_START;
    console.log(`[TIMING] pre-bootstrap (navigation → bootstrap call start) | ${Math.round(preBootstrapTime)}ms`);
    const bootstrapStart = performance.now();
    const payload = await fetchGameBootstrap(options);
    const bootstrapDuration = performance.now() - bootstrapStart;
    console.log(`[TIMING] bootstrap-api-call (network + worker compute) | ${Math.round(bootstrapDuration)}ms`);
    hydrateStateFromPayload(payload);
    if (options.practice === true) {
      gameState.practiceMode = true; // ensure client-side practice flag for off-record runs
    }
    // Preload Mol* assets in background - hides CDN latency before first viewer render
    ensureMolstarAssets().catch(() => {});
    const tokenTasks = [];
    tokenTasks.push(ensureStructureTokenForTarget());
    tokenTasks.push(hydrateStructureTokensForGuesses(gameState.guesses));
    const solvedOrExhausted = gameState.won || gameState.guesses.length >= gameState.maxGuesses;
    if (solvedOrExhausted && targetReveal?.uniprot) {
      tokenTasks.push(ensureStructureTokenForProtein(targetReveal.uniprot));
    }
    Promise.allSettled(tokenTasks)
      .then(() => {
        try {
          // Once tokens are hydrated, attempt to load any pending viewers
          setupStructureInteractions();
        } catch (err) {
          console.warn('Geneguessr: error while initializing viewers after token hydration', err);
        }
      })
      .catch((err) => {
        console.warn('Geneguessr: structure token hydration deferred with errors', err);
      });
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
  function renderClueSectionsHtml() {
    const sections = Array.isArray(clueData?.sections) ? clueData.sections : [];
    // B-186: Use latestMatches (most recent guess only), not allMatches (cumulative)
    const latestMatches = clueData?.latestMatches || {};
    return sections.map(section => {
      // Get matched items for this section from latestMatches
      const sectionMatches = latestMatches[section.id] || [];
      return renderSpoilerSection(section, {
        matchedItems: sectionMatches,
        highlightMatches: sectionMatches.length > 0
      });
    }).join('');
  }

  function normalizeMatchText(value) {
    return (value ?? '').toString().trim().toLowerCase();
  }

  function renderLockedHintPlaceholder(item, entryClass) {
    if (!item?.id) {
      return `<span class="${entryClass}">${escapeHtml(item?.placeholder || LOCKED_HINT_PLACEHOLDER)}</span>`;
    }
    const placeholder = item?.placeholder || LOCKED_HINT_PLACEHOLDER;
    const maskLength = Number(item?.maskLength) || placeholder.length || LOCKED_HINT_PLACEHOLDER.length;
    const width = Math.max(maskLength, placeholder.length, LOCKED_HINT_PLACEHOLDER.length);
    
    // Use word-aware mask if server sent wordLengths (prevents reflow on reveal)
    // Falls back to solid block if wordLengths unavailable
    const wordMask = item?.wordLengths ? buildWordMask(item.wordLengths) : null;
    const mask = wordMask || buildMaskCharacters(width);
    
    return (
      `<span class="${entryClass}">` +
      `<span class="pg-redaction" data-hint-id="${escapeAttribute(item.id)}" role="button" tabindex="0" aria-label="Click to reveal hint for ${DEFAULT_HINT_COST} hint" style="min-width:${width}ch">` +
      `<span class="pg-redaction-cover" aria-hidden="true">${mask}</span>` +
      `</span>` +
      `</span>`
    );
  }

  function renderClueCard(gameOver = false) {
    if (gameOver) {
      const solutionTarget = targetReveal || targetProtein;
      const revealStructureInfo = solutionTarget?.uniprot ? getStructureInfoForProtein(solutionTarget.uniprot) : getTargetStructureInfo();
      const solutionStructureSource = solutionTarget?.uniprot
        ? { type: 'uniprot', id: solutionTarget.uniprot }
        : { type: 'target' };
      const latestGuessEntry = Array.isArray(gameState.guesses) && gameState.guesses.length
        ? gameState.guesses[gameState.guesses.length - 1]
        : null;
      const matchedHintMap = latestGuessEntry?.matchedHints || clueData?.latestMatches || {};
      const revealCard = buildFeedbackCardMarkup(solutionTarget, {
        cardId: 'pg-solution-card',
        collapsible: false,
        expanded: true,
        showSimilarity: false,
        headerLabel: solutionTarget?.hgnc || solutionTarget?.uniprot || '',
        fullName: solutionTarget?.full_name || '',
        sections: targetRevealSections || [],
        structureInfo: revealStructureInfo,
        linkable: true,
        structureSource: solutionStructureSource,
        matchedHintMap,
        highlightMatches: true
      });
      return `
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
      structureInfo: getTargetStructureInfo(),
      structureSource: { type: 'target' }
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
      highlightMatches = true,
    } = options;
    const highlightSet = highlightMatches
      ? new Set((matchedItems || []).map(normalizeMatchText))
      : new Set();
    const normalizedRevealed = allRevealedItems || [];
    const revealSetSource = normalizedRevealed.length > 0 ? normalizedRevealed : matchedItems;
    const revealSet = new Set((revealSetSource || []).map(normalizeMatchText));

    // Special handling for gene summary section
    const isEntryUnlocked = (item) => {
      if (!item) return false;
      if (typeof item.revealed === 'boolean') {
        if (item.revealed) return true;
      }
      if (item.id && Array.isArray(gameState.revealedHints)) {
        return gameState.revealedHints.includes(item.id);
      }
      return false;
    };

    if (section.type === 'summary') {
      const item = section.items[0];
      const summaryText = item.text;
      const meta = item.meta;

      // For spoiler mode (clue cards) - hide until revealed
      if (showSpoilers && item.id) {
        const revealed = isEntryUnlocked(item);
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
      const shouldHighlight = highlightMatches && text && highlightSet.has(normalizedText);
      const isMatched = (highlightMatches && Boolean(item.matched)) || shouldHighlight;
      const shouldReveal = text && revealSet.has(normalizedText);

      // For spoiler mode (clue cards)
      if (showSpoilers && item.id) {
        const revealed = isEntryUnlocked(item);
        const forceReveal = removeSpoilers && shouldReveal;
        if ((revealed || forceReveal) && text) {
          const cls = isMatched ? 'pg-section-entry pg-revealed-text matched-highlight' : 'pg-section-entry pg-revealed-text';
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

  // Helper for ordinal numbers (1st, 2nd, 3rd, etc.)
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderFeedbackSection(section, score, matchedItemsForSection = [], options = {}) {
    const highlightMatches = Boolean(options.highlightMatches);
    // Add match indicators for specific sections when score data exists
    let modifiedSection = highlightMatches ? { ...section } : section;

    if (highlightMatches && score) {
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
      matchedItems: highlightMatches ? matchedItemsForSection : [],
      highlightMatches,
    });
  }

  function renderResult() {
    const title = gameState.won ? 'You Win!' : 'Game Over';
    const solution = targetReveal || targetProtein || {};
    const hasIdentity = Boolean(solution.hgnc);
    const proteinLabel = hasIdentity
      ? `${solution.hgnc} (${solution.full_name})`
      : 'Protein identity hidden';
    const uniprotLink = hasIdentity && solution.links?.uniprot ? solution.links.uniprot : null;
    const guessesText = `${gameState.guesses.length}/${gameState.maxGuesses} guesses`;
    // B-208: Discord invite only shown on win screen in proper mode
    const discordInvite = 'https://discord.com/invite/kx8FVzUrpf';
    const showDiscordButton = gameState.won && !practiceMode;

    // Render into the floating bar instead of a separate card; no extra helper text.
    return `
      <div class="pg-gameover-bar" role="status" aria-live="polite">
        <div class="pg-gameover-left">
          <div class="pg-gameover-title">${title}</div>
          <div class="pg-gameover-protein">
            ${hasIdentity && uniprotLink
              ? `<a href="${uniprotLink}" target="_blank" rel="noopener noreferrer">${proteinLabel}</a>`
              : proteinLabel}
          </div>
          <div class="pg-gameover-guesses">${guessesText}</div>
        </div>
        <div class="pg-gameover-right">
          ${showDiscordButton ? `
            <a href="${discordInvite}" class="pg-discord-invite" target="_blank" rel="noopener noreferrer" title="Join the Brinedew Discord server">
              <svg width="16" height="16" viewBox="0 0 71 55" fill="none">
                <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.655 45.5182 70.6886 45.459 70.6942 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="currentColor"/>
              </svg>
              Join Discord
            </a>
          ` : ''}
          <button class="pg-play-again" type="button" onclick="window.geneguessrTryAgain()">
            Try Again
          </button>
          <button class="pg-practice-btn" type="button" onclick="window.geneguessrPracticeRandom()">
            Practice
          </button>
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
      <div id="pg-input-placeholder"></div>
      <div id="pg-input-slot"></div>
      <div id="pg-guesses-container">
        <div id="pg-guesses"></div>
      </div>
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

    const existingViewer = document.getElementById('pg-clue-structure');
    // B-199 + B-206 FOREVER FIX: The clue structure shows the SAME protein for the entire game session.
    // We should NEVER destroy and recreate the 3D viewer mid-game. The only valid reasons to
    // recreate it are:
    //   1. Initial page load (no existing viewer)
    //   2. Transition to/from game over (different card layout)
    //   3. New game session (different date OR different practice restart)
    //
    // CRITICAL: Do NOT use gameState.targetId here - it's intentionally null during active
    // gameplay to prevent answer spoofing. Previous attempts to use it caused the bug where
    // the viewer reloaded on every guess/hint reveal.
    //
    // The correct approach: If the viewer DOM exists AND is in our renderedViewers set,
    // it's already showing the correct structure. Just update the hint sections surgically.
    //
    // B-206: Use gameSessionKey (date + restart counter) to detect new random practice rounds.
    // Date alone is insufficient - same-day restarts with new targets must rebuild viewer.
    //
    // Related bugs: B-184, B-179, B-199, B-206
    
    const viewerAlreadyLoaded = existingViewer && renderedViewers.has('pg-clue-structure');
    const dateChanged = lastRenderedGameDate !== gameState.date;
    const transitioningToGameOver = gameOver && !lastRenderedWasGameOver;
    
    // Compute session key: date + practice restart counter
    const currentSessionKey = `${gameState.date}-${practiceRestartCounter}`;
    const sessionChanged = lastRenderedSessionKey !== currentSessionKey;
    
    // B-206 DEBUG: Log render decision inputs
    console.log(`[B-206 DEBUG] renderClueCard decision:`, {
      viewerAlreadyLoaded,
      dateChanged,
      sessionChanged,
      transitioningToGameOver,
      currentSessionKey,
      lastSessionKey: lastRenderedSessionKey,
      restartCounter: practiceRestartCounter
    });
    
    // Surgical update: viewer exists and loaded, same game session, not transitioning to game over
    // B-206: Must check sessionChanged to catch same-day random restarts
    if (viewerAlreadyLoaded && !dateChanged && !sessionChanged && !transitioningToGameOver) {
      const sectionsContainer = slot.querySelector('.pg-clue-sections');
      if (sectionsContainer) {
        sectionsContainer.innerHTML = renderClueSectionsHtml();
        ensureSpoilerDelegation();
        return;
      }
    }
    
    // Full re-render needed: new session, game over transition, or no existing viewer
    // B-206: Also mark dirty on sessionChanged (catches same-day random restarts)
    if (viewerAlreadyLoaded && (dateChanged || sessionChanged || transitioningToGameOver)) {
      console.log(`[B-206 DEBUG] Marking clue viewer dirty - dateChanged: ${dateChanged}, sessionChanged: ${sessionChanged}`);
      markViewerDirty('pg-clue-structure');
    }
    if (gameOver) {
      markViewerDirty('pg-solution-card-structure');
    }
    slot.innerHTML = renderClueCard(gameOver);
    lastRenderedGameDate = gameState.date;
    lastRenderedSessionKey = currentSessionKey; // B-206: Update session key
    lastRenderedWasGameOver = gameOver;
    ensureSpoilerDelegation();
  }

  function renderInputSection(gameOver) {
    const slot = document.getElementById('pg-input-slot');
    if (!slot) {
      return;
    }
    if (gameOver) {
      slot.innerHTML = renderResult();
      return;
    }
    const hints = getHintsBalance();
    const hintsCount = typeof hints === 'number' ? hints : 0;
    const hintsClass = hintsCount > 0 ? 'pg-hints-badge has-hints' : 'pg-hints-badge';

    slot.innerHTML = `
      <div class="pg-input-section">
        <div class="pg-input-row">
          <div class="pg-autocomplete-wrapper">
            <input type="text" id="pg-input" placeholder="Type gene name here" autocomplete="off" spellcheck="false">
            <div id="pg-suggestions" class="pg-suggestions"></div>
          </div>
          <div class="${hintsClass}">
            <span class="pg-hints-label">Hints</span>
            <span class="pg-hints-value">${hints}</span>
          </div>
          <div class="pg-guesses-badge">
            <span class="pg-guesses-label">Guesses</span>
            <span class="pg-guesses-value">${gameState.guesses.length}/${gameState.maxGuesses}</span>
          </div>
          <button type="button" class="pg-how-to-play" id="pg-how-to-play" title="How to Play">?</button>
        </div>
      </div>
    `;

    const inputEl = document.getElementById('pg-input');
    const suggestionsEl = document.getElementById('pg-suggestions');

    if (inputEl && suggestionsEl) {
      setupAutocomplete(inputEl, suggestionsEl);
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
      cardId = `feedback-card-${protein?.uniprot || 'unknown'}`,
      collapsible = false,
      expanded = true,
      showSimilarity = Boolean(score),
      headerLabel = protein?.hgnc || protein?.uniprot || '',
      fullName = protein?.full_name || '',
      sections = [],
      matchedHintMap = {},
      structureInfo = null,
      linkable = false,
      highlightMatches = false,
    } = options;

    // Handle pending similarity (lazy loading)
    const isPending = score === null || score?.similarityPending;
    const similarityPercent = !isPending && showSimilarity && score && typeof score.percent === 'number'
      ? Math.round(score.percent)
      : null;
    const isLadder = score?.isLadder || false;
    const ladderRank = score?.ladderRank ?? score?.ladder_rank ?? null;
    const rankLabel = isLadder && ladderRank ? `${ordinal(ladderRank)} closest` : '';
    const similarityValue = isPending ? '' : (similarityPercent === null ? 'N/A' : `${similarityPercent}%`);
    const similarityWidth = similarityPercent === null ? 0 : similarityPercent;
    const ladderClass = isLadder ? ' pg-ladder' : '';
    const pendingClass = isPending ? ' pg-pending' : '';

    const sectionMarkup = sections
      .map(section => renderFeedbackSection(
        section,
        score,
        matchedHintMap[section.id] || [],
        { highlightMatches }
      ))
      .join('');

    // Show spinner when similarity is pending, otherwise show score
    const scoreContent = isPending
      ? '<span class="pg-score-spinner"></span>'
      : similarityValue;

    const similarityMarkup = showSimilarity
      ? `
        ${rankLabel ? `<span class="pg-ladder-rank">${rankLabel}</span>` : ''}
        <div class="pg-bar${ladderClass}${pendingClass}">
          <div class="pg-bar-fill${ladderClass}" style="width: ${similarityWidth}%" data-guess-id="${cardId}"></div>
        </div>
        <span class="pg-feedback-score${ladderClass}${pendingClass}" data-guess-id="${cardId}">${scoreContent}</span>
      `
      : '';

    // Add structure viewer above sections
    const viewerId = `${cardId}-structure`;
    const structureMarkup = renderStructureViewer(protein, viewerId, { linkable, structureInfo });

    const contentMarkup = `
      <div class="pg-feedback-content" id="${cardId}-content">
        ${structureMarkup}
        <div class="pg-feedback-protein-name">${fullName}</div>
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
    const isLatestGuess = typeof guessEntry.isLatest === 'boolean' ? guessEntry.isLatest : Boolean(isLatest);
    const expanded = getCardExpansionState(cardId, isLatestGuess);
    const matchedHintMap = guessEntry.matchedHints || {};

    if (!guessEntry.sections) {
      return '';
    }

    // Handle score format: can be null (pending), number, or { percent, isLadder }
    let score = guessEntry.score;
    if (guessEntry.similarityPending) {
      score = null; // Mark as pending
    } else if (typeof score === 'number') {
      // Legacy format: convert to object
      score = { percent: score, isLadder: false };
    }

    return buildFeedbackCardMarkup({ uniprot: guessEntry.uniprot }, {
      score,
      cardId,
      collapsible: true,
      expanded,
      showSimilarity: true,
      headerLabel: guessEntry.headerLabel,
      fullName: guessEntry.fullName,
      sections: guessEntry.sections,
      matchedHintMap,
      structureInfo: getStructureInfoForProtein(guessEntry.uniprot),
      linkable: true,
      highlightMatches: isLatestGuess
    });
  }

  function getCardExpansionState(cardId, isLatest) {
    try {
      const stored = sessionStorage.getItem('guessCardStates');
      if (stored) {
        const states = safeJsonParse(stored, {
          label: 'guessCardStates',
          storageKey: 'guessCardStates',
          storageArea: 'session',
          fallback: {}
        }) || {};
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
      let states = {};
      if (stored) {
        states = safeJsonParse(stored, {
          label: 'guessCardStates',
          storageKey: 'guessCardStates',
          storageArea: 'session',
          fallback: {}
        }) || {};
      }
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

    // WebGL context management: keep viewers alive when collapsed, only dispose when making room for new cards
    const structureContainer = card.querySelector('[id$="-structure"]');
    if (structureContainer) {
      const viewerId = structureContainer.id;
      const cardId = card.id;
      
      if (!newExpanded) {
        // Collapsing: just remove from expansion tracking (keep viewer alive for fast re-expand)
        const idx = expandedGuessCardsOrder.indexOf(cardId);
        if (idx !== -1) {
          expandedGuessCardsOrder.splice(idx, 1);
        }
      } else {
        // Expanding: enforce hard cap by auto-collapsing oldest card if at limit
        if (expandedGuessCardsOrder.length >= MAX_EXPANDED_GUESS_CARDS) {
          const oldestCardId = expandedGuessCardsOrder.shift();
          const oldestCard = document.getElementById(oldestCardId);
          if (oldestCard && oldestCard !== card) {
            // Dispose the oldest card's viewer to free WebGL context
            const oldestViewerId = `${oldestCardId}-structure`;
            disposeViewer(oldestViewerId);
            console.log(`[GeneGuessr] Disposed viewer ${oldestViewerId} to make room for ${cardId}`);
            
            // Collapse the oldest card (UI only, viewer already disposed)
            const oldestToggle = oldestCard.querySelector('.pg-collapse-toggle');
            if (oldestToggle) {
              oldestCard.classList.remove('expanded');
              oldestCard.classList.add('collapsed');
              oldestCard.dataset.expanded = 'false';
              oldestToggle.setAttribute('aria-expanded', 'false');
              const oldestContent = oldestCard.querySelector('.pg-feedback-content');
              const oldestChevron = oldestCard.querySelector('.pg-collapse-chevron');
              if (oldestContent) setFeedbackContentHeight(oldestContent, false);
              if (oldestChevron) oldestChevron.textContent = '▶';
            }
          }
        }
        
        // Track this card's expansion
        if (!expandedGuessCardsOrder.includes(cardId)) {
          expandedGuessCardsOrder.push(cardId);
        }
        
        // Load viewer if not already rendered
        if (!renderedViewers.has(viewerId)) {
          const guess = gameState.guesses.find(g => `guess-card-${g.guessId}` === cardId);
          if (guess) {
            loadStructureViewerInContainer(structureContainer, { uniprot: guess.uniprot }).catch((err) => {
              console.error(`[GeneGuessr] Failed to load structure viewer for ${cardId}:`, err);
            });
          }
        }
      }
    }

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

  /**
   * ⚠️⚠️⚠️ CRITICAL PERFORMANCE PATH - DO NOT TOUCH ⚠️⚠️⚠️
   * 
   * This function reveals hints using SURGICAL DOM UPDATES ONLY.
   * 
   * NEVER call render() in this function! It causes 3+ second delays because:
   *   1. Full DOM re-render of all clue sections
   *   2. setupStructureInteractions() checks/initializes ALL 3D viewers
   *   3. Mol* viewer reload = multiple seconds of WebGL work
   * 
   * The server returns { revealedHint: { id, text }, status: { hintBalance, revealedHints } }
   * We ONLY:
   *   1. Update local state (gameState.revealedHints)
   *   2. Replace the <span class="pg-redaction"> with <span class="pg-revealed-text">
   *   3. Update hint balance displays
   * 
   * If you're debugging slow reveals:
   *   - Check if server returns revealedHint (if not, we fall back to slow path)
   *   - Check if render() is being called anywhere in this flow
   *   - Check if any code triggers renderClueSectionsIntoDom
   * 
   * See Linear issue B-205 for the full horror story of this bug.
   */
  async function activateSpoiler(redaction) {
    const hintId = redaction.dataset.hintId;
    if (!hintId || redaction.dataset.loading === 'true') {
      return;
    }
    const startTime = performance.now();
    redaction.dataset.loading = 'true';
    redaction.classList.add('pg-redaction-loading');
    try {
      const payload = await requestHintReveal(hintId);
      const networkTime = performance.now() - startTime;
      console.log(`[HINT REVEAL] Network round-trip: ${Math.round(networkTime)}ms`);
      
      // Surgical DOM update - no render(), no viewer touching
      // Server returns { revealedHint: { id, text }, status: { hintBalance, revealedHints } }
      if (payload.revealedHint && payload.revealedHint.text) {
        // Update local state (for future renders if they happen)
        if (payload.status) {
          gameStatus = { ...gameStatus, ...payload.status };
          gameState.revealedHints = payload.status.revealedHints || gameState.revealedHints;
        }
        
        // Swap the redaction element with revealed text
        // Structure: <span class="pg-section-entry"><span class="pg-redaction">...</span></span>
        // We replace just the pg-redaction with the revealed text span
        const revealedSpan = document.createElement('span');
        revealedSpan.className = 'pg-revealed-text';
        revealedSpan.textContent = payload.revealedHint.text;
        redaction.replaceWith(revealedSpan);
        
        // Update hint balance display
        updateHintDisplays();
        
        const totalTime = performance.now() - startTime;
        const domTime = totalTime - networkTime;
        console.log(`[HINT REVEAL] DOM update: ${Math.round(domTime)}ms | Total: ${Math.round(totalTime)}ms (surgical path)`);
      } else {
        // Fallback path for backward compatibility (slow)
        console.warn(`[HINT REVEAL] Falling back to full render() - API did not return revealedHint! Response:`, payload);
        hydrateStateFromPayload(payload);
        updateHintDisplays();
        render();
        const totalTime = performance.now() - startTime;
        console.warn(`[HINT REVEAL] Total: ${Math.round(totalTime)}ms (SLOW FALLBACK PATH)`);
      }
      
      // Show tutorial step 3 after first hint reveal
      if (window.GeneGuessrTutorial && window.GeneGuessrTutorial.maybeShowStep) {
        window.GeneGuessrTutorial.maybeShowStep(3);
      }
    } catch (err) {
      console.warn('Geneguessr: hint reveal failed', err);
      flashHintsWarning();
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
      // No redundant guesses counter - already shown in input bar badge
      slot.innerHTML = '';
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
    if (saved) {
      const parsed = safeJsonParse(saved, {
        label: 'stats cache',
        storageKey: 'geneguessr_stats',
        storageArea: 'local'
      });
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
    return {
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
  const SEARCH_MAX_RESULTS = 3;
  const AUTOCOMPLETE_DEBOUNCE_MS = 120;
  let autocompleteAbortController = null;

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

  async function searchProteins(query) {
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return [];
    }
    const guessedIds = (gameState.guesses || []).map((g) => normalizeUniprotId(g.uniprot)).filter(Boolean);
    const guessedSet = new Set(guessedIds);
    if (autocompleteAbortController) {
      autocompleteAbortController.abort();
    }
    const controller = new AbortController();
    autocompleteAbortController = controller;
    try {
      const excludeParam = guessedIds.length ? `&exclude=${guessedIds.join(',')}` : '';
      const response = await fetch(`${API_BASE}/api/proteins?query=${encodeURIComponent(cleanedQuery)}&limit=${SEARCH_MAX_RESULTS}${excludeParam}`, {
        credentials: 'include',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Protein search failed with status ${response.status}`);
      }
      const payload = await response.json();
      const normalizedResults = Array.isArray(payload)
        ? payload
          .map((protein) => rememberProteinRecord(protein))
          .filter(Boolean)
        : [];
      // Server already excludes guessed proteins and limits results
      const matches = normalizedResults
        .map((protein) => ({
          protein,
          score: getSearchScore(protein, cleanedQuery.toLowerCase()),
        }))
        .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.protein.hgnc.localeCompare(b.protein.hgnc);
        })
        .map((entry) => entry.protein);
      if (autocompleteAbortController === controller) {
        autocompleteAbortController = null;
      }
      return matches;
    } catch (err) {
      if (autocompleteAbortController === controller) {
        autocompleteAbortController = null;
      }
      if (err.name !== 'AbortError') {
        console.warn('Geneguessr: protein search failed', err);
      }
      return [];
    }
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
    let debounceHandle = null;
    let requestToken = 0;

    const hideSuggestions = () => {
      suggestionsEl.innerHTML = '';
      suggestionsEl.style.display = 'none';
      selectedIndex = -1;
    };

    const attachClickHandlers = () => {
      suggestionsEl.querySelectorAll('.pg-suggestion').forEach((el) => {
        el.addEventListener('click', () => {
          const uniprot = el.dataset.uniprot;
          if (uniprot) {
            selectProteinAndSubmit(uniprot);
          }
        });
      });
    };

    inputEl.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (debounceHandle) {
        clearTimeout(debounceHandle);
      }
      if (!query) {
        hideSuggestions();
        return;
      }
      const currentToken = ++requestToken;

      // Dynamic positioning logic
      const rect = inputEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const SUGGESTIONS_HEIGHT_ESTIMATE = 300;

      if (spaceBelow < SUGGESTIONS_HEIGHT_ESTIMATE && spaceAbove > spaceBelow) {
        suggestionsEl.classList.add('pg-suggestions-above');
      } else {
        suggestionsEl.classList.remove('pg-suggestions-above');
      }

      debounceHandle = setTimeout(async () => {
        suggestionsEl.innerHTML = '<div class="pg-suggestion">Searching...</div>';
        suggestionsEl.style.display = 'block';
        const matches = await searchProteins(query);
        if (currentToken !== requestToken) {
          return;
        }
        if (!matches.length) {
          suggestionsEl.innerHTML = '<div class="pg-suggestion">No matches found</div>';
          suggestionsEl.style.display = 'block';
          selectedIndex = -1;
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
        attachClickHandlers();
      }, AUTOCOMPLETE_DEBOUNCE_MS);
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
          if (uniprot) {
            selectProteinAndSubmit(uniprot);
          }
        }
      } else if (e.key === 'Escape') {
        hideSuggestions();
      }
    });

    function updateSelectedSuggestion(suggestions) {
      suggestions.forEach((el, idx) => {
        el.classList.toggle('selected', idx === selectedIndex);
      });
    }
  }

  function selectProtein(uniprot) {
    if (!uniprot) return;
    const normalizedId = normalizeUniprotId(uniprot);
    const protein = getProteinById(normalizedId) || getEnrichedProteinById(normalizedId);
    const label = protein?.hgnc || normalizedId;

    const inputEl = document.getElementById('pg-input');
    const suggestionsEl = document.getElementById('pg-suggestions');
    if (inputEl) {
      inputEl.value = label;
    }
    if (suggestionsEl) {
      suggestionsEl.innerHTML = '';
      suggestionsEl.style.display = 'none';
    }

    const submitBtn = document.getElementById('pg-submit');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.dataset.uniprot = normalizedId;
    }
  }

  function selectProteinAndSubmit(uniprot) {
    if (!uniprot) return;
    const normalizedId = normalizeUniprotId(uniprot);
    const protein = getProteinById(normalizedId) || getEnrichedProteinById(normalizedId);
    const label = protein?.hgnc || normalizedId;

    const inputEl = document.getElementById('pg-input');
    const suggestionsEl = document.getElementById('pg-suggestions');
    if (inputEl) {
      inputEl.value = label;
    }
    if (suggestionsEl) {
      suggestionsEl.innerHTML = '';
      suggestionsEl.style.display = 'none';
    }

    submitGuessWithUniprot(normalizedId);
  }

  async function handleGuessPayload(uniprot, payload, guessStartTime) {
    // Update game state
    hydrateStateFromPayload(payload);

    // Cache embedded guess structure token if present to skip /api/structure-token
    if (payload.guessStructureToken && payload.guessStructureToken.url) {
      const key = uniprot.toUpperCase();
      const guessInfo = {
        sourceLabel: payload.guessStructureToken.sourceLabel || 'Source unavailable',
        displayLabel: payload.guessStructureToken.displayLabel || payload.guessStructureToken.sourceLabel || 'Source unavailable',
        format: payload.guessStructureToken.format || 'cif',
        url: payload.guessStructureToken.url,
        cacheKey: payload.guessStructureToken.cacheKey || null,
        sizeBytes: payload.guessStructureToken.sizeBytes || 0,
        chainLabels: payload.guessStructureToken.chainLabels || null,
        linkUrl: payload.guessStructureToken.linkUrl || null,
        // CRITICAL: Store upstreamUrl for SWISS-MODEL and AlphaFold lazy loading.
        // Without this, if the local blob is evicted and needs re-fetching,
        // the worker can't derive the upstream URL (multi-isoform proteins, templates, etc.)
        upstreamUrl: payload.guessStructureToken.upstreamUrl || null
      };
      structureTokenCache.set(key, guessInfo);
      console.log(`[TIMING] guess-submit | cached embedded guessStructureToken for ${key}`);
      if (guessInfo.cacheKey) {
        putCachedStructureInfo(key, {
          sourceLabel: guessInfo.sourceLabel,
          displayLabel: guessInfo.displayLabel,
          format: guessInfo.format,
          cacheKey: guessInfo.cacheKey,
          sizeBytes: guessInfo.sizeBytes,
          chainLabels: guessInfo.chainLabels,
          linkUrl: guessInfo.linkUrl,
          // CRITICAL: Persist upstreamUrl so SWISS-MODEL and AlphaFold work across sessions.
          upstreamUrl: guessInfo.upstreamUrl
        }).catch(() => {});
      }
    }

    // Ensure sections are present; otherwise refresh via bootstrap
    let newGuess = gameState.guesses.find(g => g.uniprot === uniprot);
    if (!newGuess?.sections) {
      console.warn('[Geneguessr] Guess missing sections, forcing bootstrap refresh...');
      const bootstrapT0 = performance.now();
      try {
        const bootstrapPayload = await fetchGameBootstrap();
        console.log(`[TIMING] guess-submit | bootstrap fallback | ${Math.round(performance.now() - bootstrapT0)}ms`);
        hydrateStateFromPayload(bootstrapPayload);
      } catch (err) {
        console.error('[Geneguessr] Bootstrap fallback failed', err);
      }
    }

    if (guessStartTime != null) {
      console.log(`[TIMING] guess-submit | render() start | ${Math.round(performance.now() - guessStartTime)}ms`);
    }
    render();
    if (guessStartTime != null) {
      console.log(`[TIMING] guess-submit | render() done | ${Math.round(performance.now() - guessStartTime)}ms`);
    }

    // ⚡ LAZY SIMILARITY: Fetch similarity for pending guesses in background
    // This allows the card to appear instantly while we calculate similarity
    const pendingGuess = gameState.guesses.find(g => g.uniprot === uniprot && g.similarityPending);
    console.log(`[TIMING] similarity check | uniprot=${uniprot}, found=${!!pendingGuess}, similarityPending=${pendingGuess?.similarityPending}, score=${pendingGuess?.score}`);
    if (pendingGuess && pendingGuess.guessId) {
      console.log(`[TIMING] fetching similarity for guessId=${pendingGuess.guessId}`);
      fetchGuessSimilarity(pendingGuess.guessId)
        .then(result => {
          // API returns { guessId, score: { percent, similarity, isLadder, ... } }
          const scoreData = result?.score;
          const scorePercent = typeof scoreData === 'number' ? scoreData : scoreData?.percent;
          if (typeof scorePercent === 'number') {
            const isLadder = scoreData?.isLadder || false;
            const rawLadderRank = (scoreData && typeof scoreData === 'object')
              ? (scoreData.ladderRank ?? scoreData.ladder_rank ?? null)
              : null;
            let ladderRank = rawLadderRank;
            // Fallback: in ladder mode, percent 91-99 encodes rank as (100 - percent).
            if (ladderRank == null && isLadder) {
              const rounded = Math.round(scorePercent);
              if (rounded >= 91 && rounded <= 99) {
                ladderRank = 100 - rounded;
              }
            }
            // Update game state
            const guess = gameState.guesses.find(g => g.guessId === pendingGuess.guessId);
            if (guess) {
              if (scoreData && typeof scoreData === 'object') {
                const hydratedScore = { ...scoreData };
                if (isLadder && ladderRank && hydratedScore.ladderRank == null && hydratedScore.ladder_rank == null) {
                  hydratedScore.ladderRank = ladderRank;
                }
                guess.score = hydratedScore;
              } else {
                guess.score = { percent: scorePercent, isLadder, ladderRank: isLadder ? ladderRank : null };
              }
              guess.similarityPending = false;
            }
            // Update DOM elements
            const cardId = `guess-card-${pendingGuess.guessId}`;
            const scoreEl = document.querySelector(`.pg-feedback-score[data-guess-id="${cardId}"]`);
            const barFillEl = document.querySelector(`.pg-bar-fill[data-guess-id="${cardId}"]`);
            const barEl = scoreEl?.previousElementSibling;
            const headerEl = scoreEl?.closest('.pg-collapse-toggle');
            
            if (scoreEl) {
              scoreEl.textContent = `${scorePercent}%`;
              scoreEl.classList.remove('pg-pending');
              if (isLadder) scoreEl.classList.add('pg-ladder');
            }
            if (barFillEl) {
              barFillEl.style.width = `${scorePercent}%`;
              if (isLadder) barFillEl.classList.add('pg-ladder');
            }
            if (barEl) {
              barEl.classList.remove('pg-pending');
              if (isLadder) barEl.classList.add('pg-ladder');
            }

            // Ensure ladder rank label is shown for top-9 matches (fixes missing callout on lazy-loaded similarity).
            if (headerEl) {
              const existingRankEl = headerEl.querySelector('.pg-ladder-rank');
              const rankLabel = (isLadder && ladderRank) ? `${ordinal(ladderRank)} closest` : '';
              if (rankLabel) {
                const rankEl = existingRankEl || document.createElement('span');
                rankEl.className = 'pg-ladder-rank';
                rankEl.textContent = rankLabel;
                if (!existingRankEl) {
                  if (barEl && barEl.parentElement === headerEl) {
                    headerEl.insertBefore(rankEl, barEl);
                  } else {
                    headerEl.appendChild(rankEl);
                  }
                }
              } else if (existingRankEl) {
                existingRankEl.remove();
              }
            }

            console.log(`[TIMING] similarity loaded for ${pendingGuess.guessId} | ${scorePercent}%`);
          } else {
            console.warn(`[TIMING] similarity returned unexpected format:`, result);
          }
        })
        .catch(err => {
          console.warn('Geneguessr: similarity fetch failed', err);
          // Show N/A on error
          const cardId = `guess-card-${pendingGuess.guessId}`;
          const scoreEl = document.querySelector(`.pg-feedback-score[data-guess-id="${cardId}"]`);
          if (scoreEl) {
            scoreEl.textContent = 'N/A';
            scoreEl.classList.remove('pg-pending');
          }
        });
    }

    // Kick off structure token hydration (guess + optional target reveal)
    const tokenTasks = [ensureStructureTokenForProtein(uniprot)];
    const reachedEndOfRound = gameState.won || gameState.guesses.length >= gameState.maxGuesses;
    if (reachedEndOfRound && targetReveal?.uniprot) {
      tokenTasks.push(ensureStructureTokenForProtein(targetReveal.uniprot));
    }
    Promise.allSettled(tokenTasks)
      .then(() => {
        requestAnimationFrame(() => setupStructureInteractions());
      })
      .catch((err) => {
        console.warn('Geneguessr: structure token fetch after guess failed', err);
      });

    // Reset input + tutorial hint
    const inputEl = document.getElementById('pg-input');
    if (inputEl) {
      inputEl.value = '';
    }
    if (window.GeneGuessrTutorial && window.GeneGuessrTutorial.maybeShowStep) {
      window.GeneGuessrTutorial.maybeShowStep(2);
    }
  }

  async function submitGuessWithUniprot(uniprot) {
    if (!uniprot) {
      alert('Please select a protein from the suggestions.');
      return;
    }

    const guessProtein = getProteinById(uniprot) || getEnrichedProteinById(uniprot);
    if (!guessProtein) {
      alert('Please select a protein from the suggestions.');
      return;
    }

    try {
      const payload = await submitGuessRequest(uniprot);
      await handleGuessPayload(uniprot, payload, null);
    } catch (err) {
      console.error('[Geneguessr] Guess submission failed', err);
      alert('Failed to submit guess. Please try again.');
    }
  }

  /**
   * Handle guess submission
   */
  async function submitGuess() {
    const submitBtn = document.getElementById('pg-submit');
    const inputEl = document.getElementById('pg-input');
    let uniprot = normalizeUniprotId(submitBtn.dataset.uniprot || '');

    // If no UniProt ID is attached (user typed but didn't select), try to resolve it
    if (!uniprot && inputEl && inputEl.value.trim()) {
      const query = inputEl.value.trim();
      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = '...';

      try {
        const matches = await searchProteins(query);
        // Look for exact match on symbol
        const exactMatch = matches.find(p =>
          p.hgnc.toUpperCase() === query.toUpperCase()
        );

        if (exactMatch) {
          uniprot = normalizeUniprotId(exactMatch.uniprot);
        } else if (matches.length > 0) {
          // If top result is a very strong match (score 0 or 1), use it
          // But for safety, let's stick to exact symbol matches or ask user to select
          const best = matches[0];
          if (best.hgnc.toUpperCase() === query.toUpperCase()) {
            uniprot = normalizeUniprotId(best.uniprot);
          }
        }
      } catch (err) {
        console.warn('Auto-resolution failed', err);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }

    if (!uniprot) {
      alert('Please select a protein from the suggestions before submitting.');
      return;
    }

    const guessProtein = getProteinById(uniprot) || getEnrichedProteinById(uniprot);
    // If we auto-resolved, we might need to fetch details if not in cache, 
    // but searchProteins calls rememberProteinRecord so it should be there.

    if (!guessProtein) {
      alert('Please select a protein from the suggestions before submitting.');
      return;
    }

    if (submitBtn.disabled) return;

    submitBtn.disabled = true;
    const previousLabel = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    const guessT0 = performance.now();

    try {
      console.log(`[TIMING] guess-submit | start`);
      const payload = await submitGuessRequest(uniprot);
      console.log(`[TIMING] guess-submit | API returned | ${Math.round(performance.now() - guessT0)}ms`);
      await handleGuessPayload(uniprot, payload, guessT0);
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
      const simScore = typeof g.score?.similarity === 'number' ? g.score.similarity : 0;
      return simScore >= 0.35 ? '🟨' : '⬜';
    }).join('');

    return `Geneguessr ${today}
${emoji} ${guessCount}/${gameState.maxGuesses}

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
      const gameOver = Boolean(gameState.won || (gameStatus && gameStatus.lost) || gameState.guesses.length >= gameState.maxGuesses);

      hydrateLayoutOnce();
      renderClueSectionsIntoDom(gameOver);
      renderInputSection(gameOver);
      renderGuessesSection();
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
  // API lives on geneguessr.brinedew.bio worker, not the static site
  const API_BASE = window.location.hostname === 'geneguessr.brinedew.bio'
    ? window.location.origin
    : 'https://geneguessr.brinedew.bio';

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

    const stats = loadStats();
    const practiceMode = !!gameState?.practiceMode;

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
              <svg width="16" height="16" viewBox="0 0 71 55" fill="none">
                <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.655 45.5182 70.6886 45.459 70.6942 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="currentColor"/>
              </svg>
              Join my Discord
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

    const practiceLabel = practiceMode ? 'ON' : 'OFF';

    sidebarStats.innerHTML = `
      ${authSection}
      <div class="pg-sidebar-section">
        <div class="pg-hints-badge pg-sidebar-practice-badge ${practiceMode ? 'has-hints' : ''}">
          <span class="pg-hints-label">Practice Mode</span>
          <span class="pg-hints-value">${practiceLabel}</span>
        </div>
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
  window.geneguessrLogout = async function () {
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

  window.geneguessrTryAgain = async function () {
    try {
      setStatus('loading-data');
      await bootstrapGame({ practice: true, restart: true, sameTarget: true, targetId: gameState.targetId });
      render();
      setStatus('rendered');
    } catch (err) {
      console.error('Try again failed', err);
      alert('Failed to start a try-again round. Please try again.');
      setStatus('errored');
    }
  };

  window.geneguessrPracticeRandom = async function () {
    try {
      setStatus('loading-data');
      await bootstrapGame({ practice: true, restart: true });
      render();
      setStatus('rendered');
    } catch (err) {
      console.error('Practice round failed', err);
      alert('Failed to start a practice round. Please try again.');
      setStatus('errored');
    }
  };

  function updateSidebarStats() {
    // Update inline hints badge
    const inlineHints = document.querySelector('.pg-hints-value');
    if (inlineHints) {
      inlineHints.textContent = getHintsBalance();
    }

    const sidebarPractice = document.querySelector('.pg-sidebar-practice-badge');
    if (sidebarPractice) {
      const practiceMode = !!gameState?.practiceMode;
      const practiceValue = sidebarPractice.querySelector('.pg-hints-value');
      if (practiceValue) {
        practiceValue.textContent = practiceMode ? 'ON' : 'OFF';
      }
      sidebarPractice.classList.toggle('has-hints', practiceMode);
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

    const initialBootstrapOptions = initialPracticeMode
      ? { practice: true, restart: initialPracticeRestart }
      : undefined;

    try {
      await bootstrapGame(initialBootstrapOptions);
    } catch (err) {
      console.error('Geneguessr: failed to initialise game state', err);
      const detail = err?.stack || err?.message || String(err);
      reportError('init-game-failed', detail);
      return;
    }

    // Render
    render();
    setStatus('rendered');

    // Attach collapse handler for attribution card (outside geneguessr-root)
    attachAttributionToggle();

    if (!tutorialBootRequested && window.GeneGuessrTutorial && typeof window.GeneGuessrTutorial.boot === 'function') {
      tutorialBootRequested = true;
      window.GeneGuessrTutorial.boot();
    }
  }

  // Handle attribution card collapse (card is in markdown, outside geneguessr-root)
  function attachAttributionToggle() {
    const card = document.getElementById('attribution-card');
    if (!card) return;
    const toggle = card.querySelector('.pg-collapse-toggle');
    if (!toggle || toggle.dataset.listenerAttached) return;
    toggle.dataset.listenerAttached = 'true';
    toggle.addEventListener('click', function() {
      const content = document.getElementById('attribution-content');
      const chevron = card.querySelector('.pg-collapse-chevron');
      const expanded = card.dataset.expanded === 'true';
      const next = !expanded;
      card.classList.toggle('expanded', next);
      card.classList.toggle('collapsed', !next);
      card.dataset.expanded = String(next);
      toggle.setAttribute('aria-expanded', next);
      if (chevron) chevron.textContent = next ? '▼' : '▶';
      // Set display and max-height for smooth CSS animation
      if (content) {
        if (next) {
          // First show the content so we can measure it
          content.style.display = 'block';
          content.style.maxHeight = 'none';
          const height = content.scrollHeight;
          content.style.maxHeight = '0px';
          // Force reflow to enable transition
          void content.offsetHeight;
          content.style.maxHeight = height + 'px';
        } else {
          content.style.maxHeight = '0px';
          // Hide after transition completes (matches CSS transition duration)
          setTimeout(() => {
            if (card.dataset.expanded !== 'true') {
              content.style.display = 'none';
            }
          }, 300);
        }
      }
    });
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

  function buildMaskCharacters(length) {
    const cap = Math.min(Math.max(Number(length) || LOCKED_HINT_PLACEHOLDER.length, LOCKED_HINT_PLACEHOLDER.length), 64);
    return '█'.repeat(cap);
  }

  /**
   * Build redaction mask from word lengths array.
   * Each word becomes a span of █ characters, separated by spaces.
   * This reflows identically to the underlying text on window resize.
   */
  function buildWordMask(wordLengths) {
    if (!Array.isArray(wordLengths) || wordLengths.length === 0) {
      return null;
    }
    return wordLengths.map(len => {
      const capped = Math.min(Math.max(Number(len) || 1, 1), 64);
      return '█'.repeat(capped);
    }).join(' ');
  }

})();

