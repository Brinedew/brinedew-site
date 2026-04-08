import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmCallerRequest } from "./iconoplasm-caller.js"
import { handleIconoplasmDbGatewayRequest } from "./iconoplasm-gateway.js"

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    if (
      this.sql.includes("FROM icono_artist_blacklist_submissions") &&
      this.sql.includes("normalized_input = ?") &&
      this.sql.includes("resolved_at IS NULL")
    ) {
      const normalizedInput = String(this.args[0] || "")
      const matches = this.db.submissions.filter(
        (row) => row.normalized_input === normalizedInput && !row.resolved_at,
      )
      return matches.length ? { ...matches[matches.length - 1] } : null
    }

    if (
      this.sql.includes("FROM icono_artist_blacklist_submissions") &&
      this.sql.includes("WHERE requested_by = ?")
    ) {
      const requestedBy = String(this.args[0] || "")
      const match = this.db.submissions.find((row) => row.requested_by === requestedBy) || null
      return match ? { ...match } : null
    }

    return null
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_artist_blacklist_submissions")) {
      const [artistNameInput, normalizedInput, requestedBy, source, turnstilePassed] = this.args
      const row = {
        id: this.db.nextId++,
        artist_name_input: String(artistNameInput || ""),
        normalized_input: String(normalizedInput || ""),
        requested_by: String(requestedBy || ""),
        source: String(source || "public_form"),
        turnstile_passed: Number(turnstilePassed || 0),
        requested_at: `2026-04-03 00:00:${String(this.db.nextId).padStart(2, "0")}`,
        resolved_at: null,
        resolved_by: null,
        resolved_status: "",
        resolved_note: "",
      }
      this.db.submissions.push(row)
      return { success: true }
    }

    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor() {
    this.submissions = []
    this.nextId = 1
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_DB_GATEWAY) {
    env.THE_ONLY_ALLOWED_DB_GATEWAY = {
      fetch(request) {
        return handleIconoplasmDbGatewayRequest(request, gatewayEnv, ctx)
      },
    }
  }
  return env
}

function buildEnv({ bindGateway = true } = {}) {
  const gatewayDb = new FakeIconoplasmDb()
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_TURNSTILE_SECRET_KEY: "",
    ICONOPLASM_DB: gatewayDb,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

function buildSubmissionRequest({ artistTag, ip, admin = false }) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "CF-Connecting-IP": ip,
  })
  if (admin) {
    headers.set("Authorization", "Bearer secret-admin-token")
  }
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/artist-blacklist-submissions", {
    method: "POST",
    headers,
    body: JSON.stringify({ artist_name_input: artistTag }),
  })
}

test("legacy artist-styles route redirects to /blocklist", async () => {
  const response = await handleIconoplasmCallerRequest(
    new Request("https://iconoplasm.brinedew.bio/artist-styles?source=faq"),
    buildEnv(),
    {},
  )

  assert.equal(response.status, 308)
  assert.equal(
    response.headers.get("Location"),
    "https://iconoplasm.brinedew.bio/blocklist?source=faq",
  )
})

test("blocklist route serves the public blocklist page", async () => {
  const response = await handleIconoplasmCallerRequest(
    new Request("https://iconoplasm.brinedew.bio/blocklist"),
    buildEnv(),
    {},
  )

  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /Blocklist an artist tag\./)
  assert.match(html, /Use the exact @tag as shown on the site\. Spaces are not allowed\./)
})

test("guest blacklist submissions stay singular per requester identity", async () => {
  const env = buildEnv()

  const firstResponse = await handleIconoplasmCallerRequest(
    buildSubmissionRequest({ artistTag: "@first_tag", ip: "203.0.113.10" }),
    env,
    {},
  )
  const firstJson = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(firstJson.queued, true)
  assert.equal(firstJson.accepted, true)
  assert.equal(firstJson.requesterLocked, false)

  const secondResponse = await handleIconoplasmCallerRequest(
    buildSubmissionRequest({ artistTag: "@second_tag", ip: "203.0.113.10" }),
    env,
    {},
  )
  const secondJson = await secondResponse.json()
  assert.equal(secondResponse.status, 200)
  assert.equal(secondJson.queued, false)
  assert.equal(secondJson.accepted, false)
  assert.equal(secondJson.requesterLocked, true)
  assert.equal(env.gatewayDb.submissions.length, 1)
})

test("admin blacklist submissions can queue multiple tags from the same account", async () => {
  const env = buildEnv()

  const firstResponse = await handleIconoplasmCallerRequest(
    buildSubmissionRequest({ artistTag: "@first_tag", ip: "203.0.113.11", admin: true }),
    env,
    {},
  )
  const firstJson = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(firstJson.queued, true)
  assert.equal(firstJson.accepted, true)
  assert.equal(firstJson.requesterLocked, false)

  const secondResponse = await handleIconoplasmCallerRequest(
    buildSubmissionRequest({ artistTag: "@second_tag", ip: "203.0.113.11", admin: true }),
    env,
    {},
  )
  const secondJson = await secondResponse.json()
  assert.equal(secondResponse.status, 200)
  assert.equal(secondJson.queued, true)
  assert.equal(secondJson.accepted, true)
  assert.equal(secondJson.requesterLocked, false)
  assert.equal(env.gatewayDb.submissions.length, 2)
  assert.deepEqual(
    env.gatewayDb.submissions.map((row) => row.source),
    ["admin_form", "admin_form"],
  )
})

test("admin artist-style remove keeps the provided artist name", async () => {
  const env = buildEnv()

  const response = await handleIconoplasmCallerRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/artist-styles/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-admin-token",
      },
      body: JSON.stringify({
        artist_tag: "@a1bg_artist",
        artist_name: "A1BG Artist",
        dry_run: true,
      }),
    }),
    env,
    {},
  )

  const json = await response.json()
  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.artist_tag, "@a1bg_artist")
  assert.equal(json.artist_name, "A1BG Artist")
})

