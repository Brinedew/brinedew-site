import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  addFavoriteEmulsion,
  listFavoriteEmulsionRows,
  normalizeFavoriteEmulsionFamilyId,
  removeFavoriteEmulsion,
} from "./iconoplasm-emulsion-favorites.js"

class FavoriteDb {
  constructor() {
    this.rows = new Map()
  }

  prepare(sql) {
    var db = this
    var statement = {
      args: [],
      bind(...args) {
        this.args = args
        return this
      },
      async all() {
        var userId = String(this.args[0] || "")
        return {
          results: Array.from(db.rows.values())
            .filter((row) => row.user_id === userId)
            .sort(function (left, right) {
              return right.created_at.localeCompare(left.created_at)
            }),
        }
      },
      async run() {
        var userId = String(this.args[0] || "")
        var emulsionId = String(this.args[1] || "")
        var key = userId + ":" + emulsionId
        if (String(sql).includes("INSERT OR IGNORE") && !db.rows.has(key)) {
          db.rows.set(key, {
            user_id: userId,
            emulsion_family_id: emulsionId,
            created_at: "2026-07-20T10:00:00Z",
          })
        }
        if (String(sql).includes("DELETE FROM")) db.rows.delete(key)
        return { success: true }
      },
    }
    return statement
  }
}

test("server favorite normalization uses the visible family ID", () => {
  assert.equal(normalizeFavoriteEmulsionFamilyId("A1-255-e-e"), "A1-255")
  assert.equal(normalizeFavoriteEmulsionFamilyId("invalid/id"), "")
})

test("favorite persistence is isolated by user and idempotent", async () => {
  var db = new FavoriteDb()
  await addFavoriteEmulsion(db, { userId: "user-1", emulsionFamilyId: "A1-255-e" })
  await addFavoriteEmulsion(db, { userId: "user-1", emulsionFamilyId: "A1-255" })
  await addFavoriteEmulsion(db, { userId: "user-2", emulsionFamilyId: "A1-306" })
  assert.deepEqual(await listFavoriteEmulsionRows(db, "user-1"), [
    { emulsion_family_id: "A1-255", created_at: "2026-07-20T10:00:00Z" },
  ])
  await removeFavoriteEmulsion(db, { userId: "user-1", emulsionFamilyId: "A1-255" })
  await removeFavoriteEmulsion(db, { userId: "user-1", emulsionFamilyId: "A1-255" })
  assert.deepEqual(await listFavoriteEmulsionRows(db, "user-1"), [])
  assert.equal((await listFavoriteEmulsionRows(db, "user-2")).length, 1)
})

test("favorite migration adds account storage and an indexed family projection", () => {
  var migration = readFileSync(
    new URL("../migrations-iconoplasm/0054_user_emulsion_favorites.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /PRIMARY KEY \(user_id, emulsion_family_id\)/)
  assert.match(migration, /ADD COLUMN emulsion_family_id/)
  assert.match(migration, /WITH RECURSIVE normalized/)
  assert.match(migration, /idx_icono_generation_request_options_family/)
})
