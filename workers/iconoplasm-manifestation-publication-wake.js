export class IconoplasmManifestationPublicationWakeError extends Error {
  constructor(code, message, status = 503) {
    super(message)
    this.name = "IconoplasmManifestationPublicationWakeError"
    this.code = code
    this.status = status
  }
}

function boundedLimit(raw) {
  const value = Number(raw)
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(50, value)) : 10
}

async function pendingWakes(primaryDb, eventId, limit) {
  const where = eventId ? "AND authority_event_id = ?" : ""
  const bindings = eventId ? [eventId, limit] : [limit]
  const result = await primaryDb
    .prepare(
      `SELECT authority_event_id, authority_event_sequence, gene_id, canonical_symbol
         FROM icono_manifestation_publication_wakes
        WHERE status = 'pending' ${where}
        ORDER BY authority_event_sequence ASC LIMIT ?`,
    )
    .bind(...bindings)
    .all()
  return Array.isArray(result?.results) ? result.results : []
}

export async function drainManifestationPublicCardPublicationWakes(
  primaryDb,
  { authorityEventId = null, limit = 10, wakeCardPublication = null } = {},
) {
  if (!primaryDb?.prepare || !primaryDb?.batch) {
    throw new IconoplasmManifestationPublicationWakeError(
      "MANIFESTATION_PUBLICATION_DB_REQUIRED",
      "ICONOPLASM_DB binding is required",
    )
  }
  const eventId = String(authorityEventId || "").trim() || null
  const rows = await pendingWakes(primaryDb, eventId, boundedLimit(limit))
  const published = []
  for (const row of rows) {
    const insert = primaryDb
      .prepare(
        `INSERT INTO icono_publish_events (
           gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
         )
         SELECT canonical_symbol, NULL, NULL, 'manifestation_canonical_changed',
                'manifestation_authority', authority_event_id, CURRENT_TIMESTAMP
           FROM icono_manifestation_publication_wakes
          WHERE authority_event_id = ? AND status = 'pending'`,
      )
      .bind(row.authority_event_id)
    const mark = primaryDb
      .prepare(
        `UPDATE icono_manifestation_publication_wakes
            SET status = 'published', attempts = attempts + 1,
                published_at = CURRENT_TIMESTAMP
          WHERE authority_event_id = ? AND status = 'pending'`,
      )
      .bind(row.authority_event_id)
    await primaryDb.batch([insert, mark])
    const current = await primaryDb
      .prepare(
        `SELECT status FROM icono_manifestation_publication_wakes
          WHERE authority_event_id = ?`,
      )
      .bind(row.authority_event_id)
      .first()
    if (current?.status !== "published") {
      throw new IconoplasmManifestationPublicationWakeError(
        "MANIFESTATION_PUBLICATION_WAKE_NOT_COMMITTED",
        "Canonical manifestation publication wake was not committed",
      )
    }
    published.push({
      authority_event_id: row.authority_event_id,
      authority_event_sequence: Number(row.authority_event_sequence),
      gene_id: row.gene_id,
      canonical_symbol: row.canonical_symbol,
    })
  }
  if (eventId) {
    const target = await primaryDb
      .prepare(
        `SELECT status FROM icono_manifestation_publication_wakes
          WHERE authority_event_id = ?`,
      )
      .bind(eventId)
      .first()
    if (!target) {
      throw new IconoplasmManifestationPublicationWakeError(
        "MANIFESTATION_PUBLICATION_WAKE_NOT_FOUND",
        "Canonical manifestation publication wake was not found",
        404,
      )
    }
    if (target.status !== "published") {
      throw new IconoplasmManifestationPublicationWakeError(
        "MANIFESTATION_PUBLICATION_WAKE_PENDING",
        "Canonical manifestation publication wake remains pending",
      )
    }
  }
  if ((eventId || published.length) && typeof wakeCardPublication === "function") {
    await wakeCardPublication({
      authority_event_id: eventId,
      published: Object.freeze([...published]),
    })
  }
  return Object.freeze({
    ok: true,
    published_count: published.length,
    published: Object.freeze(published),
    has_more: rows.length === boundedLimit(limit),
  })
}
