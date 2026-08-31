import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const MIGRATIONS = [
  "../../../migrations-iconoplasm-authoring/0001_caretaker_manifestation_authority.sql",
  "../../../migrations-iconoplasm-authoring/0002_caretaker_server_boundary.sql",
  "../../../migrations-iconoplasm-authoring/0004_caretaker_terms_2026_08_30.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))

class TestStatement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new TestStatement(this.database, this.sql, parameters)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) || null
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) }
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class TestD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    for (const migration of MIGRATIONS) this.raw.exec(migration)
  }

  prepare(sql) {
    return new TestStatement(this.raw, sql)
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }

  close() {
    this.raw.close()
  }
}

function row(db, sql, ...parameters) {
  return db.raw.prepare(sql).get(...parameters) || null
}

function rows(db, sql, ...parameters) {
  return db.raw.prepare(sql).all(...parameters)
}

function sha(character) {
  return character.repeat(64)
}

function command(commandId, hashCharacter = "a", actorAccountId = null, actorKind = "service") {
  return {
    commandId,
    requestSha256: sha(hashCharacter),
    actorAccountId,
    actorKind,
  }
}

function storage(sequence, bodyBytes = 100) {
  const locator = `opaque_${String(sequence).padStart(4, "0")}_${"x".repeat(40)}`
  return {
    body_sha256: sha(sequence % 2 ? "b" : "c"),
    body_bytes: bodyBytes,
    object_key: `private/manifestations/v1/aa/${locator}.bin`,
    ciphertext_sha256: sha(sequence % 2 ? "d" : "e"),
    ciphertext_bytes: bodyBytes + 16,
    body_iv_base64: "A".repeat(16),
    wrapped_dek_base64: "B".repeat(32),
    wrap_iv_base64: "C".repeat(16),
    key_version: 1,
    aad_version: 1,
    object_etag: `etag-${sequence}`,
    verified_at: "2026-08-30T00:00:00.000Z",
  }
}

export { TestD1, command, row, rows, sha, storage }
