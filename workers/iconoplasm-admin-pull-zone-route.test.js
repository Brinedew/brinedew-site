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

// The pull zone forces a 30-day edge cache time, and Bunny replicates an
// overwritten storage file to other regions asynchronously: on 2026-10-02 a
// republished genes/v3/ABCC11.json was re-pulled by the Vietnam and Singapore
// edges from a replica that still held the old file more than two minutes
// after the write, so the purge was undone for 30 days. A policy edge rule
// gives the mutable stable objects a short edge cache time. Failure modes
// written before the code:
// 7. a policy rule missing on the zone -> one addOrUpdate without a Guid, then
//    one synchronous purge per covered path on the zone's b-cdn host;
// 8. an identical existing rule (matched by description) -> no addOrUpdate and
//    no purge;
// 9. an existing rule with another cache time -> addOrUpdate with its Guid,
//    then the purge;
// 10. a refused addOrUpdate -> 502 and no purge;
// 11. a malformed rule -> 400 with no Bunny call.
const RULE = {
  description: "Mutable stable objects: 60 s edge cache",
  actionType: 3,
  actionParameter1: "60",
  triggerMatchingType: 0,
  triggers: [
    { type: 0, patternMatchingType: 0, patternMatches: ["*/genes/v3/*", "*/catalog/v3/*"] },
  ],
  purgeOnChange: ["genes/v3/*", "catalog/v3/*"],
}
const RULE_POLICY = {
  ...POLICY,
  ensureAccessControlOriginHeaderExtensions: ["webp"],
  edgeRules: [RULE],
}

function ruleHarness({ existingRules = [], refuseRule = false } = {}) {
  const calls = []
  const zone = {
    Id: 42,
    Name: "iconoplasmportraits",
    EnableAccessControlOriginHeader: true,
    AccessControlOriginHeaderExtensions: ["webp"],
    EdgeRules: existingRules,
  }
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body })
    if (url === "https://api.bunny.net/pullzone" && (init.method || "GET") === "GET") {
      return Response.json([zone])
    }
    if (url === "https://api.bunny.net/pullzone/42/edgerules/addOrUpdate") {
      return refuseRule ? new Response(null, { status: 400 }) : new Response(null, { status: 204 })
    }
    if (url.startsWith("https://api.bunny.net/purge?")) return new Response(null, { status: 200 })
    return new Response(null, { status: 404 })
  }
  const handlers = createIconoplasmAdminPullZoneHandlers({
    isAdmin: async () => true,
    json: (body, status = 200, headers = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    fetchImpl,
  })
  const call = (policy) =>
    handlers["admin_publication.pull_zone_reconcile"]({
      env: { BUNNY_ACCOUNT_API_KEY: "bunny-key" },
      done: (_name, response) => response,
      request: new Request("https://iconoplasm.brinedew.bio/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      }),
    })
  return { call, calls }
}

const existingRule = (overrides = {}) => ({
  Guid: "rule-guid-1",
  ActionType: 3,
  ActionParameter1: "60",
  TriggerMatchingType: 0,
  Enabled: true,
  Description: RULE.description,
  Triggers: [
    { Type: 0, PatternMatchingType: 0, PatternMatches: ["*/genes/v3/*", "*/catalog/v3/*"] },
  ],
  ...overrides,
})

test("a missing edge rule is created and its paths are purged once", async () => {
  const h = ruleHarness()
  const response = await h.call(RULE_POLICY)
  assert.equal(response.status, 200)
  const writes = h.calls.filter((c) => c.url.endsWith("/edgerules/addOrUpdate"))
  assert.equal(writes.length, 1)
  const body = JSON.parse(writes[0].body)
  assert.equal(body.Guid, null)
  assert.equal(body.ActionType, 3)
  assert.equal(body.ActionParameter1, "60")
  assert.equal(body.Enabled, true)
  assert.deepEqual(body.Triggers[0].PatternMatches, ["*/genes/v3/*", "*/catalog/v3/*"])
  const purges = h.calls.filter((c) => c.url.startsWith("https://api.bunny.net/purge?"))
  assert.deepEqual(
    purges.map((c) => new URL(c.url).searchParams.get("url")),
    [
      "https://iconoplasmportraits.b-cdn.net/genes/v3/*",
      "https://iconoplasmportraits.b-cdn.net/catalog/v3/*",
    ],
  )
  assert.equal(
    purges.every((c) => new URL(c.url).searchParams.get("async") === "false"),
    true,
  )
  const payload = await response.json()
  assert.equal(payload.edge_rules[0].changed, true)
})

test("an identical edge rule is left alone with no purge", async () => {
  const h = ruleHarness({ existingRules: [existingRule()] })
  const response = await h.call(RULE_POLICY)
  assert.equal(response.status, 200)
  assert.equal(
    h.calls.some((c) => c.url.endsWith("/edgerules/addOrUpdate")),
    false,
  )
  assert.equal(
    h.calls.some((c) => c.url.startsWith("https://api.bunny.net/purge?")),
    false,
  )
  assert.equal((await response.json()).edge_rules[0].changed, false)
})

test("a changed edge rule is updated by its Guid and then purged", async () => {
  const h = ruleHarness({ existingRules: [existingRule({ ActionParameter1: "2592000" })] })
  const response = await h.call(RULE_POLICY)
  assert.equal(response.status, 200)
  const writes = h.calls.filter((c) => c.url.endsWith("/edgerules/addOrUpdate"))
  assert.equal(writes.length, 1)
  assert.equal(JSON.parse(writes[0].body).Guid, "rule-guid-1")
  assert.equal(h.calls.filter((c) => c.url.startsWith("https://api.bunny.net/purge?")).length, 2)
})

test("a refused edge rule update is a 502 with no purge", async () => {
  const h = ruleHarness({ refuseRule: true })
  const response = await h.call(RULE_POLICY)
  assert.equal(response.status, 502)
  assert.equal(
    h.calls.some((c) => c.url.startsWith("https://api.bunny.net/purge?")),
    false,
  )
})

test("a malformed edge rule is a 400 with no Bunny call", async () => {
  const h = ruleHarness()
  for (const bad of [
    { ...RULE, actionType: "3" },
    { ...RULE, triggers: [] },
    { ...RULE, purgeOnChange: ["../etc"] },
    { ...RULE, description: "" },
  ]) {
    const response = await h.call({ ...RULE_POLICY, edgeRules: [bad] })
    assert.equal(response.status, 400)
  }
  assert.equal(h.calls.length, 0)
})
