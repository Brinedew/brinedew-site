import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

import { listFavoriteGenerationRequestVisionRows } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "real favorite SQL reads the requested family, not a growing option corpus",
  { timeout: 30000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      await db
        .prepare(
          `CREATE TABLE icono_generation_request_vision_option_rollup (
      vision_id TEXT PRIMARY KEY, emulsion_id TEXT, emulsion_family_id TEXT,
      artist_tag TEXT, artist_name TEXT, workflow_id TEXT, workflow_label TEXT,
      prompt_version TEXT, variant_slot TEXT, image_count INTEGER, live_count INTEGER,
      score INTEGER, vote_h_index INTEGER, preview_assets_json TEXT, builder_version INTEGER
    )`,
        )
        .run()
      await db
        .prepare(
          `CREATE INDEX idx_icono_generation_request_options_family
      ON icono_generation_request_vision_option_rollup (
        builder_version, emulsion_family_id, vote_h_index DESC, live_count DESC,
        score DESC, image_count DESC, vision_id ASC
      )`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE sample(i) AS (
      VALUES(1) UNION ALL SELECT i + 1 FROM sample WHERE i < 9
    ) INSERT INTO icono_generation_request_vision_option_rollup
      SELECT 'favorite-' || i, '0-50000', '0-50000', 'anima', '', '', '', '', '',
             1, 0, 0, 0, '[]', 3 FROM sample`,
        )
        .run()

      const sample = async (favoriteId) => {
        let sql
        let rowsRead
        const rows = await listFavoriteGenerationRequestVisionRows(
          {
            ICONOPLASM_DB: {
              prepare(statement) {
                sql = statement
                return {
                  bind(...args) {
                    return {
                      async all() {
                        const response = await db
                          .prepare(statement)
                          .bind(...args)
                          .all()
                        rowsRead = response.meta.rows_read
                        return response
                      },
                    }
                  },
                }
              },
            },
          },
          [favoriteId],
        )
        return { rows, rowsRead, sql }
      }

      const addUnrelated = async (start, end) =>
        db
          .prepare(
            `WITH RECURSIVE sample(i) AS (
        VALUES(${start}) UNION ALL SELECT i + 1 FROM sample WHERE i < ${end}
      ) INSERT INTO icono_generation_request_vision_option_rollup
        SELECT 'unrelated-' || i, '0-' || i, '0-' || i, 'anima', '', '', '', '', '',
               1, 0, 0, 0, '[]', 3 FROM sample`,
          )
          .run()

      await addUnrelated(1, 1000)
      const before = await sample("0-50000")
      await addUnrelated(1001, 10000)
      const after = await sample("0-50000")
      const absent = await sample("0-999999")

      assert.equal(before.rows.length, 9)
      assert.deepEqual(after.rows, before.rows)
      assert.deepEqual(absent.rows, [])
      assert.ok(after.rowsRead <= before.rowsRead + 10, `${before.rowsRead} -> ${after.rowsRead}`)
      assert.ok(absent.rowsRead <= 10, `absent favorite read ${absent.rowsRead} rows`)
      const plan = (
        await db
          .prepare(`EXPLAIN QUERY PLAN ${after.sql}`)
          .bind(JSON.stringify(["0-50000"]))
          .all()
      ).results
      const seek = plan.find((row) =>
        /SEARCH rollup .*builder_version=\?.*emulsion_family_id=\?/.test(row.detail),
      )
      assert.ok(seek, JSON.stringify(plan))
      t.diagnostic(
        JSON.stringify({
          requestedRows: 9,
          unrelatedBefore: 1000,
          unrelatedAfter: 10000,
          beforeReads: before.rowsRead,
          afterReads: after.rowsRead,
          absentReads: absent.rowsRead,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
