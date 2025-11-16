import { sanitizeProteinSummary, isAlphaFoldOnlyProtein } from './game-engine.js';

const MAX_CACHE_SIZE = 512;
const proteinCache = new Map();
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
