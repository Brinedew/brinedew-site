// B-1210: icono_storage_audit_queue accepts only valid closed states and
// refuses contradictory (status, audit_state) combinations at the DB boundary.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)

function makeDb() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  }
  return db
}

test("icono_storage_audit_queue triggers enforce closed vocabulary and status/audit_state invariants", () => {
  const db = makeDb()
  const sha = (c) => c.repeat(64)

  // Valid combinations succeed.
  for (const [i, status, auditState, assetStatus] of [
    [1, "queued", "unknown", ""],
    [2, "retrying", "unknown", "draft"],
    [3, "retrying", "broken", "approved"],
    [4, "completed", "renderable", "approved"],
    [5, "completed", "regionally_divergent", "draft"],
    [6, "completed", "broken", "rejected"],
  ]) {
    db.prepare(
      `INSERT INTO icono_storage_audit_queue (gene_symbol, asset_sha256, status, audit_state, asset_status)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`G${i}`, sha(String(i)), status, auditState, assetStatus)
  }

  // Contradictory combinations and open-text values abort on INSERT.
  for (const [label, status, auditState, assetStatus] of [
    ["completed + unknown", "completed", "unknown", "draft"],
    ["queued + renderable", "queued", "renderable", "draft"],
    ["queued + broken", "queued", "broken", "draft"],
    ["unknown status", "banana", "unknown", "draft"],
    ["unknown audit_state", "completed", "stale", "draft"],
    ["unknown asset_status", "queued", "unknown", "published"],
  ]) {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO icono_storage_audit_queue (gene_symbol, asset_sha256, status, audit_state, asset_status)
             VALUES ('BAD', ?, ?, ?, ?)`,
          )
          .run(sha("f"), status, auditState, assetStatus),
      /INVALID_STORAGE_AUDIT_QUEUE_STATE/,
      label,
    )
  }

  // Contradictory combinations and open-text values abort on UPDATE too.
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE icono_storage_audit_queue SET status = 'completed' WHERE gene_symbol = 'G1'",
        )
        .run(),
    /INVALID_STORAGE_AUDIT_QUEUE_STATE/,
    "UPDATE queued/unknown -> completed/unknown must abort",
  )
  assert.throws(
    () =>
      db
        .prepare("UPDATE icono_storage_audit_queue SET status = 'queued' WHERE gene_symbol = 'G4'")
        .run(),
    /INVALID_STORAGE_AUDIT_QUEUE_STATE/,
    "UPDATE completed/renderable -> queued/renderable must abort",
  )
})
