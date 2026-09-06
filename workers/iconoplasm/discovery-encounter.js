import { WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE } from "../../quartz/static/iconoplasm/guest-discovery-contract.js"

// Executed only by the existing internal state owner. D1 batch is the transaction
// boundary: a failed shared update cannot leave an accepted personal-only save.
export async function recordDiscoveryEncounterAtomically(
  db,
  { userId, geneSymbol, source, trigger, dwellMs, isAdmin = false, seedOnly = false },
) {
  const personal = db
    .prepare(
      `INSERT INTO icono_gene_discoveries (
    user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger,
    first_dwell_ms, last_dwell_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, gene_symbol) DO UPDATE SET
    last_encountered_at = CURRENT_TIMESTAMP,
    encounter_count = icono_gene_discoveries.encounter_count + 1,
    last_source = excluded.last_source,
    last_trigger = excluded.last_trigger,
    last_dwell_ms = excluded.last_dwell_ms
  WHERE ? = 0
  RETURNING *`,
    )
    .bind(userId, geneSymbol, source, source, trigger, trigger, dwellMs, dwellMs, seedOnly ? 1 : 0)
  const statements = [personal]
  if (!isAdmin)
    statements.push(
      db
        .prepare(
          `INSERT INTO icono_shared_gene_discoveries (
    gene_symbol, first_non_admin_discovered_at, latest_non_admin_encountered_at,
    non_admin_discoverer_count, non_admin_encounter_count, updated_at
  ) SELECT gene_symbol, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, CURRENT_TIMESTAMP
    FROM icono_gene_discoveries
    WHERE user_id = ? AND gene_symbol = ? AND changes() = 1
  ON CONFLICT(gene_symbol) DO UPDATE SET
    latest_non_admin_encountered_at = CURRENT_TIMESTAMP,
    non_admin_discoverer_count = icono_shared_gene_discoveries.non_admin_discoverer_count + (
      SELECT CASE WHEN encounter_count = 1 THEN 1 ELSE 0 END
      FROM icono_gene_discoveries WHERE user_id = ? AND gene_symbol = ?
    ),
    non_admin_encounter_count = icono_shared_gene_discoveries.non_admin_encounter_count + 1,
    updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(userId, geneSymbol, userId, geneSymbol),
    )
  const results = await db.batch(statements)
  const row = results[0]?.results?.[0] ?? null
  return { created: row?.encounter_count === 1, row }
}

// Guest storage contains membership symbols, not individually identified events.
// Merge that set once: replaying a lost response must not increment encounters.
// Two statements handle the entire batch and commit together, including rollups.
export async function mergeDiscoverySymbolsAtomically(db, { userId, symbols, isAdmin = false }) {
  if (
    !Array.isArray(symbols) ||
    symbols.length > WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE ||
    new Set(symbols).size !== symbols.length
  )
    throw new Error("Invalid discovery merge batch")
  if (!symbols.length) return
  const encoded = JSON.stringify(symbols)
  const statements = []
  if (!isAdmin)
    statements.push(
      db
        .prepare(
          `INSERT INTO icono_shared_gene_discoveries (
    gene_symbol, first_non_admin_discovered_at, latest_non_admin_encountered_at,
    non_admin_discoverer_count, non_admin_encounter_count, updated_at
  ) SELECT incoming.value, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, CURRENT_TIMESTAMP
    FROM json_each(?) AS incoming
    WHERE NOT EXISTS (
      SELECT 1 FROM icono_gene_discoveries WHERE user_id = ? AND gene_symbol = incoming.value
    )
  ON CONFLICT(gene_symbol) DO UPDATE SET
    latest_non_admin_encountered_at = CURRENT_TIMESTAMP,
    non_admin_discoverer_count = icono_shared_gene_discoveries.non_admin_discoverer_count + 1,
    non_admin_encounter_count = icono_shared_gene_discoveries.non_admin_encounter_count + 1,
    updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(encoded, userId),
    )
  statements.push(
    db
      .prepare(
        `INSERT INTO icono_gene_discoveries (
    user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger
  ) SELECT ?, value, 'extension_guest_merge', 'extension_guest_merge', 'guest_buffer_merge', 'guest_buffer_merge'
    FROM json_each(?) WHERE 1
  ON CONFLICT(user_id, gene_symbol) DO NOTHING`,
      )
      .bind(userId, encoded),
  )
  await db.batch(statements)
}
