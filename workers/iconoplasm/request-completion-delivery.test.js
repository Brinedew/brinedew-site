import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { authorizeIconoplasmAuthorityGenerationBearer } from "../iconoplasm-authority-service-auth.js"
import { createIconoplasmGenerationExecutorHandler } from "../iconoplasm-generation-executor-routes.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  reconcileDeliveredRequestFulfillments,
  ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
} from "../iconoplasm-request-notifications.js"

const TOKEN = "authority-service-token-0000000000000001"
const SHA = "a".repeat(64)

// 2026-10-23: a 10-portrait SOX11 order was drawn across two sessions. The
// first publication's completion answered DISCORD_DELIVERY_PENDING because the
// order's one receipt waits for all ten, the workstation failed the
// publication, and the Drain turned red. This replays that shape on a real D1
// with the production schema, triggers, delivery and settlement code; only
// the publication write and Discord itself are stand-ins.
test(
  "a publication completes while its order's receipt waits for the rest of the order",
  { timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    const originalFetch = globalThis.fetch
    try {
      const db = await runtime.getD1Database("DB")
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
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

      const reader = ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID
      const order = db.prepare(
        "INSERT INTO icono_generation_requests(id,gene_symbol,requester_user_id,status,request_batch_id,request_batch_size) VALUES (?,?,?,'open',?,?)",
      )
      await db.batch([
        order.bind(1, "SOX11", reader, "order-1", 3),
        order.bind(2, "SOX11", reader, "order-1", 3),
        order.bind(3, "SOX11", reader, "order-1", 3),
        order.bind(10, "TP53", "reader-a", "order-a", 1),
        order.bind(11, "TP53", "reader-b", "order-b", 1),
      ])

      const messages = []
      globalThis.fetch = async (url, init) => {
        const value = String(url)
        if (value.startsWith("http://127.0.0.1:") || value.startsWith("http://localhost:"))
          return originalFetch(url, init)
        if (value.startsWith("https://storage.bunnycdn.com/"))
          return new Response(
            new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]),
            { headers: { "Content-Type": "image/webp" } },
          )
        if (value === "https://discord.com/api/v10/users/@me/channels")
          return Response.json({ id: `dm-${JSON.parse(init.body).recipient_id}` })
        const channel = value.match(/channels\/([^/]+)\/messages$/)?.[1]
        assert.ok(channel, value)
        messages.push({
          channel,
          portraits: JSON.parse(init.body.get("payload_json")).attachments.length,
        })
        return Response.json({ id: `message-${messages.length}` })
      }

      const handler = createIconoplasmGenerationExecutorHandler({
        authorizeGenerationBearer: authorizeIconoplasmAuthorityGenerationBearer,
        claimGenerationLeases: async () => ({ leases: [] }),
        // Stand-in for the publication write: the real one moves the published
        // requests to delivery_pending, and the production trigger writes the
        // receipt rows with the order's size.
        fulfillGenerationRequests: async (env, { items }) => {
          const ids = items.flatMap((item) => item.request_ids)
          await env.ICONOPLASM_DB.batch(
            ids.map((id) =>
              env.ICONOPLASM_DB.prepare(
                "UPDATE icono_generation_requests SET status='delivery_pending',fulfilled_asset_sha256=? WHERE id=? AND status='open'",
              ).bind(SHA, id),
            ),
          )
          return { ok: true, request_ids: ids }
        },
        deliverPendingNotifications: deliverPendingRequestFulfillmentNotifications,
        reconcileDeliveredFulfillments: reconcileDeliveredRequestFulfillments,
        inlineDeliveryLimit: 10,
        logger: { error() {} },
      })
      const env = {
        ICONOPLASM_DB: db,
        ICONOPLASM_AUTHORITY_GENERATION_TOKEN: TOKEN,
        DISCORD_BOT_TOKEN: "test-only",
        ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
        ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
        ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
      }
      const complete = async (publication, requestIds, extraEnv = {}) => {
        const response = await handler({
          match: { route: { id: "authority_generation_lease_complete" }, params: {} },
          request: new Request(
            "https://iconoplasm.brinedew.bio/api/iconoplasm/authority/generation-leases/complete",
            {
              method: "POST",
              headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
              body: JSON.stringify({
                publication_id: publication,
                items: [{ request_ids: requestIds }],
              }),
            },
          ),
          env: { ...env, ...extraEnv },
        })
        assert.equal(response.status, 200)
        return response.json()
      }
      const statuses = async () =>
        Object.fromEntries(
          (
            await db.prepare("SELECT id,status FROM icono_generation_requests ORDER BY id").all()
          ).results.map((row) => [row.id, row.status]),
        )

      // The first session publishes two of the order's three portraits. The
      // publication succeeds; the receipt waits, unsent, for the third.
      const first = await complete("publication-1", [1, 2])
      assert.equal(first.ok, true, JSON.stringify(first))
      assert.deepEqual(first.request_ids, [1, 2])
      assert.equal(first.notification_delivery.delivered, 0)
      assert.equal(first.notification_delivery.more_ready, false)
      assert.deepEqual(first.notification_settlement.pending_request_ids, [1, 2])
      assert.equal(messages.length, 0)

      // The next session publishes the third. One receipt carries all three
      // portraits and closes the requests the first publication left open.
      const second = await complete("publication-2", [3])
      assert.equal(second.ok, true, JSON.stringify(second))
      assert.equal(second.fulfilled, 3)
      assert.deepEqual(messages, [{ channel: `dm-${reader}`, portraits: 3 }])
      assert.deepEqual(await statuses(), {
        1: "fulfilled",
        2: "fulfilled",
        3: "fulfilled",
        10: "open",
        11: "open",
      })

      // Two readers' orders land in one publication. The first call sends one
      // receipt and asks for another call; the second sends the other.
      messages.length = 0
      const everyone = { ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters" }
      const partial = await complete("publication-3", [10, 11], everyone)
      assert.equal(partial.ok, false)
      assert.equal(partial.code, "DISCORD_DELIVERY_PENDING")
      assert.equal(partial.notification_delivery.delivered, 1)
      assert.equal(partial.notification_settlement.pending_request_ids.length, 1)
      const rest = await complete("publication-3", [10, 11], everyone)
      assert.equal(rest.ok, true, JSON.stringify(rest))
      assert.deepEqual(messages.map((m) => m.channel).sort(), ["dm-reader-a", "dm-reader-b"])
      assert.equal((await statuses())[10], "fulfilled")
      assert.equal((await statuses())[11], "fulfilled")
    } finally {
      globalThis.fetch = originalFetch
      schema.close()
      await runtime.dispose()
    }
  },
)
