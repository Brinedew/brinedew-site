export const DAILY_TARGET_AVAILABILITY_PIN_PREFIX = "puzzle_availability_pin:"
export const DAILY_TARGET_AVAILABILITY_PIN_VERSION = 1

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

export function buildDailyTargetAvailabilityPinKey(date) {
  return `${DAILY_TARGET_AVAILABILITY_PIN_PREFIX}${date}`
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

export async function readDailyTargetAvailabilityPin(kv, { date, salt, selectionPoolFingerprint }) {
  if (!kv?.get) {
    return null
  }
  const raw = await kv.get(buildDailyTargetAvailabilityPinKey(date))
  return parseDailyTargetAvailabilityPin(raw, { date, salt, selectionPoolFingerprint })
}

export async function writeDailyTargetAvailabilityPin(
  kv,
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
  if (!kv?.put) {
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
  await kv.put(buildDailyTargetAvailabilityPinKey(date), JSON.stringify(record), {
    metadata: {
      version: record.version,
      date: record.date,
      uniprot_id: record.uniprot_id,
      original_uniprot_id: record.original_uniprot_id,
      selection_pool_fingerprint: record.selection_pool_fingerprint,
      recorded_at: record.recorded_at,
    },
  })
  return record
}
