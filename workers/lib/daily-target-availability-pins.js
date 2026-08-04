export const DAILY_TARGET_AVAILABILITY_PIN_VERSION = 1
const DAILY_TARGET_AVAILABILITY_PIN_TABLE = "daily_target_availability_pins"

function normalizeUniprotId(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  return normalized || null
}

function normalizeGeneSurname(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  return normalized || null
}

export function getDailyTargetFamilyKey(protein) {
  const uniprot = normalizeUniprotId(protein?.uniprot)
  return normalizeGeneSurname(protein?.gene_surname) || `__UNFAMILIED__:${uniprot || "UNKNOWN"}`
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function collectDailyTargetHorizonExclusions(entries, { firstDate, dayCount = 365 } = {}) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(firstDate || "")) ||
    !Number.isInteger(dayCount) ||
    dayCount < 1 ||
    !Array.isArray(entries) ||
    entries.length !== dayCount
  ) {
    return null
  }

  const forbiddenUniprotIds = new Set()
  const forbiddenGeneSurnames = new Set()
  for (let index = 0; index < dayCount; index += 1) {
    const entry = entries[index]
    if (entry?.date !== addDaysIso(firstDate, index)) {
      return null
    }
    const selectedUniprot = normalizeUniprotId(entry?.uniprot)
    if (!selectedUniprot) {
      return null
    }
    forbiddenUniprotIds.add(selectedUniprot)
    forbiddenGeneSurnames.add(
      normalizeGeneSurname(entry?.geneSurname) || `__UNFAMILIED__:${selectedUniprot}`,
    )

    const canonicalUniprot = normalizeUniprotId(entry?.canonicalUniprot)
    if (canonicalUniprot) {
      forbiddenUniprotIds.add(canonicalUniprot)
      forbiddenGeneSurnames.add(
        normalizeGeneSurname(entry?.canonicalGeneSurname) || `__UNFAMILIED__:${canonicalUniprot}`,
      )
    }
  }

  return {
    forbiddenUniprotIds: Array.from(forbiddenUniprotIds),
    forbiddenGeneSurnames: Array.from(forbiddenGeneSurnames),
  }
}

export async function selectDailyTargetAvailabilityReplacement({
  candidateIds,
  forbiddenUniprotIds = [],
  forbiddenGeneSurnames = [],
  rejectedUniprotIds = [],
  loadProtein,
}) {
  if (!Array.isArray(candidateIds) || typeof loadProtein !== "function") {
    return { protein: null, rejectedUniprotIds: [] }
  }
  const forbiddenIds = new Set(forbiddenUniprotIds.map(normalizeUniprotId).filter(Boolean))
  const forbiddenSurnames = new Set(forbiddenGeneSurnames.map(normalizeGeneSurname).filter(Boolean))
  const rejected = new Set(rejectedUniprotIds.map(normalizeUniprotId).filter(Boolean))

  for (const value of candidateIds) {
    const candidateId = normalizeUniprotId(value)
    if (!candidateId || forbiddenIds.has(candidateId) || rejected.has(candidateId)) {
      continue
    }
    const candidate = await loadProtein(candidateId)
    if (
      !candidate ||
      String(candidate.structure_source || "")
        .trim()
        .toLowerCase() === "alphafold"
    ) {
      rejected.add(candidateId)
      continue
    }
    if (forbiddenSurnames.has(getDailyTargetFamilyKey(candidate))) {
      continue
    }
    return { protein: candidate, rejectedUniprotIds: Array.from(rejected) }
  }
  return { protein: null, rejectedUniprotIds: Array.from(rejected) }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value
  }
  try {
    const parsed = JSON.parse(String(value || "[]"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function availabilityPinRecordFromRow(row) {
  if (!row) {
    return null
  }
  return {
    version: Number(row.version),
    date: row.date,
    salt: row.salt,
    selection_pool_fingerprint: row.selection_pool_fingerprint,
    original_uniprot_id: row.original_uniprot_id,
    uniprot_id: row.uniprot_id,
    rejected_uniprot_ids: parseJsonArray(row.rejected_uniprot_ids_json),
    forbidden_uniprot_ids: parseJsonArray(row.forbidden_uniprot_ids_json),
    forbidden_gene_surnames: parseJsonArray(row.forbidden_gene_surnames_json),
    recorded_at: Number(row.recorded_at),
  }
}

export function parseDailyTargetAvailabilityPin(
  value,
  { date, salt, selectionPoolFingerprint } = {},
) {
  let record = value
  if (typeof value === "string") {
    try {
      record = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!record || typeof record !== "object") {
    return null
  }

  const uniprotId = normalizeUniprotId(record.uniprot_id)
  const originalUniprotId = normalizeUniprotId(record.original_uniprot_id)
  if (
    record.version !== DAILY_TARGET_AVAILABILITY_PIN_VERSION ||
    record.date !== date ||
    record.salt !== salt ||
    !selectionPoolFingerprint ||
    record.selection_pool_fingerprint !== selectionPoolFingerprint ||
    !uniprotId ||
    !originalUniprotId
  ) {
    return null
  }

  return {
    ...record,
    uniprot_id: uniprotId,
    original_uniprot_id: originalUniprotId,
    rejected_uniprot_ids: Array.from(
      new Set((record.rejected_uniprot_ids || []).map(normalizeUniprotId).filter(Boolean)),
    ),
    forbidden_uniprot_ids: Array.from(
      new Set((record.forbidden_uniprot_ids || []).map(normalizeUniprotId).filter(Boolean)),
    ),
    forbidden_gene_surnames: Array.from(
      new Set((record.forbidden_gene_surnames || []).map(normalizeGeneSurname).filter(Boolean)),
    ),
  }
}

export async function readDailyTargetAvailabilityPin(db, { date, salt, selectionPoolFingerprint }) {
  if (!db?.prepare) {
    return null
  }
  const row = await db
    .prepare(`SELECT * FROM ${DAILY_TARGET_AVAILABILITY_PIN_TABLE} WHERE date = ? LIMIT 1`)
    .bind(date)
    .first()
  return parseDailyTargetAvailabilityPin(availabilityPinRecordFromRow(row), {
    date,
    salt,
    selectionPoolFingerprint,
  })
}

export async function listDailyTargetAvailabilityPins(
  db,
  { firstDate, lastDate, salt, selectionPoolFingerprint },
) {
  if (!db?.prepare || !firstDate || !lastDate) {
    return []
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM ${DAILY_TARGET_AVAILABILITY_PIN_TABLE}
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC`,
    )
    .bind(firstDate, lastDate)
    .all()
  return (results || [])
    .map((row) =>
      parseDailyTargetAvailabilityPin(availabilityPinRecordFromRow(row), {
        date: row.date,
        salt,
        selectionPoolFingerprint,
      }),
    )
    .filter(Boolean)
}

export async function writeDailyTargetAvailabilityPin(
  db,
  {
    date,
    salt,
    selectionPoolFingerprint,
    originalUniprotId,
    replacementUniprotId,
    rejectedUniprotIds = [],
    forbiddenUniprotIds = [],
    forbiddenGeneSurnames = [],
  },
) {
  if (!db?.prepare) {
    throw new Error("Daily target availability pin storage is unavailable")
  }
  const uniprotId = normalizeUniprotId(replacementUniprotId)
  const original = normalizeUniprotId(originalUniprotId)
  if (!date || !salt || !selectionPoolFingerprint || !uniprotId || !original) {
    throw new Error("Daily target availability pin is incomplete")
  }

  const record = {
    version: DAILY_TARGET_AVAILABILITY_PIN_VERSION,
    date,
    salt,
    selection_pool_fingerprint: selectionPoolFingerprint,
    original_uniprot_id: original,
    uniprot_id: uniprotId,
    rejected_uniprot_ids: Array.from(
      new Set(rejectedUniprotIds.map(normalizeUniprotId).filter(Boolean)),
    ),
    forbidden_uniprot_ids: Array.from(
      new Set(forbiddenUniprotIds.map(normalizeUniprotId).filter(Boolean)),
    ),
    forbidden_gene_surnames: Array.from(
      new Set(forbiddenGeneSurnames.map(normalizeGeneSurname).filter(Boolean)),
    ),
    recorded_at: Date.now(),
  }
  await db
    .prepare(
      `INSERT INTO ${DAILY_TARGET_AVAILABILITY_PIN_TABLE} (
         date,
         version,
         salt,
         selection_pool_fingerprint,
         original_uniprot_id,
         uniprot_id,
         rejected_uniprot_ids_json,
         forbidden_uniprot_ids_json,
         forbidden_gene_surnames_json,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         version = excluded.version,
         salt = excluded.salt,
         selection_pool_fingerprint = excluded.selection_pool_fingerprint,
         original_uniprot_id = excluded.original_uniprot_id,
         uniprot_id = excluded.uniprot_id,
         rejected_uniprot_ids_json = excluded.rejected_uniprot_ids_json,
         forbidden_uniprot_ids_json = excluded.forbidden_uniprot_ids_json,
         forbidden_gene_surnames_json = excluded.forbidden_gene_surnames_json,
         recorded_at = excluded.recorded_at`,
    )
    .bind(
      record.date,
      record.version,
      record.salt,
      record.selection_pool_fingerprint,
      record.original_uniprot_id,
      record.uniprot_id,
      JSON.stringify(record.rejected_uniprot_ids),
      JSON.stringify(record.forbidden_uniprot_ids),
      JSON.stringify(record.forbidden_gene_surnames),
      record.recorded_at,
    )
    .run()
  return record
}
