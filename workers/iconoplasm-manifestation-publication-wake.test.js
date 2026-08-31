import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { drainManifestationPublicCardPublicationWakes } from "./iconoplasm-manifestation-publication-wake.js"

class Statement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new Statement(this.database, this.sql, parameters)
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

class D1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    this.raw.exec(`
      CREATE TABLE icono_manifestation_publication_wakes (
        authority_event_id TEXT PRIMARY KEY,
        authority_event_sequence INTEGER NOT NULL UNIQUE,
        gene_id TEXT NOT NULL,
        canonical_symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT
      );
      CREATE TABLE icono_publish_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_symbol TEXT NOT NULL,
        from_asset_sha256 TEXT,
        to_asset_sha256 TEXT,
        action TEXT NOT NULL,
        actor TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  prepare(sql) {
    return new Statement(this.raw, sql)
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
}

test("publication wake emits one ordinary dirty-card event and replays idempotently", async () => {
  const db = new D1()
  try {
    db.raw
      .prepare(
        `INSERT INTO icono_manifestation_publication_wakes (
         authority_event_id, authority_event_sequence, gene_id, canonical_symbol
       ) VALUES ('event_0001', 1, 'gene_tp53', 'TP53')`,
      )
      .run()
    const first = await drainManifestationPublicCardPublicationWakes(db, {
      authorityEventId: "event_0001",
    })
    const replay = await drainManifestationPublicCardPublicationWakes(db, {
      authorityEventId: "event_0001",
    })
    assert.equal(first.published_count, 1)
    assert.equal(replay.published_count, 0)
    assert.deepEqual(
      db.raw
        .prepare("SELECT gene_symbol, action, actor, reason FROM icono_publish_events")
        .all()
        .map((row) => ({ ...row })),
      [
        {
          gene_symbol: "TP53",
          action: "manifestation_canonical_changed",
          actor: "manifestation_authority",
          reason: "event_0001",
        },
      ],
    )
    assert.deepEqual(
      {
        ...db.raw
          .prepare(
            `SELECT status, attempts FROM icono_manifestation_publication_wakes
              WHERE authority_event_id = 'event_0001'`,
          )
          .get(),
      },
      { status: "published", attempts: 1 },
    )
  } finally {
    db.raw.close()
  }
})
