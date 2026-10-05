// B-859 step 1: a cost ratchet for one ordinary caretaker save.
//
// What this measures. A caretaker's editor autosaves prose with Tags in one
// POST .../saves (quartz/static/iconoplasm/caretaker-manifestations-controller.js,
// `autosave`): the revision, its Tags, the Tags head and the canonical selection
// as one command (B-859 step 3; it used to be four POSTs, 151 rows measured),
// then re-reads the dossier (GET). This test drives exactly that
// through the real caretaker HTTP handler, the real authority commands, and the
// real scheduled-projection drain that production wakes after every accepted
// event (`projectAcceptedManifestationAuthorityEvent` in the stateful runtime).
//
// Why workerd. D1 bills `meta.rows_written`, which counts index entries and
// trigger writes. node:sqlite's total_changes() does not, which is why the
// PR #474 measurement (about 70 authority rows, 20 projection rows) was far
// above what reading the SQL suggests. Here both databases are real workerd
// D1s (Miniflare) carrying the final schema of every real migration, and every
// statement's own `meta.rows_written` is recorded.
//
// Nothing is mocked except the two things a test must not spend: Bunny object
// storage (kept in memory, only for the private body host) and the card
// publication Durable Object (counted, answers ok). Production also runs
// `synchronizeActiveBrinedewAccountToManifestationAuthority` per request; it
// reads the account database and is a no-op once synced, so it is not part
// of this measurement.
//
// B-859 RATCHET. The two numbers below are the measured cost of one save today.
// The assertion fails when a save writes MORE rows. Lowering the cost is the
// whole point of B-859: when a change makes a save cheaper, lower these
// constants in the same change so the saving cannot quietly regress. Never raise
// them to make a new feature fit without writing down in B-859 why the extra
// rows are worth their share of the free plan's 100,000 rows/day.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { ownManifestation } from "../../../quartz/static/iconoplasm/caretaker-manifestations-model.js"
import { drainIconoplasmManifestationAuthorityProjection } from "../../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  createCaretakerManifestationHttpHandler,
  createManifestationUploadIntent,
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { command, sha, storage } from "./manifestation-authority-test-support.js"

// Rows written (`meta.rows_written`) by one ordinary autosave on a lineage that
// already exists, summed over the four POSTs and the projection they wake.
const MAX_SAVE_ROWS_AUTHORING = 117
const MAX_SAVE_ROWS_PRIMARY = 34
// The first save of a caretaker's lineage also inserts the lineage row.
const MAX_FIRST_SAVE_ROWS_AUTHORING = 122
const MAX_FIRST_SAVE_ROWS_PRIMARY = 34

const ADMIN = "account_admin_b859cost"
const USER = "account_user_b859cost1"
const TERMS = "terms_b859cost_0001"
const GENE = "gene_b859cost_0001"
const SYMBOL = "B859COST"
const ASSIGNMENT = "assignment_b859cost_0001"
const BASE = `/api/iconoplasm/caretaker/genes/${SYMBOL}`
const STORAGE_ZONE = "b859-cost-zone"

async function installFinalSchema(db, directory) {
  const schema = new DatabaseSync(":memory:")
  try {
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, directory), "utf8"))
    const definitions = schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
      )
      .all()
    for (let i = 0; i < definitions.length; i += 20)
      await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
    for (const { name } of schema
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()) {
      for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
        const columns = Object.keys(row)
        await db
          .prepare(
            `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .bind(...Object.values(row))
          .run()
      }
    }
  } finally {
    schema.close()
  }
}

// Wraps a D1 binding and records every statement's own receipt. A batch is one
// provider call but returns one receipt per statement, so each is recorded.
function recordingDb(db, databaseName, receipts, phase) {
  function wrap(native, sql) {
    const record = (result) => {
      receipts.push({
        phase: phase(),
        database: databaseName,
        sql,
        rows_written: Number(result?.meta?.rows_written || 0),
        rows_read: Number(result?.meta?.rows_read || 0),
        changes: Number(result?.meta?.changes || 0),
      })
      return result
    }
    return {
      native,
      sql,
      bind: (...args) => wrap(native.bind(...args), sql),
      async run() {
        return record(await native.run())
      },
      async all() {
        return record(await native.all())
      },
      async first(column) {
        const result = record(await native.all())
        const row = result.results[0] || null
        if (column === undefined || row === null) return row
        if (!Object.hasOwn(row, column)) throw new Error("D1_COLUMN_NOTFOUND")
        return row[column]
      },
    }
  }
  return Object.freeze({
    prepare: (sql) => wrap(db.prepare(sql), sql),
    async batch(statements) {
      const results = await db.batch(statements.map((statement) => statement.native))
      results.forEach((result, index) =>
        receipts.push({
          phase: phase(),
          database: databaseName,
          sql: statements[index].sql,
          rows_written: Number(result?.meta?.rows_written || 0),
          rows_read: Number(result?.meta?.rows_read || 0),
          changes: Number(result?.meta?.changes || 0),
          batched: true,
        }),
      )
      return results
    },
  })
}

function describeStatement(sql) {
  const text = sql.replace(/\s+/g, " ").trim()
  const insert = text.match(/^INSERT (?:OR \w+ )?INTO (\w+)/i)
  if (insert) return `INSERT ${insert[1]}`
  const update = text.match(/^UPDATE (\w+)/i)
  if (update) return `UPDATE ${update[1]}`
  const remove = text.match(/^DELETE FROM (\w+)/i)
  if (remove) return `DELETE ${remove[1]}`
  return `${text.slice(0, 7).toUpperCase()} ${text.slice(0, 60)}`
}

function installMemoryBodyStorage(t) {
  const originalFetch = globalThis.fetch
  const objects = new Map()
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  // Only Bunny's private body host is faked; anything else (Miniflare's own
  // loopback to workerd) goes through the real fetch.
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url?.url || url)
    if (!key.includes(`/${STORAGE_ZONE}/`)) return originalFetch(url, init)
    const method = String(init.method || "GET").toUpperCase()
    if (method === "PUT") {
      objects.set(key, Uint8Array.from(init.body))
      return new Response(null, { status: 201, headers: { etag: '"test-etag"' } })
    }
    if (method === "DELETE") {
      objects.delete(key)
      return new Response(null, { status: 200 })
    }
    const bytes = objects.get(key)
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"test-etag"' } })
      : new Response(null, { status: 404 })
  }
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

function request(path, { method = "GET", body } = {}) {
  return new Request(`https://iconoplasm.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://iconoplasm.test",
      "sec-fetch-site": "same-origin",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test(
  "one ordinary caretaker save writes no more D1 rows than B-859's measured ceiling",
  { timeout: 240000 },
  async (t) => {
    installMemoryBodyStorage(t)
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('save cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["PRIMARY", "AUTHORING"],
      }),
    )
    try {
      const primary = await runtime.getD1Database("PRIMARY")
      const authoring = await runtime.getD1Database("AUTHORING")
      await installFinalSchema(primary, new URL("../../../migrations-iconoplasm/", import.meta.url))
      await installFinalSchema(
        authoring,
        new URL("../../../migrations-iconoplasm-authoring/", import.meta.url),
      )
      await primary
        .prepare(
          "UPDATE icono_manifestation_projection_authority SET mode='authoritative',authority_epoch=2 WHERE singleton=1",
        )
        .run()
      await authoring
        .prepare(
          "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
        )
        .run()

      // Bootstrap (not measured): one gene, a system seed prose, one active caretaker.
      const now = new Date().toISOString()
      for (const accountId of [ADMIN, USER]) {
        await registerAuthorityAccount(authoring, {
          accountId,
          publicCreditLabel: "Save cost credit",
          now,
        })
      }
      await registerCaretakerTermsVersion(authoring, {
        termsVersionId: TERMS,
        termsSha256: sha("f"),
        documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
        displayLabel: "Caretaker terms",
        effectiveAt: now,
        createdByAccountId: ADMIN,
      })
      await registerGeneIdentity(authoring, { geneId: GENE, canonicalSymbol: SYMBOL, now })
      const seedStorage = storage(1)
      await createManifestationUploadIntent(authoring, {
        entityKind: "revision",
        entityId: "revision_seed_b859cost",
        objectKey: seedStorage.object_key,
        ciphertextSha256: seedStorage.ciphertext_sha256,
        bodyBytes: seedStorage.body_bytes,
        actorKind: "migration",
        uploadIntentId: "intent_seed_b859cost",
        leaseToken: "lease_seed_b859cost",
        now,
      })
      await seedSystemManifestation(authoring, {
        geneId: GENE,
        storage: seedStorage,
        expectedHeadVersion: 0,
        expectedCanonicalRevisionId: null,
        manifestationId: "manifestation_seed_b859cost",
        revisionId: "revision_seed_b859cost",
        selectionId: "selection_seed_b859cost",
        eventUuid: "event_seed_b859cost",
        now,
        ...command("command_seed_b859cost", "1", null, "migration"),
      })
      await offerCaretakerAssignment(authoring, {
        geneId: GENE,
        accountId: USER,
        invitedByAccountId: ADMIN,
        entitlementPolicyVersion: "entitlement-v1",
        expectedGeneRevision: 1,
        assignmentId: ASSIGNMENT,
        eventUuid: "event_offer_b859cost",
        now,
        ...command("command_offer_b859cost", "2", ADMIN, "administrator"),
      })
      await transitionCaretakerAssignment(authoring, {
        assignmentId: ASSIGNMENT,
        action: "accept",
        expectedAssignmentVersion: 1,
        termsVersionId: TERMS,
        relinquishPolicy: "retain",
        eventUuid: "event_accept_b859cost",
        now,
        ...command("command_accept_b859cost", "3", USER, "account"),
      })

      let coordinatorRequests = 0
      const coordinator = {
        idFromName: (name) => name,
        get: () => ({
          async fetch() {
            coordinatorRequests++
            return Response.json({ ok: true })
          },
        }),
      }
      // Settle the bootstrap events so the measured save starts from a quiet outbox.
      for (let pass = 0; pass < 12; pass++) {
        const result = await drainIconoplasmManifestationAuthorityProjection(
          {
            ICONOPLASM_DB: primary,
            ICONOPLASM_AUTHORING_DB: authoring,
            ICONOPLASM_CARD_PUBLICATION: coordinator,
          },
          25,
        )
        assert.equal(result.failed, 0, JSON.stringify(result.results))
        if (!result.has_more) break
      }

      const receipts = []
      let phase = "bootstrap"
      const meteredAuthoring = recordingDb(authoring, "authoring", receipts, () => phase)
      const meteredPrimary = recordingDb(primary, "primary", receipts, () => phase)
      const env = {
        ICONOPLASM_AUTHORING_BODY_KEK_V1: base64(new Uint8Array(32).fill(11)),
        ICONOPLASM_AUTHORING_STORAGE_ZONE: STORAGE_ZONE,
        ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "b859-cost-password",
        ICONOPLASM_DB: meteredPrimary,
        ICONOPLASM_AUTHORING_DB: meteredAuthoring,
        ICONOPLASM_CARD_PUBLICATION: coordinator,
      }
      // The production wiring: every accepted event wakes its own projection and
      // fails the request if the event is not published
      // (projectAcceptedManifestationAuthorityEvent).
      const handler = createCaretakerManifestationHttpHandler({
        db: meteredAuthoring,
        primaryDb: meteredPrimary,
        env,
        resolveSession: async () => ({ account_id: USER }),
        onAuthorityEvent: async (event) => {
          const result = await drainIconoplasmManifestationAuthorityProjection(env, 1, {
            priorityEventId: event.event_id,
          })
          const accepted = result.results.find((item) => item.event_id === event.event_id)
          assert.equal(accepted?.status, "published", JSON.stringify(result.results))
        },
      })

      async function reload() {
        const response = await handler(request(BASE))
        assert.equal(response.status, 200)
        return response.json()
      }
      async function mutate(path, body) {
        const response = await handler(
          request(`${BASE}${path}`, {
            method: "POST",
            body: { ...body, command_id: `b859cost_${crypto.randomUUID().replaceAll("-", "")}` },
          }),
        )
        const text = await response.text()
        assert.ok(
          response.status === 200 || response.status === 201 || response.status === 202,
          `${path} answered ${response.status}: ${text}`,
        )
        return JSON.parse(text)
      }

      // The editor's call, with the same expected values it reads from its last dossier.
      async function autosave(label, prose, tagsText, fieldsJson) {
        let dossier = await reload()
        const own = ownManifestation(dossier)
        const previousCanonical = dossier.head.canonical_revision_id
        phase = `${label} save`
        const saved = await mutate("/saves", {
          prose,
          tags_text: tagsText,
          fields_json: fieldsJson,
          expected_assignment_version: Number(dossier.assignment?.assignment_version || 0),
          expected_manifestation_version: Number(own?.row_version || 0),
          based_on_revision_id: null,
          expected_head_version: dossier.head.head_version,
          expected_canonical_revision_id: previousCanonical || null,
        })
        phase = `${label} (reload)`
        dossier = await reload()
        assert.notEqual(saved.manifestation_revision_id, previousCanonical)
        assert.equal(dossier.head.canonical_revision_id, saved.manifestation_revision_id)
        const savedRevision = ownManifestation(dossier).revisions.find(
          (revision) => revision.manifestation_revision_id === saved.manifestation_revision_id,
        )
        assert.equal(savedRevision?.derivative?.status, "accepted", "its Tags are accepted")
        phase = "idle"
      }

      const fields = { archetype: ["archivist"], outfit: ["red_coat"] }
      await autosave(
        "save-1",
        "A tall archivist in a red coat with a careful gaze and ink-stained gloves.",
        "archivist, red_coat",
        fields,
      )
      const afterFirst = receipts.length
      const coordinatorAfterFirst = coordinatorRequests
      await autosave(
        "save-2",
        "A tall archivist in a red coat with a careful gaze, ink-stained gloves and a lantern.",
        "archivist, red_coat, lantern",
        { ...fields, held_item: ["lantern"] },
      )

      function summarize(slice, label) {
        const byDatabase = { authoring: 0, primary: 0 }
        const lines = []
        for (const receipt of slice) {
          byDatabase[receipt.database] += receipt.rows_written
          if (receipt.rows_written > 0)
            lines.push(
              `${label} | ${receipt.phase.padEnd(26)} | ${receipt.database.padEnd(9)} | ${String(
                receipt.rows_written,
              ).padStart(3)} | ${describeStatement(receipt.sql)}`,
            )
        }
        const byPhase = new Map()
        for (const receipt of slice) {
          const key = `${receipt.phase} ${receipt.database}`
          byPhase.set(key, (byPhase.get(key) || 0) + receipt.rows_written)
        }
        for (const [key, rows] of byPhase)
          if (rows) lines.push(`${label} PHASE-TOTAL | ${String(rows).padStart(3)} | ${key}`)
        const byTable = new Map()
        for (const receipt of slice) {
          if (!receipt.rows_written) continue
          const key = `${receipt.database} ${describeStatement(receipt.sql)}`
          byTable.set(key, (byTable.get(key) || 0) + receipt.rows_written)
        }
        for (const [key, rows] of [...byTable].sort((a, b) => b[1] - a[1]))
          lines.push(`${label} TOTAL-BY-STATEMENT | ${String(rows).padStart(3)} | ${key}`)
        lines.push(
          `${label} DATABASE-TOTALS authoring=${byDatabase.authoring} primary=${byDatabase.primary}`,
        )
        return { byDatabase, lines }
      }
      const first = summarize(receipts.slice(0, afterFirst), "B859_SAVE_COST first-save")
      const second = summarize(receipts.slice(afterFirst), "B859_SAVE_COST ordinary-save")
      console.log(
        [
          "B859_SAVE_COST columns: save | phase | database | rows_written | statement",
          ...first.lines,
          ...second.lines,
          `B859_SAVE_COST publication-coordinator-requests first=${coordinatorAfterFirst} second=${coordinatorRequests - coordinatorAfterFirst}`,
        ].join("\n"),
      )

      // Reading the dossier must stay free of writes.
      for (const receipt of receipts.filter((item) => item.phase.endsWith("(reload)")))
        assert.equal(receipt.rows_written, 0, `a dossier read wrote: ${receipt.sql}`)

      assert.ok(
        first.byDatabase.authoring <= MAX_FIRST_SAVE_ROWS_AUTHORING,
        `first save wrote ${first.byDatabase.authoring} authoring rows; B-859 ceiling ${MAX_FIRST_SAVE_ROWS_AUTHORING}`,
      )
      assert.ok(
        first.byDatabase.primary <= MAX_FIRST_SAVE_ROWS_PRIMARY,
        `first save wrote ${first.byDatabase.primary} primary rows; B-859 ceiling ${MAX_FIRST_SAVE_ROWS_PRIMARY}`,
      )
      assert.ok(
        second.byDatabase.authoring <= MAX_SAVE_ROWS_AUTHORING,
        `a save wrote ${second.byDatabase.authoring} authoring rows; B-859 ceiling ${MAX_SAVE_ROWS_AUTHORING}`,
      )
      assert.ok(
        second.byDatabase.primary <= MAX_SAVE_ROWS_PRIMARY,
        `a save wrote ${second.byDatabase.primary} primary rows; B-859 ceiling ${MAX_SAVE_ROWS_PRIMARY}`,
      )
    } finally {
      await runtime.dispose()
    }
  },
)
