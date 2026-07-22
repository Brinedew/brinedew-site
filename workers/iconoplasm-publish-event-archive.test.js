import assert from "node:assert/strict"
import test from "node:test"

import { archiveColdIconoplasmPublishEvents } from "./iconoplasm-publish-event-archive.js"

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql)
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async all() {
    const [cutoff, limit] = this.args
    return {
      results: this.db.rows
        .filter((row) => row.created_at < cutoff)
        .sort((left, right) => left.id - right.id)
        .slice(0, Number(limit)),
    }
  }

  async run() {
    if (this.sql.includes("INSERT OR IGNORE INTO icono_publish_events")) {
      for (const row of JSON.parse(this.args[0])) this.db.rowsById.set(Number(row.id), { ...row })
    }
    if (this.sql.includes("DELETE FROM icono_publish_events")) {
      const ids = new Set(JSON.parse(this.args[0]).map(Number))
      this.db.rows = this.db.rows.filter((row) => !ids.has(Number(row.id)))
    }
    return { success: true }
  }

  async first() {
    const ids = JSON.parse(this.args[0]).map(Number)
    return { count: ids.filter((id) => this.db.rowsById.has(id)).length }
  }
}

class FakeDb {
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ ...row }))
    this.rowsById = new Map(rows.map((row) => [Number(row.id), { ...row }]))
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    for (const statement of statements) await statement.run()
    return statements.map(() => ({ success: true }))
  }
}

test("archive copies cold events before deleting them from the hot database", async () => {
  const hot = new FakeDb([
    { id: 1, gene_symbol: "TP53", action: "publish", created_at: "2026-05-01T00:00:00.000Z" },
    { id: 2, gene_symbol: "BRCA1", action: "publish", created_at: "2026-07-15T00:00:00.000Z" },
  ])
  const audit = new FakeDb()

  const result = await archiveColdIconoplasmPublishEvents(
    { ICONOPLASM_DB: hot, ICONOPLASM_AUDIT_DB: audit },
    { retentionDays: 30, nowMs: Date.parse("2026-07-22T00:00:00.000Z") },
  )

  assert.equal(result.archived, 1)
  assert.deepEqual(
    hot.rows.map((row) => row.id),
    [2],
  )
  assert.equal(audit.rowsById.get(1)?.gene_symbol, "TP53")
})

test("archive refuses to delete when the cold-copy verification is incomplete", async () => {
  const hot = new FakeDb([
    { id: 1, gene_symbol: "TP53", action: "publish", created_at: "2026-05-01T00:00:00.000Z" },
  ])
  const audit = new FakeDb()
  audit.prepare = function prepare(sql) {
    const statement = new FakeStatement(this, sql)
    if (String(sql).includes("SELECT COUNT(*) AS count"))
      statement.first = async () => ({ count: 0 })
    return statement
  }

  await assert.rejects(
    archiveColdIconoplasmPublishEvents(
      { ICONOPLASM_DB: hot, ICONOPLASM_AUDIT_DB: audit },
      { retentionDays: 30, nowMs: Date.parse("2026-07-22T00:00:00.000Z") },
    ),
    /archive verification failed/,
  )
  assert.deepEqual(
    hot.rows.map((row) => row.id),
    [1],
  )
})
