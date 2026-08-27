import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

// Local workerd evidence, not a production load test. Use the same Miniflare
// runtime already pinned by Wrangler; do not install a second simulator or infer
// billed index work from SQLite's changes() (which counts only table rows).
const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
// Miniflare 5 ships this public converter for the legacy options documented in
// its bundled README. Keep the probe on Wrangler's pinned runtime, not a shim.
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "discovery-cost-probe",
        modules: true,
        script: "export default { fetch() { return new Response('local cost probe') } }",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      },
    ],
  }),
)

try {
  const db = await runtime.getD1Database("DB")
  for (const filename of [
    "0023_add_gene_discoveries.sql",
    "0031_account_gallery_window_indexes.sql",
    "0041_shared_gene_discovery_rollup.sql",
  ]) {
    const source = readFileSync(
      new URL(`../migrations-iconoplasm/${filename}`, import.meta.url),
      "utf8",
    )
    for (const sql of source.split(";").filter((value) => value.trim())) {
      await db.prepare(sql).run()
    }
  }

  const results = []
  async function measure(label, sql, ...bindings) {
    const { meta } = await db
      .prepare(sql)
      .bind(...bindings)
      .run()
    results.push({
      label,
      rowsRead: meta.rows_read,
      rowsWritten: meta.rows_written,
      changes: meta.changes,
    })
  }
  const insertPersonal = `INSERT INTO icono_gene_discoveries
    (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger,
     first_dwell_ms, last_dwell_ms) VALUES (?, ?, 'extension_hover', 'extension_hover',
     'hover_dwell', 'hover_dwell', 900, 900)`
  const updatePersonal = `UPDATE icono_gene_discoveries
    SET last_encountered_at = '2026-08-27 12:00:00', encounter_count = encounter_count + 1,
        last_source = 'extension_hover', last_trigger = 'hover_dwell', last_dwell_ms = 1000
    WHERE user_id = ? AND gene_symbol = ?`
  const upsertShared = `INSERT INTO icono_shared_gene_discoveries
    (gene_symbol, first_non_admin_discovered_at, latest_non_admin_encountered_at,
     non_admin_discoverer_count, non_admin_encounter_count, updated_at)
    VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(gene_symbol) DO UPDATE SET
      latest_non_admin_encountered_at = CURRENT_TIMESTAMP,
      non_admin_discoverer_count = icono_shared_gene_discoveries.non_admin_discoverer_count + ?,
      non_admin_encounter_count = icono_shared_gene_discoveries.non_admin_encounter_count + 1,
      updated_at = CURRENT_TIMESTAMP`
  await measure("current: first personal discovery", insertPersonal, "reader-one", "EZH2")
  await measure("current: first shared gene", upsertShared, "EZH2", 1)
  await measure("current: another personal discovery", insertPersonal, "reader-two", "EZH2")
  await measure("current: existing shared gene", upsertShared, "EZH2", 1)
  await measure("current: repeat encounter", updatePersonal, "reader-one", "EZH2")
  await measure("current: shared repeat", upsertShared, "EZH2", 0)

  // Counterfactual only. Index removal is NOT authorized by these numbers:
  // every real query still needs an EXPLAIN/behavioral proof before migration.
  await db.prepare("DROP INDEX idx_icono_gene_discoveries_last_encountered").run()
  await db.prepare("DROP INDEX idx_icono_gene_discoveries_gene_symbol").run()
  await measure(
    "counterfactual: two indexes removed, new personal",
    insertPersonal,
    "reader-three",
    "EZH2",
  )
  await measure(
    "counterfactual: two indexes removed, repeat",
    updatePersonal,
    "reader-three",
    "EZH2",
  )
  console.log(
    JSON.stringify({ runtime: "local workerd D1", productionModified: false, results }, null, 2),
  )
} finally {
  await runtime.dispose()
}
