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
  embeddingCache.set(key, vector || null);
  if (embeddingCache.size > MAX_EMBEDDING_CACHE_SIZE) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

function cloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
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
  const buffer = cloneArrayBuffer(row.vector);
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
  let metadata = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = {};
    }
  }
  return {
    ...metadata,
    id: row.id,
    uniprot: row.uniprot,
    hgnc: row.hgnc || metadata.hgnc,
    full_name: row.full_name || metadata.full_name,
    length: row.length || metadata.length,
    has_structure: Boolean(row.has_structure),
    structure_source: row.structure_source || metadata.structure?.primary_source || null
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
  const row = await db.prepare(
    `SELECT id, uniprot, hgnc, full_name, length, has_structure, structure_source, metadata
     FROM proteins
     WHERE upper(uniprot) = ?
     LIMIT 1`
  ).bind(key).first();
  const protein = toProteinObject(row);
  if (protein) {
    rememberProtein(key, protein);
  }
  return protein;
}

export async function fetchProteinSummaries(db, limit = 100) {
  const { results } = await db.prepare(
    `SELECT uniprot, hgnc, full_name, length
     FROM proteins
     ORDER BY hgnc
     LIMIT ?`
  ).bind(limit).all();
  return (results || []).map((row) => sanitizeProteinSummary(row));
}

export async function fetchProteinEmbedding(db, uniprot) {
  const key = normalizeKey(uniprot);
  if (!key) {
    return null;
  }
  if (embeddingCache.has(key)) {
    return embeddingCache.get(key);
  }
  const row = await db.prepare(
    `SELECT e.vector, e.dim
     FROM proteins p
     JOIN protein_embeddings e ON e.protein_id = p.id
     WHERE upper(p.uniprot) = ?
     LIMIT 1`
  ).bind(key).first();
  const vector = toFloat32Vector(row);
  rememberEmbedding(key, vector);
  return vector;
}

export async function searchProteins(db, query, limit = 20) {
  if (!query || !query.trim()) {
    return [];
  }
  const normalized = `%${query.trim().toLowerCase()}%`;
  const statement = `
    SELECT p.uniprot, p.hgnc, p.full_name, p.length
    FROM proteins p
    LEFT JOIN protein_synonyms s ON s.protein_id = p.id
    WHERE lower(p.hgnc) LIKE ? OR lower(p.full_name) LIKE ? OR s.normalized LIKE ?
    GROUP BY p.id
    ORDER BY p.hgnc
    LIMIT ?`;
  const { results } = await db.prepare(statement)
    .bind(normalized, normalized, normalized, limit)
    .all();
  return (results || []).map((row) => sanitizeProteinSummary(row));
}

export async function getEligibleProteinIds(db) {
  const now = Date.now();
  if (eligibleCache.ids && (now - eligibleCache.fetchedAt) < eligibleCache.ttl) {
    return eligibleCache.ids.slice();
  }
  const { results } = await db.prepare(
    `SELECT uniprot FROM proteins WHERE has_structure = 1`
  ).all();
  const ids = (results || []).map((row) => row.uniprot);
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
