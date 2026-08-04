import assert from "node:assert/strict"
import test from "node:test"

import { handleAdminSchedule } from "./admin.js"

const isoToday = () => new Date().toISOString().slice(0, 10)

test("year schedule bulk-loads summaries and never returns a partial 200 response", async () => {
  const proteins = Array.from({ length: 500 }, (_, index) => {
    const suffix = String(index).padStart(5, "0")
    return {
      uniprot: `P${suffix}`,
      gene: `GENE${suffix}`,
      gene_surname: `FAMILY${suffix}`,
      full_name: `Protein ${suffix}`,
      length: 100 + index,
    }
  })
  const proteinsById = new Map(proteins.map((protein) => [protein.uniprot, protein]))
  const statements = []
  const db = {
    prepare(sql) {
      statements.push(sql)
      let bound = []
      return {
        bind(...values) {
          bound = values
          return this
        },
        async all() {
          if (sql.includes("SELECT p.uniprot, p.gene_surname")) {
            return {
              results: proteins.map(({ uniprot, gene_surname }) => ({
                uniprot,
                gene_surname,
              })),
            }
          }
          if (sql.includes("FROM proteins") && sql.includes("json_each(?)")) {
            const ids = JSON.parse(bound[0])
            return { results: ids.map((id) => proteinsById.get(id)).filter(Boolean) }
          }
          throw new Error(`Unexpected D1 query: ${sql}`)
        },
      }
    },
  }

  const today = isoToday()
  const storedScheduleDays = new Map()
  const kv = {
    async list({ prefix }) {
      if (prefix === "puzzle_actual:") {
        return {
          list_complete: true,
          keys: [
            {
              name: `puzzle_actual:${today}`,
              metadata: { uniprot_id: proteins[0].uniprot, source: "computed" },
            },
          ],
        }
      }
      return { list_complete: true, keys: [] }
    },
    async get(key) {
      return storedScheduleDays.get(key) || null
    },
    async put(key, value) {
      storedScheduleDays.set(key, JSON.parse(value))
    },
    async delete() {},
  }
  const env = {
    DB: db,
    KV: kv,
    DAILY_TARGET_SALT: "year-schedule-test",
    ADMIN_DISCORD_USER_ID: "admin-user",
    GAME_SESSIONS: {
      idFromName(value) {
        return value
      },
      get() {
        return {
          async fetch() {
            return Response.json({ user_id: "admin-user" })
          },
        }
      },
    },
  }

  const response = await handleAdminSchedule(
    new Request("https://example.test/api/admin/schedule?futureDays=365", {
      headers: { Cookie: "session=test-session" },
    }),
    env,
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.upcoming.length, 365)
  assert.equal(body.upcoming.filter((row) => row.computed?.uniprot).length, 365)
  assert.equal(new Set(body.upcoming.map((row) => row.computed.uniprot)).size, 365)
  assert.equal(new Set(body.upcoming.map((row) => row.computed.gene_surname)).size, 365)
  assert.equal(
    statements.length,
    3,
    "history, selection pool, and future summaries are each bulk queries",
  )
  assert.ok(statements.every((sql) => !sql.includes("SELECT * FROM proteins")))
})

test("year schedule fails closed when planned protein summaries are unavailable", async () => {
  const proteins = Array.from({ length: 500 }, (_, index) => {
    const suffix = String(index).padStart(5, "0")
    return {
      uniprot: `P${suffix}`,
      gene: `GENE${suffix}`,
      gene_surname: `FAMILY${suffix}`,
      full_name: `Protein ${suffix}`,
      length: 100 + index,
    }
  })
  const db = {
    prepare(sql) {
      let bound = []
      return {
        bind(...values) {
          bound = values
          return this
        },
        async all() {
          if (sql.includes("SELECT p.uniprot, p.gene_surname")) {
            return {
              results: proteins.map(({ uniprot, gene_surname }) => ({
                uniprot,
                gene_surname,
              })),
            }
          }
          if (sql.includes("FROM proteins") && sql.includes("json_each(?)")) {
            const ids = JSON.parse(bound[0])
            return {
              results: ids.length === 1 && ids[0] === proteins[0].uniprot ? [proteins[0]] : [],
            }
          }
          throw new Error(`Unexpected D1 query: ${sql}`)
        },
      }
    },
  }
  const today = isoToday()
  const kv = {
    async list({ prefix }) {
      return prefix === "puzzle_actual:"
        ? {
            list_complete: true,
            keys: [
              {
                name: `puzzle_actual:${today}`,
                metadata: { uniprot_id: proteins[0].uniprot, source: "computed" },
              },
            ],
          }
        : { list_complete: true, keys: [] }
    },
    async get() {
      return null
    },
    async put() {
      assert.fail("invalid schedule entries must not be cached")
    },
    async delete() {},
  }
  const env = {
    DB: db,
    KV: kv,
    DAILY_TARGET_SALT: "year-schedule-incomplete-test",
    ADMIN_DISCORD_USER_ID: "admin-user",
    GAME_SESSIONS: {
      idFromName(value) {
        return value
      },
      get() {
        return {
          async fetch() {
            return Response.json({ user_id: "admin-user" })
          },
        }
      },
    },
  }

  const response = await handleAdminSchedule(
    new Request("https://example.test/api/admin/schedule?futureDays=365", {
      headers: { Cookie: "session=test-session" },
    }),
    env,
  )
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.equal(body.error, "Admin schedule generation incomplete")
  assert.equal(body.requested, 365)
  assert.equal(body.completed, 0)
  assert.equal(body.incomplete_dates.length, 365)
})
