import { isAlphaFoldOnlyProtein } from './game-engine.js';
import { sanitizeProteinSummary } from './structure-utils.js';

const MAX_CACHE_SIZE = 512;
const MAX_EMBEDDING_CACHE_SIZE = 256;
const proteinCache = new Map();
const embeddingCache = new Map();
const eligibleCache = {
  ids: null,
  fetchedAt: 0,
  ttl: 5 * 60 * 1000
};
let structureFailureTableEnsured = false;

function normalizeKey(uniprot) {
  return (uniprot || '').toUpperCase();
}

function rememberProtein(key, value) {
  if (!key || !value) {
    return;
  }
  proteinCache.set(key, value);
  if (proteinCache.size > MAX_CACHE_SIZE) {
    const oldestKey = proteinCache.keys().next().value;
    proteinCache.delete(oldestKey);
  }
}

function rememberEmbedding(key, vector) {
  if (!key) {
    return;
  }
  if (!vector) {
    embeddingCache.delete(key);
    return;
  }
  embeddingCache.set(key, vector);
  if (embeddingCache.size > MAX_EMBEDDING_CACHE_SIZE) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

function cloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (Array.isArray(value)) {
    const u8 = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const byte = value[i];
      u8[i] = (typeof byte === 'number' && Number.isFinite(byte))
        ? (byte & 0xFF)
        : 0;
    }
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  if (ArrayBuffer.isView(value) && value?.buffer instanceof ArrayBuffer) {
    const { buffer, byteOffset = 0, byteLength } = value;
    const length = typeof byteLength === 'number' ? byteLength : buffer.byteLength;
    return buffer.slice(byteOffset, byteOffset + length);
  }
  return null;
}

function toFloat32Vector(row) {
  if (!row?.vector) {
    return null;
  }
  let buffer = cloneArrayBuffer(row.vector);
  // Some D1 clients or drivers return BLOBs as hex or base64 strings.
  // If so, convert them into ArrayBuffer/Uint8Array for Float32Array view.
  if (!buffer && typeof row.vector === 'string') {
    const s = row.vector.trim();
    // Hex string (even length, only hex chars)
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      const len = s.length / 2;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        u8[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      }
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    } else {
      // Attempt base64 decode common in web contexts
      try {
        const bin = atob(s);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) {
          u8[i] = bin.charCodeAt(i);
        }
        buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      } catch (e) {
        buffer = null;
      }
    }
  }
  if (!buffer || buffer.byteLength === 0) {
    return null;
  }
  const vector = new Float32Array(buffer);
  const dim = Number(row.dim);
  if (Number.isFinite(dim) && dim > 0) {
    if (vector.length === dim) {
      return vector;
    }
    if (vector.length > dim) {
      return vector.slice(0, dim);
    }
    return null;
  }
  return vector;
}

function toProteinObject(row) {
  if (!row) {
    return null;
  }
  // Parse JSON array columns
  const parseJson = (str) => {
    if (!str) return [];
    try { return JSON.parse(str); } catch { return []; }
  };
  
  return {
    id: row.id,
    uniprot: row.uniprot,
    gene: row.gene,
    hgnc: row.gene,  // alias for game engine compatibility
    full_name: row.full_name,
    length: row.length,
    mass: row.mass,
    tmh: Boolean(row.tmh),
    secreted: Boolean(row.secreted),
    tissue: { label: row.tissue_label, score: null },
    has_structure: Boolean(row.has_structure),
    structure_source: row.structure_source,
    pdb_id: row.pdb_id,
    pdb_chain_id: row.pdb_chain_id,
    pdb_coverage: row.pdb_coverage,
    pdb_resolution: row.pdb_resolution,
    pdb_method: row.pdb_method,
    pdb_chain_labels: row.pdb_chain_labels,
    swissmodel_coverage: row.swissmodel_coverage,
    swissmodel_qmean: row.swissmodel_qmean,
    swissmodel_template: row.swissmodel_template,
    swissmodel_url: row.swissmodel_url,
    swissmodel_chain_labels: row.swissmodel_chain_labels,
    alphafold_plddt: row.alphafold_plddt,
    alphafold_url: row.alphafold_url,
    gene_summary: row.gene_summary,
    origin_age: row.origin_age,
    first_pub_year: row.first_pub_year,
    // JSON arrays
    synonyms: parseJson(row.synonyms),
    domains: parseJson(row.domains),
    domain_names: parseJson(row.domains),  // same as domains (already names)
    clans: parseJson(row.clans),
    subcell: parseJson(row.locations),
    // GO terms in expected structure
    go_terms: {
      bp: parseJson(row.go_bp),
      mf: parseJson(row.go_mf),
      cc: parseJson(row.go_cc)
    },
    go_terms_named: {
      bp: parseJson(row.go_bp),
      mf: parseJson(row.go_mf),
      cc: parseJson(row.go_cc)
    },
    // Pathways as expected structure
    reactome_pathways: parseJson(row.pathways)
  };
}

export async function fetchProteinByUniprot(db, uniprot) {
  const key = normalizeKey(uniprot);
  if (!key) {
    return null;
  }
  if (proteinCache.has(key)) {
    return proteinCache.get(key);
  }
  let protein = null;
  try {
    const row = await db.prepare(
      `SELECT * FROM proteins WHERE upper(uniprot) = ? LIMIT 1`
    ).bind(key).first();
    protein = toProteinObject(row);
  } catch (err) {
    console.warn('GeneGuessr: D1 fetchProteinByUniprot failed', err);
  }
  if (protein) {
    rememberProtein(key, protein);
  }
  return protein || null;
}

export async function fetchProteinSummaries(db, limit = 100) {
  const { results } = await db.prepare(
    `SELECT uniprot, gene, full_name, length
     FROM proteins
     ORDER BY gene
     LIMIT ?`
  ).bind(limit).all();
  return (results || []).map((row) => sanitizeProteinSummary(row));
}

export async function fetchProteinEmbedding(db, geneSymbol) {
  if (!geneSymbol) {
    return null;
  }
  const key = geneSymbol.toUpperCase();
  if (embeddingCache.has(key)) {
    return embeddingCache.get(key);
  }
  const row = await db.prepare(
    `SELECT vector, dim FROM protein_embeddings WHERE upper(gene_symbol) = ? LIMIT 1`
  ).bind(key).first();
  const vector = toFloat32Vector(row);
  rememberEmbedding(key, vector);
  return vector;
}

async function ensureStructureFailureTable(db) {
  if (!db || structureFailureTableEnsured) {
    return;
  }
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS structure_failures (
       uniprot TEXT PRIMARY KEY,
       failed_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  structureFailureTableEnsured = true;
}

export async function markStructureFailure(db, uniprot) {
  if (!db || !uniprot) {
    return;
  }
  await ensureStructureFailureTable(db);
  await db.prepare(
    `INSERT INTO structure_failures (uniprot, failed_at)
     VALUES (upper(?), CURRENT_TIMESTAMP)
     ON CONFLICT(uniprot) DO UPDATE SET failed_at = excluded.failed_at`
  ).bind(uniprot).run();
}

export async function clearStructureFailure(db, uniprot) {
  if (!db || !uniprot) {
    return;
  }
  await ensureStructureFailureTable(db);
  await db.prepare(
    `DELETE FROM structure_failures WHERE uniprot = upper(?)`
  ).bind(uniprot).run();
}

export async function searchProteins(db, query, limit = 20, exclude = []) {
  if (!query || !query.trim()) {
    return [];
  }
  await ensureStructureFailureTable(db);
  const needle = query.trim().toLowerCase();
  const wildcard = `%${needle}%`;
  const prefix = `${needle}%`;
  
  // Build exclusion clause if needed
  let excludeClause = '';
  const excludeBindings = [];
  if (exclude.length > 0) {
    const placeholders = exclude.map(() => '?').join(',');
    excludeClause = `AND upper(p.uniprot) NOT IN (${placeholders})`;
    excludeBindings.push(...exclude);
  }
  
  try {
    const statement = `
      SELECT p.uniprot, p.gene, p.full_name, p.length,
        MIN(
          CASE
            WHEN lower(p.gene) = ? THEN 0
            WHEN s.normalized = ? THEN 1
            WHEN lower(p.gene) LIKE ? ESCAPE '\\' THEN 2
            WHEN s.normalized LIKE ? ESCAPE '\\' THEN 3
            WHEN lower(p.full_name) LIKE ? ESCAPE '\\' THEN 4
            WHEN lower(p.gene) LIKE ? ESCAPE '\\' THEN 5
            WHEN s.normalized LIKE ? ESCAPE '\\' THEN 6
            WHEN lower(p.full_name) LIKE ? ESCAPE '\\' THEN 7
            ELSE 8
          END
        ) AS match_rank
      FROM proteins p
      LEFT JOIN protein_synonyms s ON s.protein_id = p.id
      LEFT JOIN structure_failures sf ON sf.uniprot = upper(p.uniprot)
      WHERE (lower(p.gene) LIKE ? OR lower(p.full_name) LIKE ? OR s.normalized LIKE ?)
        AND p.structure_source IS NOT NULL
        AND sf.uniprot IS NULL
        ${excludeClause}
      GROUP BY p.id
      ORDER BY match_rank ASC, lower(p.gene) ASC
      LIMIT ?`;
    const { results } = await db.prepare(statement)
      .bind(
        needle,
        needle,
        prefix,
        prefix,
        prefix,
        wildcard,
        wildcard,
        wildcard,
        wildcard,
        wildcard,
        wildcard,
        ...excludeBindings,
        limit
      )
      .all();
    return (results || []).map((row) => sanitizeProteinSummary(row));
  } catch (err) {
    console.warn('GeneGuessr: D1 searchProteins failed', err);
    return [];
  }
}

export async function getEligibleProteinIds(db) {
  const now = Date.now();
  if (eligibleCache.ids && (now - eligibleCache.fetchedAt) < eligibleCache.ttl) {
    return eligibleCache.ids.slice();
  }
  await ensureStructureFailureTable(db);
  const fetchIds = async (clause) => {
    const statement = `
      SELECT p.uniprot
      FROM proteins p
      LEFT JOIN structure_failures sf ON sf.uniprot = upper(p.uniprot)
      ${clause}
    `;
    const { results } = await db.prepare(statement).all();
    return (results || []).map((row) => row.uniprot);
  };
  let ids = [];
  try {
    ids = await fetchIds(
      `WHERE p.structure_source IS NOT NULL
         AND p.gene_summary IS NOT NULL
         AND sf.uniprot IS NULL`
    );
  } catch (err) {
    console.warn('GeneGuessr: D1 getEligibleProteinIds failed', err);
    ids = [];
  }
  eligibleCache.ids = ids;
  eligibleCache.fetchedAt = now;
  return ids.slice();
}

export async function pickDailyTarget(db, eligibleIds, salt, date = new Date()) {
  const ids = Array.isArray(eligibleIds) && eligibleIds.length
    ? eligibleIds
    : await getEligibleProteinIds(db);
  if (!ids.length) {
    return null;
  }
  const today = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const encoder = new TextEncoder();
  const hashInput = encoder.encode(`${today}|${salt || ''}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', hashInput);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashInt = parseInt(hash.slice(0, 16), 16);
  const idx = hashInt % ids.length;
  let skippedAlphaFold = 0;
  let chosenId = ids[idx];
  let protein = await fetchProteinByUniprot(db, chosenId);
  if (protein && isAlphaFoldOnlyProtein(protein)) {
    for (let offset = 1; offset < ids.length; offset++) {
      const candidateId = ids[(idx + offset) % ids.length];
      const candidate = await fetchProteinByUniprot(db, candidateId);
      if (candidate && !isAlphaFoldOnlyProtein(candidate)) {
        skippedAlphaFold = offset;
        chosenId = candidateId;
        protein = candidate;
        break;
      }
    }
  }
  return {
    protein,
    skippedAlphaFold,
    date: today
  };
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || !vecA.length) {
    return null;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA <= 0 || magB <= 0) {
    return null;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function normalizeCosine(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = (value + 1) / 2;
  if (normalized <= 0) {
    return 0;
  }
  if (normalized >= 1) {
    return 1;
  }
  return normalized;
}

export async function getGoSimilarityFromEmbeddings(db, guessId, targetId) {
  const guessKey = normalizeKey(guessId);
  const targetKey = normalizeKey(targetId);
  if (!guessKey || !targetKey) {
    return null;
  }
  const [guessVec, targetVec] = await Promise.all([
    fetchProteinEmbedding(db, guessKey),
    fetchProteinEmbedding(db, targetKey)
  ]);
  if (!guessVec || !targetVec) {
    return null;
  }
  const cosine = cosineSimilarity(guessVec, targetVec);
  return normalizeCosine(cosine);
}
