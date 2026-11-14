import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  ICONOPLASM_JOB_STATUSES,
  ICONOPLASM_TERMINAL_JOB_STATUSES,
  assertIconoplasmJobTransition,
  assertValidInitialIconoplasmJobStatus,
  canTransitionIconoplasmJobStatus,
  transitionIconoplasmJobToFailed,
  transitionIconoplasmJobToRunning,
  transitionIconoplasmJobToSucceeded,
} from "./iconoplasm-job-state.js"

function d1Wrapper(db) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run() {
              const info = db.prepare(sql).run(...args)
              return { meta: { changes: Number(info?.changes || 0) } }
            },
            first() {
              return db.prepare(sql).get(...args) ?? null
            },
          }
        },
      }
    },
  }
}

function createJobsTestDb() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    readFileSync(
      new URL("../../migrations-iconoplasm/0033_image_edit_jobs.sql", import.meta.url),
      "utf8",
    ),
  )
  db.exec(`CREATE TABLE icono_candidate_generation_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    gene_symbol TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    error TEXT NOT NULL DEFAULT '',
    result_asset_sha256 TEXT NOT NULL DEFAULT '',
    result_r2_key_full TEXT NOT NULL DEFAULT '',
    result_r2_key_medium TEXT NOT NULL DEFAULT '',
    result_r2_key_thumb TEXT NOT NULL DEFAULT '',
    result_mime TEXT NOT NULL DEFAULT '',
    result_width INTEGER,
    result_height INTEGER,
    result_bytes INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    published_at TEXT
  )`)
  return db
}

function insertJob(db, table, id, status) {
  if (table === "icono_image_edit_jobs") {
    db.prepare(
      `INSERT INTO icono_image_edit_jobs (id, user_id, provider_id, source_gene_symbol, source_asset_sha256, status)
       VALUES (?, 'u1', 'comfyui', 'TP53', 'sha-src', ?)`,
    ).run(id, status)
    return
  }
  db.prepare(
    `INSERT INTO icono_candidate_generation_jobs (id, user_id, provider_id, gene_symbol, status)
     VALUES (?, 'u1', 'openai', 'TP53', ?)`,
  ).run(id, status)
}

test("job state machine closes the 4-state vocabulary and refuses moves from terminal states", () => {
  assert.deepEqual(ICONOPLASM_JOB_STATUSES, ["queued", "running", "succeeded", "failed"])
  assert.deepEqual(ICONOPLASM_TERMINAL_JOB_STATUSES, ["succeeded", "failed"])
  assert.equal(assertValidInitialIconoplasmJobStatus("queued"), "queued")
  assert.equal(assertValidInitialIconoplasmJobStatus("running"), "running")
  assert.throws(() => assertValidInitialIconoplasmJobStatus("succeeded"), {
    code: "INVALID_JOB_INITIAL_STATUS",
  })

  // All legal forward moves: queued -> running, queued -> succeeded, queued -> failed, running -> succeeded, running -> failed.
  assert.equal(assertIconoplasmJobTransition("queued", "running"), "running")
  assert.equal(assertIconoplasmJobTransition("queued", "succeeded"), "succeeded")
  assert.equal(assertIconoplasmJobTransition("queued", "failed"), "failed")
  assert.equal(assertIconoplasmJobTransition("running", "succeeded"), "succeeded")
  assert.equal(assertIconoplasmJobTransition("running", "failed"), "failed")

  // Terminal states refuse all further transitions; running -> queued is also illegal.
  for (const terminal of ICONOPLASM_TERMINAL_JOB_STATUSES) {
    for (const next of ICONOPLASM_JOB_STATUSES) {
      assert.equal(canTransitionIconoplasmJobStatus(terminal, next), false)
      assert.throws(() => assertIconoplasmJobTransition(terminal, next), {
        code: "INVALID_JOB_TRANSITION",
      })
    }
  }
  assert.throws(() => assertIconoplasmJobTransition("running", "queued"), {
    code: "INVALID_JOB_TRANSITION",
  })
})

for (const table of ["icono_image_edit_jobs", "icono_candidate_generation_jobs"]) {
  test(`${table}: shared helper executes legal moves and refuses moves out of terminal states`, async () => {
    const rawDb = createJobsTestDb()
    try {
      const db = d1Wrapper(rawDb)
      const succeededRow = (id) => ({
        id,
        result_asset_sha256: "a".repeat(64),
        result_r2_key_full: "full.webp",
        result_r2_key_medium: "med.webp",
        result_r2_key_thumb: "thumb.webp",
        result_mime: "image/webp",
        result_width: 768,
        result_height: 1024,
        result_bytes: 12345,
      })

      // 1 & 2. queued -> running -> succeeded; subsequent -> failed and -> running are refused.
      insertJob(rawDb, table, "job-qrs", "queued")
      const claimed = await transitionIconoplasmJobToRunning(db, table, { id: "job-qrs" })
      assert.deepEqual(claimed, { ok: true, changes: 1 })
      assert.equal(
        rawDb.prepare(`SELECT status FROM ${table} WHERE id = 'job-qrs'`).get().status,
        "running",
      )

      const finished = await transitionIconoplasmJobToSucceeded(db, table, succeededRow("job-qrs"))
      assert.deepEqual(finished, { ok: true, changes: 1 })
      const afterSuccess = rawDb
        .prepare(
          `SELECT status, result_asset_sha256, completed_at FROM ${table} WHERE id = 'job-qrs'`,
        )
        .get()
      assert.equal(afterSuccess.status, "succeeded")
      assert.equal(afterSuccess.result_asset_sha256, "a".repeat(64))
      assert.ok(afterSuccess.completed_at)

      const failFromSucceeded = await transitionIconoplasmJobToFailed(db, table, {
        id: "job-qrs",
        error: "late failure",
      })
      assert.deepEqual(failFromSucceeded, { ok: false, changes: 0 })
      const runFromSucceeded = await transitionIconoplasmJobToRunning(db, table, { id: "job-qrs" })
      assert.deepEqual(runFromSucceeded, { ok: false, changes: 0 })
      assert.equal(
        rawDb.prepare(`SELECT status, error FROM ${table} WHERE id = 'job-qrs'`).get().status,
        "succeeded",
      )

      // 3. queued -> succeeded directly (used by queued free edit fulfillment).
      insertJob(rawDb, table, "job-qs", "queued")
      const directSuccess = await transitionIconoplasmJobToSucceeded(
        db,
        table,
        succeededRow("job-qs"),
      )
      assert.deepEqual(directSuccess, { ok: true, changes: 1 })
      assert.equal(
        rawDb.prepare(`SELECT status FROM ${table} WHERE id = 'job-qs'`).get().status,
        "succeeded",
      )

      // 4. running -> failed; subsequent -> succeeded is refused.
      insertJob(rawDb, table, "job-rf", "running")
      const failed = await transitionIconoplasmJobToFailed(db, table, {
        id: "job-rf",
        error: "boom",
      })
      assert.deepEqual(failed, { ok: true, changes: 1 })
      const retrySuccess = await transitionIconoplasmJobToSucceeded(
        db,
        table,
        succeededRow("job-rf"),
      )
      assert.deepEqual(retrySuccess, { ok: false, changes: 0 })
      const afterFail = rawDb
        .prepare(`SELECT status, error, result_asset_sha256 FROM ${table} WHERE id = 'job-rf'`)
        .get()
      assert.equal(afterFail.status, "failed")
      assert.equal(afterFail.error, "boom")
      assert.equal(afterFail.result_asset_sha256, "")

      // queued -> failed is also legal and locks terminal state.
      insertJob(rawDb, table, "job-qf", "queued")
      assert.deepEqual(
        await transitionIconoplasmJobToFailed(db, table, { id: "job-qf", error: "rejected" }),
        { ok: true, changes: 1 },
      )
      assert.deepEqual(await transitionIconoplasmJobToRunning(db, table, { id: "job-qf" }), {
        ok: false,
        changes: 0,
      })
    } finally {
      rawDb.close()
    }
  })
}
