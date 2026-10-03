import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

import {
  ERASED_NAME,
  ERASED_USER,
  OTHER_NAME,
  OTHER_USER,
  seedSessionsAndKv,
  seedWorld,
} from "./test-helpers/account-erasure-fixture.js"
import {
  ERASURE_DEFAULT_ROW_WRITES,
  eraseBrinedewAccountOnRequest,
} from "./iconoplasm/account-erasure/erase-account-data.js"
import { ERASURE_STEPS } from "./iconoplasm/account-erasure/erasure-steps.js"
import { iconoplasmUserKvKeyScopes } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  brinedewFormerAuthorLabel,
  brinedewProviderSubjectFingerprint,
} from "./lib/brinedew-account-identity.js"

// B-987, on the real thing. The other erasure test runs on SQLite with D1's surface; this one runs
// the same seeded world on Miniflare's D1 (workerd's SQLite), which is what counts rows written the
// way production bills them (every index entry a statement touches, every trigger write) and
// refuses what D1 refuses. It proves three things SQLite cannot:
// 1. the statements are valid D1: the row-value deletes, json_each lists, the batch that lifts and
//    restores the append-only triggers around the fingerprint rewrite;
// 2. the rows a request writes, as D1 reports them, stay under what the steps' weights promise
//    (the weights are what the runbook's worst-case cost and the per-request budget are built on);
// 3. the person is gone from every row afterwards and the other person's rows are not.

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

function parentsFirst(raw, names) {
  const parents = new Map(
    names.map((name) => [
      name,
      raw
        .prepare(`SELECT "table" AS parent FROM pragma_foreign_key_list('${name}')`)
        .all()
        .map((row) => row.parent)
        .filter((parent) => parent !== name && names.includes(parent)),
    ]),
  )
  const ordered = []
  while (ordered.length < names.length) {
    const next = names.find(
      (name) =>
        !ordered.includes(name) && parents.get(name).every((parent) => ordered.includes(parent)),
    )
    if (!next) throw new Error("foreign key cycle")
    ordered.push(next)
  }
  return ordered
}

// Tables and indexes, then the rows, then the triggers: the rows arrive as they are, without the
// derived rows the triggers would add a second time.
async function copyInto(target, source) {
  const raw = source.database
  const objects = raw
    .prepare(
      `SELECT type, name, sql FROM sqlite_schema
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`,
    )
    .all()
  const tables = objects.filter((object) => object.type === "table")
  const order = parentsFirst(
    raw,
    tables.map((table) => table.name),
  )
  for (const name of order) {
    await target.prepare(tables.find((table) => table.name === name).sql).run()
  }
  for (const index of objects.filter((object) => object.type === "index")) {
    await target.prepare(index.sql).run()
  }
  for (const name of order) {
    const columns = raw
      .prepare(`SELECT name FROM pragma_table_xinfo('${name}') WHERE hidden = 0`)
      .all()
      .map((column) => column.name)
    const rows = raw.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(", ")} FROM ${name}`).all()
    const insert = `INSERT INTO ${name} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`
    for (let offset = 0; offset < rows.length; offset += 20) {
      await target.batch(
        rows
          .slice(offset, offset + 20)
          .map((row) => target.prepare(insert).bind(...columns.map((column) => row[column]))),
      )
    }
  }
  for (const trigger of objects.filter((object) => object.type === "trigger")) {
    await target.prepare(trigger.sql).run()
  }
}

async function tracesIn(db, label, needles) {
  const hits = []
  const { results: tables } = await db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
  for (const { name } of tables) {
    const { results } = await db.prepare(`SELECT * FROM ${name}`).all()
    if (results.some((row) => needles.some((needle) => JSON.stringify(row).includes(needle)))) {
      hits.push(`${label}.${name}`)
    }
  }
  return hits
}

test(
  "the erasure runs on D1: valid statements, rows written under the declared weights, nothing left",
  { timeout: 240_000 },
  async (t) => {
    const world = await seedWorld()
    await seedSessionsAndKv(world, iconoplasmUserKvKeyScopes)
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB", "ICONOPLASM_DB", "ICONOPLASM_AUDIT_DB"],
      }),
    )
    try {
      const accounts = await runtime.getD1Database("DB")
      const iconoplasm = await runtime.getD1Database("ICONOPLASM_DB")
      const audit = await runtime.getD1Database("ICONOPLASM_AUDIT_DB")
      await copyInto(accounts, world.accounts)
      await copyInto(iconoplasm, world.iconoplasm)
      await copyInto(audit, world.audit)
      Object.assign(world.env, {
        DB: accounts,
        ICONOPLASM_DB: iconoplasm,
        ICONOPLASM_AUDIT_DB: audit,
      })

      const label = await brinedewFormerAuthorLabel(world.erasedAccount)
      const needles = [
        ERASED_USER,
        ERASED_NAME,
        ERASED_NAME.toUpperCase(),
        await brinedewProviderSubjectFingerprint("discord", ERASED_USER),
      ]
      const weights = new Map(ERASURE_STEPS.map((step) => [step.id, step.weight]))
      const before = {
        votes: (await iconoplasm.prepare("SELECT count(*) AS n FROM icono_image_votes").first()).n,
        otherStats: await accounts
          .prepare("SELECT * FROM stats WHERE user_id = ?")
          .bind(OTHER_USER)
          .first(),
      }

      const requests = []
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { account, erasure } = await eraseBrinedewAccountOnRequest(
          world.env,
          {
            accountId: world.erasedAccount,
            commandId: "req-d1",
            maxRowsWritten: ERASURE_DEFAULT_ROW_WRITES,
          },
          {
            geneCommentsCacheKey: (symbol) => `iconoplasm:gene-comments:${symbol}`,
            userKvKeyScopes: iconoplasmUserKvKeyScopes,
          },
        )
        requests.push(erasure)
        if (erasure.complete) {
          assert.equal(account.status, "erased")
          break
        }
      }
      assert.equal(requests.at(-1).complete, true)

      // D1's own count of rows written, per request, against what the weights allow.
      for (const request of requests) {
        const allowed = Object.entries(request.changed).reduce(
          (sum, [id, changed]) => sum + changed * (weights.get(id) ?? 0),
          0,
        )
        assert.ok(request.rows_written > 0, "D1 reported no rows written")
        assert.ok(
          request.rows_written <= allowed,
          `D1 wrote ${request.rows_written} rows; the weights allow ${allowed} for ${JSON.stringify(request.changed)}`,
        )
      }
      t.diagnostic(
        `D1 rows written per request ${requests.map((r) => r.rows_written).join("/")}; weights allow ${requests
          .map((r) =>
            Object.entries(r.changed).reduce((s, [id, n]) => s + n * (weights.get(id) ?? 0), 0),
          )
          .join(
            "/",
          )}; changed ${JSON.stringify(Object.assign({}, ...requests.map((r) => r.changed)))}`,
      )

      // Nothing about the person is left in any D1 table.
      const hits = [
        ...(await tracesIn(accounts, "accounts", needles)),
        ...(await tracesIn(iconoplasm, "iconoplasm", needles)),
        ...(await tracesIn(audit, "audit", needles)),
      ]
      assert.deepEqual(hits, [])

      // The two append-only guards are back and still refuse a rewrite.
      for (const name of [
        "trg_brinedew_identity_events_append_only_update",
        "trg_brinedew_account_events_append_only_update",
      ]) {
        const guard = await accounts
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .bind(name)
          .first()
        assert.equal(guard?.name, name)
      }
      await assert.rejects(
        accounts.prepare("UPDATE brinedew_account_identity_events SET occurred_at = 0").run(),
        /append-only/,
      )

      // The other person is whole: votes dissociated not deleted, their stats and comment intact.
      assert.equal(
        (await iconoplasm.prepare("SELECT count(*) AS n FROM icono_image_votes").first()).n,
        before.votes,
      )
      assert.deepEqual(
        await accounts.prepare("SELECT * FROM stats WHERE user_id = ?").bind(OTHER_USER).first(),
        before.otherStats,
      )
      assert.equal(
        (
          await iconoplasm
            .prepare(
              "SELECT count(*) AS n FROM icono_gene_comments WHERE user_id = ? AND username = ?",
            )
            .bind(OTHER_USER, OTHER_NAME)
            .first()
        ).n,
        1,
      )
      assert.equal(
        (
          await iconoplasm
            .prepare(
              "SELECT count(*) AS n FROM icono_gene_comments WHERE user_id = ? AND username = ?",
            )
            .bind(world.erasedAccount, label)
            .first()
        ).n,
        2,
      )
    } finally {
      await runtime.dispose()
    }
  },
)
