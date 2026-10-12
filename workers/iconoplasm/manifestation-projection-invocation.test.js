import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { drainIconoplasmManifestationAuthorityProjection } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createD1InvocationBudget } from "../lib/d1-invocation-budget.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import {
  registerGeneIdentity,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  seedSystemManifestation,
  offerCaretakerAssignment,
  transitionCaretakerAssignment,
  projectAuthorityAccountStatus,
} from "./caretaker/manifestation-authority.js"
import { command, storage, sha } from "./caretaker/manifestation-authority-test-support.js"
import { plainBodyObject } from "../lib/iconoplasm-body-object-test-support.js"

// The projection copies each gene's text into the plain tables (B-1065
// write-through), so every seed has a real body in a fake Bunny zone.
const BODY_ENV = {
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "projection-cost",
  ICONOPLASM_AUTHORING_STORAGE_HOST: "projection-storage.invalid",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "local-test",
}

function serveBodies(t, bodies) {
  const nativeFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    if (url.hostname !== BODY_ENV.ICONOPLASM_AUTHORING_STORAGE_HOST) return nativeFetch(input, init)
    const item = bodies.find((body) => url.pathname === `/projection-cost/${body.object_key}`)
    return item ? new Response(item.bytes) : new Response(null, { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = nativeFetch
  })
}

async function installSchema(db, directory) {
  const schema = new DatabaseSync(":memory:")
  try {
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith(".sql"))
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

test(
  "real scheduled projection includes both callback paths in its shared D1 statement ceiling",
  { timeout: 120000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["PRIMARY", "AUTHORING"],
      }),
    )
    try {
      const primary = await runtime.getD1Database("PRIMARY"),
        authoring = await runtime.getD1Database("AUTHORING")
      await installSchema(primary, new URL("../../migrations-iconoplasm/", import.meta.url))
      await installSchema(
        authoring,
        new URL("../../migrations-iconoplasm-authoring/", import.meta.url),
      )
      await primary
        .prepare(
          "UPDATE icono_manifestation_projection_authority SET mode='authoritative',authority_epoch=2 WHERE singleton=1",
        )
        .run()
      const now = new Date().toISOString(),
        admin = "account_projection_admin",
        terms = "terms_projection_cost"
      await registerAuthorityAccount(authoring, {
        accountId: admin,
        publicCreditLabel: "Administrator",
        now,
      })
      await registerCaretakerTermsVersion(authoring, {
        termsVersionId: terms,
        termsSha256: sha("f"),
        documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
        displayLabel: "Terms",
        effectiveAt: now,
        createdByAccountId: admin,
      })
      const bodies = []
      serveBodies(t, bodies)
      for (let i = 1; i <= 10; i++) {
        const body = { ...storage(i), ...(await plainBodyObject(`P${i} keeps the ledger.`)) }
        bodies.push(body)
        const geneId = `gene_projection_cost_${i}`,
          accountId = `account_projection_cost_${i}`,
          assignmentId = `assignment_projection_cost_${i}`
        await registerAuthorityAccount(authoring, {
          accountId,
          publicCreditLabel: `Caretaker ${i}`,
          now,
        })
        await registerGeneIdentity(authoring, { geneId, canonicalSymbol: `P${i}`, now })
        await seedSystemManifestation(authoring, {
          geneId,
          storage: body,
          expectedHeadVersion: 0,
          expectedCanonicalRevisionId: null,
          manifestationId: `manifestation_seed_cost_${i}`,
          revisionId: `revision_seed_cost_${i}`,
          selectionId: `selection_seed_cost_${i}`,
          eventUuid: `event_seed_cost_${i}`,
          now,
          ...command(`command_seed_cost_${i}`, "1", null, "migration"),
        })
        await offerCaretakerAssignment(authoring, {
          geneId,
          accountId,
          invitedByAccountId: admin,
          entitlementPolicyVersion: "entitlement-v1",
          expectedGeneRevision: 1,
          assignmentId,
          eventUuid: `event_offer_cost_${i}`,
          now,
          ...command(`command_offer_cost_${i}`, "2", admin, "administrator"),
        })
        await transitionCaretakerAssignment(authoring, {
          assignmentId,
          action: "accept",
          expectedAssignmentVersion: 1,
          termsVersionId: terms,
          relinquishPolicy: "retain",
          eventUuid: `event_accept_cost_${i}`,
          now,
          ...command(`command_accept_cost_${i}`, "3", accountId, "account"),
        })
      }
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
      let completed = false,
        totalPublished = 0
      for (let pass = 0; pass < 12; pass++) {
        const observed = createD1InvocationBudget(),
          primaryMeter = createOperationCostD1Meter(primary),
          authoringMeter = createOperationCostD1Meter(authoring)
        const before = coordinatorRequests
        const result = await drainIconoplasmManifestationAuthorityProjection(
          {
            ICONOPLASM_DB: observed.binding(primaryMeter.db),
            ICONOPLASM_AUTHORING_DB: observed.binding(authoringMeter.db),
            ICONOPLASM_CARD_PUBLICATION: coordinator,
            ...BODY_ENV,
          },
          25,
        )
        assert.equal(result.failed, 0, JSON.stringify(result.results))
        assert.equal(
          result.statement_count,
          observed.used,
          "callback statements must share the caller's accounting",
        )
        assert.ok(observed.used <= 50)
        assert.ok(coordinatorRequests - before <= 2 * result.published)
        totalPublished += result.published
        t.diagnostic(
          JSON.stringify({
            pass,
            published: result.published,
            statements: observed.used,
            coordinatorRequests: coordinatorRequests - before,
            primary: primaryMeter.finish(),
            authoring: authoringMeter.finish(),
          }),
        )
        if (!result.has_more) {
          completed = true
          break
        }
      }
      assert.equal(completed, true)
      assert.equal(totalPublished, 10)
      assert.equal(
        (
          await authoring
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_manifestation_events WHERE projection_status<>'published'",
            )
            .first()
        ).n,
        0,
      )
      // B-1065 B2b: roles live in the main database (caretaker-roles.js), so an
      // old role event drains as published and copies nothing.
      assert.equal(
        (
          await primary
            .prepare("SELECT COUNT(*) AS n FROM icono_caretaker_assignment_notifications")
            .first()
        ).n,
        0,
      )
      assert.equal(
        (
          await primary
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_manifestation_publication_wakes WHERE status='published'",
            )
            .first()
        ).n,
        10,
      )
      const changed = await projectAuthorityAccountStatus(authoring, {
        accountId: "account_projection_cost_1",
        status: "disabled",
        sourceEventId: "account_disable_cost_1",
        sourceEventSequence: 1,
        occurredAt: new Date().toISOString(),
      })
      const observed = createD1InvocationBudget()
      const result = await drainIconoplasmManifestationAuthorityProjection(
        {
          ICONOPLASM_DB: observed.binding(primary),
          ICONOPLASM_AUTHORING_DB: observed.binding(authoring),
          ICONOPLASM_CARD_PUBLICATION: coordinator,
          ...BODY_ENV,
        },
        1,
        { priorityEventId: changed.event_id },
      )
      assert.equal(result.failed, 0, JSON.stringify(result.results))
      assert.equal(result.statement_count, observed.used)
      assert.ok(observed.used <= 50)
      assert.equal(
        (
          await authoring
            .prepare("SELECT projection_status FROM icono_manifestation_events WHERE event_uuid=?")
            .bind(changed.event_id)
            .first()
        ).projection_status,
        "published",
      )
    } finally {
      await runtime.dispose()
    }
  },
)
