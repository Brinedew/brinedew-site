import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminPullZoneHandlers } from "./iconoplasm-admin-pull-zone-route.js"

// B-898: the Bunny pull zone's CORS extensions are owned by
// bunny/the-only-iconoplasm-pull-zone-policy.json and applied through this
// route with the Worker's account key. Failure modes written before the code:
// 1. not an administrator -> 403, no Bunny call;
// 2. no BUNNY_ACCOUNT_API_KEY -> 503, no Bunny call;
// 3. a policy whose settings already hold -> reported unchanged, no update call;
// 4. a missing extension -> one update that keeps every existing extension and
//    adds the missing one, with EnableAccessControlOriginHeader true;
// 5. the named pull zone does not exist -> 404, no update call;
// 6. a malformed policy body -> 400, no Bunny call.
const POLICY = {
  schemaVersion: 1,
  pullZoneName: "iconoplasmportraits",
  settings: { EnableAccessControlOriginHeader: true },
  ensureAccessControlOriginHeaderExtensions: ["json", "webp"],
}

function harness({ admin = true, key = "bunny-key", zones = null } = {}) {
  const calls = []
  const list = zones || [
    {
      Id: 42,
      Name: "iconoplasmportraits",
      EnableAccessControlOriginHeader: true,
      AccessControlOriginHeaderExtensions: ["webp", "woff2"],
    },
    {
      Id: 7,
      Name: "other",
      EnableAccessControlOriginHeader: false,
      AccessControlOriginHeaderExtensions: [],
    },
  ]
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers, body: init.body })
    if (url === "https://api.bunny.net/pullzone" && (init.method || "GET") === "GET") {
      return Response.json(list)
    }
    if (/^https:\/\/api\.bunny\.net\/pullzone\/\d+$/.test(url) && init.method === "POST") {
      return Response.json({ ...list[0], ...JSON.parse(init.body) })
    }
    return new Response(null, { status: 404 })
  }
  const handlers = createIconoplasmAdminPullZoneHandlers({
    isAdmin: async () => admin,
    json: (body, status = 200, headers = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    fetchImpl,
  })
  const reconcile = handlers["admin_publication.pull_zone_reconcile"]
  const call = (policy) =>
    reconcile({
      env: { BUNNY_ACCOUNT_API_KEY: key },
      done: (_name, response) => response,
      request: new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/reconcile-pull-zone",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: typeof policy === "string" ? policy : JSON.stringify(policy),
        },
      ),
    })
  return { call, calls }
}

test("a non-administrator is refused without a Bunny call", async () => {
  const h = harness({ admin: false })
  assert.equal((await h.call(POLICY)).status, 403)
  assert.equal(h.calls.length, 0)
})

test("no account key: 503 without a Bunny call", async () => {
  const h = harness({ key: "" })
  assert.equal((await h.call(POLICY)).status, 503)
  assert.equal(h.calls.length, 0)
})

test("a missing extension is added, existing ones kept, in one update", async () => {
  const h = harness()
  const response = await h.call(POLICY)
  assert.equal(response.status, 200)
  const reply = await response.json()
  assert.equal(reply.ok, true)
  assert.equal(reply.pull_zone_id, 42)
  assert.equal(reply.changed, true)
  assert.deepEqual(reply.after.AccessControlOriginHeaderExtensions, ["webp", "woff2", "json"])
  const update = h.calls.find((c) => c.method === "POST")
  assert.equal(update.url, "https://api.bunny.net/pullzone/42")
  assert.equal(update.headers.AccessKey, "bunny-key")
  assert.deepEqual(JSON.parse(update.body), {
    EnableAccessControlOriginHeader: true,
    AccessControlOriginHeaderExtensions: ["webp", "woff2", "json"],
  })
})

test("a policy that already holds is reported unchanged with no update", async () => {
  const h = harness({
    zones: [
      {
        Id: 42,
        Name: "iconoplasmportraits",
        EnableAccessControlOriginHeader: true,
        AccessControlOriginHeaderExtensions: ["json", "webp"],
      },
    ],
  })
  const reply = await (await h.call(POLICY)).json()
  assert.equal(reply.changed, false)
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0)
})

test("an unknown pull zone name is a 404 with no update", async () => {
  const h = harness({ zones: [{ Id: 1, Name: "elsewhere" }] })
  assert.equal((await h.call(POLICY)).status, 404)
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0)
})

test("a malformed policy is a 400 with no Bunny call", async () => {
  const h = harness()
  assert.equal((await h.call({ schemaVersion: 2 })).status, 400)
  assert.equal((await h.call("not json")).status, 400)
  assert.equal(h.calls.length, 0)
})
