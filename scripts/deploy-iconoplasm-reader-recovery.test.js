import assert from "node:assert/strict"
import test from "node:test"
import {
  assertUnchangedReaderRecovery,
  deployReaderRecovery,
  isTransientDeploymentFailure,
} from "./deploy-iconoplasm-reader-recovery.mjs"

const state = { schema_transition: true, reader_recovery: true, origin_run_id: "34332384203" }

test("reader recovery retries only a transient deploy failure after provider state proves unchanged", async () => {
  let calls = 0
  const result = await deployReaderRecovery({
    wranglerArgs: ["--config", "reader.toml"],
    execute: async () => {
      calls += 1
      if (calls === 1) {
        const error = new Error("wrangler deploy exited 1")
        error.stderr = "POST /deployments -> 503 upstream connect error"
        throw error
      }
      return { stdout: "deployed", stderr: "" }
    },
    readState: async () => state,
    readDeployment: async () => ({ id: "unchanged", created_on: "2026-09-09T12:40:24Z" }),
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, { attempts: 2, deployment_before: "unchanged" })
})

test("reader recovery fails closed when a failed deploy leaves an ambiguous active deployment", async () => {
  let deployments = 0
  await assert.rejects(
    deployReaderRecovery({
      wranglerArgs: [],
      execute: async () => {
        const error = new Error("wrangler deploy exited 1")
        error.stderr = "HTTP 503 connection termination"
        throw error
      },
      readState: async () => state,
      readDeployment: async () => ({ id: deployments++ ? "new" : "old", created_on: "" }),
      sleep: async () => {},
      log: () => {},
    }),
    /COST_READER_RECOVERY_RETRY_DEPLOYMENT_AMBIGUOUS/,
  )
})

test("reader recovery rejects non-transient errors and origin changes", async () => {
  assert.equal(isTransientDeploymentFailure(new Error("HTTP 503 upstream connect error")), true)
  assert.equal(isTransientDeploymentFailure(new Error("HTTP 400 invalid binding")), false)
  assert.throws(
    () =>
      assertUnchangedReaderRecovery({
        before: { id: "same" },
        after: { id: "same" },
        initialState: state,
        currentState: { ...state, origin_run_id: "other" },
      }),
    /COST_READER_RECOVERY_RETRY_ORIGIN_CHANGED/,
  )
})
