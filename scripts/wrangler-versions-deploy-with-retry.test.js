import assert from "node:assert/strict"
import test from "node:test"
import {
  deployVersionWithRetry,
  isTransientVersionDeployError,
  runCommandCapture,
} from "./wrangler-versions-deploy-with-retry.mjs"

test("recognizes Cloudflare Workers read-after-write version lookup lag errors", () => {
  assert.equal(
    isTransientVersionDeployError(
      '✘ [ERROR] No deployable version found with tag "edge-abc-123-1".',
    ),
    true,
  )
  assert.equal(
    isTransientVersionDeployError(
      "The requested Worker version could not be found, please check the ID being passed and try again. [code: 100146]",
    ),
    true,
  )
  assert.equal(isTransientVersionDeployError("✘ [ERROR] Authentication error [code: 10000]"), false)
})

test("succeeds immediately without sleeping when the first attempt returns zero", async () => {
  const sleeps = []
  let calls = 0
  const status = await deployVersionWithRetry(["pnpm", "exec", "wrangler", "versions", "deploy"], {
    retryDelaysMs: [100, 200],
    runAttempt: async () => {
      calls += 1
      return { status: 0, output: "Deployed" }
    },
    sleepImpl: async (ms) => sleeps.push(ms),
    logError: () => {},
  })
  assert.equal(status, 0)
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test("retries tag-lookup and 100146 version-lookup misses until deploy succeeds", async () => {
  const sleeps = []
  const responses = [
    { status: 1, output: 'No deployable version found with tag "edge-sha-1-1".' },
    {
      status: 1,
      output: "The requested Worker version could not be found [code: 100146]",
    },
    { status: 0, output: "Deployed 100%" },
  ]
  let calls = 0
  const status = await deployVersionWithRetry(["pnpm", "exec", "wrangler", "versions", "deploy"], {
    retryDelaysMs: [30, 50, 80],
    runAttempt: async () => responses[calls++],
    sleepImpl: async (ms) => sleeps.push(ms),
    logError: () => {},
  })
  assert.equal(status, 0)
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [30, 50])
})

test("does not retry non-transient wrangler deploy failures", async () => {
  const sleeps = []
  let calls = 0
  const status = await deployVersionWithRetry(["pnpm", "exec", "wrangler", "versions", "deploy"], {
    retryDelaysMs: [30, 50],
    runAttempt: async () => {
      calls += 1
      return { status: 7, output: "✘ [ERROR] Authentication error [code: 10000]" }
    },
    sleepImpl: async (ms) => sleeps.push(ms),
    logError: () => {},
  })
  assert.equal(status, 7)
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test("returns non-zero exit code after exhausting retry budget", async () => {
  const sleeps = []
  let calls = 0
  const status = await deployVersionWithRetry(["pnpm", "exec", "wrangler", "versions", "deploy"], {
    retryDelaysMs: [10, 20],
    runAttempt: async () => {
      calls += 1
      return { status: 1, output: "No deployable version found with tag" }
    },
    sleepImpl: async (ms) => sleeps.push(ms),
    logError: () => {},
  })
  assert.equal(status, 1)
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [10, 20])
})

test("runCommandCapture retries a real node subprocess across attempts", async () => {
  const sleeps = []
  let calls = 0
  const script =
    "const fs = require('node:fs'); const flag = process.argv[1]; " +
    "if (!fs.existsSync(flag)) { fs.writeFileSync(flag, '1'); console.error('The requested Worker version could not be found [code: 100146]'); process.exit(1); } " +
    "fs.unlinkSync(flag); console.log('Version deployed');"
  const flagPath = `${process.env.TEMP || "/tmp"}/wrangler-deploy-retry-flag-${process.pid}.txt`
  const status = await deployVersionWithRetry([process.execPath, "-e", script, flagPath], {
    retryDelaysMs: [5, 5],
    runAttempt: (args) => {
      calls += 1
      return runCommandCapture(args[0], args.slice(1))
    },
    sleepImpl: async (ms) => sleeps.push(ms),
    logError: () => {},
  })
  assert.equal(status, 0)
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [5])
})
