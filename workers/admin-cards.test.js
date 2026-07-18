import assert from "node:assert/strict"
import test from "node:test"

import { handleAdminCards } from "./admin.js"

function adminSessions() {
  return {
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
  }
}

test("admin cards returns a recorded historical target without a scope error", async () => {
  const uniprot = "P9ADMIN"
  const response = await handleAdminCards(
    new Request("https://geneguessr.brinedew.bio/api/admin/cards?date=2026-07-17", {
      headers: { Cookie: "session=test-session" },
    }),
    {
      ADMIN_DISCORD_USER_ID: "admin-user",
      GAME_SESSIONS: adminSessions(),
      KV: {
        async get(key) {
          assert.equal(key, "puzzle_actual:2026-07-17")
          return JSON.stringify({
            date: "2026-07-17",
            uniprot_id: uniprot,
            source: "computed",
            rejected: [],
          })
        },
      },
      DB: {
        prepare(sql) {
          assert.match(sql, /FROM proteins WHERE uniprot = \? LIMIT 1/)
          return {
            bind(value) {
              assert.equal(value, uniprot)
              return {
                async first() {
                  return {
                    uniprot,
                    gene: "ADMINTEST",
                    full_name: "Admin cards scope regression protein",
                    length: 123,
                    has_structure: 1,
                    structure_source: "alphafold",
                    alphafold_url: `https://alphafold.example/${uniprot}.cif`,
                    synonyms: "[]",
                    domains: "[]",
                    clans: "[]",
                    locations: "[]",
                    go_bp: "[]",
                    go_mf: "[]",
                    go_cc: "[]",
                    pathways: "[]",
                    neighbors: "[]",
                    cath_architecture: "[]",
                  }
                },
              }
            },
          }
        },
      },
    },
  )

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.selection.uniprot_id, uniprot)
  assert.equal(payload.selection.recorded, true)
  assert.equal(payload.protein.hgnc, "ADMINTEST")
})
