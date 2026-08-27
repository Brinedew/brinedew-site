import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")

// Cost experiment, not a shipped-state claim. Real workerd counts index writes;
// JS mocks cannot prove a schema fits the Free account's row allowances.
test(
  "measure discovery amplification and per-person collection alternatives in real SQLite",
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
      const root = new URL("../migrations-iconoplasm/", import.meta.url)
      for (const prefix of ["0023", "0031", "0041"]) {
        const file = readdirSync(root).find((name) => name.startsWith(prefix + "_"))
        const sql = readFileSync(new URL(file, root), "utf8")
        for (const statement of sql
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean))
          await db.prepare(statement).run()
      }
      const write = async (sql, ...args) =>
        (
          await db
            .prepare(sql)
            .bind(...args)
            .run()
        ).meta
      const personal = await write(
        "INSERT INTO icono_gene_discoveries(user_id,gene_symbol,first_source,last_source,first_trigger,last_trigger,first_dwell_ms,last_dwell_ms) VALUES (?,?,?,?,?,?,?,?)",
        "reader",
        "EZH2",
        "extension_hover",
        "extension_hover",
        "hover_dwell",
        "hover_dwell",
        900,
        900,
      )
      const firstShared = await write(
        "INSERT INTO icono_shared_gene_discoveries VALUES (?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1,1,CURRENT_TIMESTAMP)",
        "EZH2",
      )
      const existingShared = await write(
        "UPDATE icono_shared_gene_discoveries SET non_admin_discoverer_count=non_admin_discoverer_count+1,non_admin_encounter_count=non_admin_encounter_count+1,latest_non_admin_encountered_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
        "EZH2",
      )
      await db
        .prepare(
          "CREATE TABLE collection(symbol TEXT PRIMARY KEY, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, encounters INTEGER NOT NULL, provenance TEXT NOT NULL) WITHOUT ROWID",
        )
        .run()
      await db.prepare("CREATE INDEX collection_newest ON collection(last_at DESC,symbol)").run()
      await db
        .prepare(
          "CREATE TABLE collection_metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID",
        )
        .run()
      const collection = await write(
        "INSERT INTO collection VALUES (?,?,?,?,?)",
        "EZH2",
        1787834000,
        1787834000,
        1,
        JSON.stringify([
          "extension_hover",
          "extension_hover",
          "hover_dwell",
          "hover_dwell",
          900,
          900,
        ]),
      )
      const membership = await write(
        "INSERT INTO collection_metadata VALUES ('membership',?)",
        JSON.stringify({ symbols: ["EZH2"], pending: ["EZH2"] }),
      )
      const membershipRead = (
        await db.prepare("SELECT value FROM collection_metadata WHERE name='membership'").all()
      ).meta
      const newest = await db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM collection ORDER BY last_at DESC,symbol LIMIT 48",
        )
        .all()
      assert.equal(personal.rows_written, 5)
      assert.equal(existingShared.rows_written, 1)
      assert.equal(firstShared.rows_written, 3)
      assert.equal(collection.rows_written, 2)
      assert.equal(membership.rows_written, 1)
      assert.equal(membershipRead.rows_read, 1)
      assert.ok(newest.results.some((x) => /collection_newest/.test(x.detail)))
      t.diagnostic(
        JSON.stringify({
          currentNewPersonal: personal.rows_written,
          currentExistingShared: existingShared.rows_written,
          currentNewShared: firstShared.rows_written,
          proposedPersonal: collection.rows_written,
          proposedMembershipAndOutbox: membership.rows_written,
          proposedMembershipRead: membershipRead.rows_read,
          excludes: "auth, alarms, shared-projection receipts, retries, migration, storage growth",
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
