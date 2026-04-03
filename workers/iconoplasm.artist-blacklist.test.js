import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

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

function buildEnv() {
  return {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_TURNSTILE_SECRET_KEY: "",
    ICONOPLASM_DB: new FakeIconoplasmDb(),
  }
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

test("guest blacklist submissions stay singular per requester identity", async () => {
  const env = buildEnv()

  const firstResponse = await handleIconoplasmRequest(
    buildSubmissionRequest({ artistTag: "@first_tag", ip: "203.0.113.10" }),
    env,
    {},
  )
  const firstJson = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(firstJson.queued, true)
  assert.equal(firstJson.accepted, true)
  assert.equal(firstJson.requesterLocked, false)

  const secondResponse = await handleIconoplasmRequest(
    buildSubmissionRequest({ artistTag: "@second_tag", ip: "203.0.113.10" }),
    env,
    {},
  )
  const secondJson = await secondResponse.json()
  assert.equal(secondResponse.status, 200)
  assert.equal(secondJson.queued, false)
  assert.equal(secondJson.accepted, false)
  assert.equal(secondJson.requesterLocked, true)
  assert.equal(env.ICONOPLASM_DB.submissions.length, 1)
})

test("admin blacklist submissions can queue multiple tags from the same account", async () => {
  const env = buildEnv()

  const firstResponse = await handleIconoplasmRequest(
    buildSubmissionRequest({ artistTag: "@first_tag", ip: "203.0.113.11", admin: true }),
    env,
    {},
  )
  const firstJson = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(firstJson.queued, true)
  assert.equal(firstJson.accepted, true)
  assert.equal(firstJson.requesterLocked, false)

  const secondResponse = await handleIconoplasmRequest(
    buildSubmissionRequest({ artistTag: "@second_tag", ip: "203.0.113.11", admin: true }),
    env,
    {},
  )
  const secondJson = await secondResponse.json()
  assert.equal(secondResponse.status, 200)
  assert.equal(secondJson.queued, true)
  assert.equal(secondJson.accepted, true)
  assert.equal(secondJson.requesterLocked, false)
  assert.equal(env.ICONOPLASM_DB.submissions.length, 2)
  assert.deepEqual(
    env.ICONOPLASM_DB.submissions.map((row) => row.source),
    ["admin_form", "admin_form"],
  )
})
