import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"
import { assertCurrentProductionHead } from "./lib/production-head-gate.mjs"

const headSha = "a".repeat(40)
const options = { repository: "Brinedew/brinedew-site", headSha, token: "fixture-token" }
const ref = (sha) => ({ ref: "refs/heads/main", object: { type: "commit", sha } })

test("a delayed old push cannot deploy after main has advanced", async () => {
  const fetchImpl = async (url, request) => {
    assert.equal(url, "https://api.github.com/repos/Brinedew/brinedew-site/git/ref/heads/main")
    assert.ok(request.signal)
    return Response.json(ref(headSha))
  }
  assert.equal(await assertCurrentProductionHead({ ...options, fetchImpl }), headSha)
  await assert.rejects(
    assertCurrentProductionHead({ ...options, headSha: "b".repeat(40), fetchImpl }),
    /Stale production run refused/,
  )
})

test("unverifiable source stops release admission", async () => {
  for (const response of [new Response(null, { status: 403 }), Response.json({})]) {
    await assert.rejects(
      assertCurrentProductionHead({ ...options, fetchImpl: async () => response }),
    )
  }
})

test("a queued release cannot interrupt Worker and Pages activation", () => {
  const workflow = parse(
    readFileSync(new URL("../.github/workflows/deploy-quartz.yml", import.meta.url), "utf8"),
  )
  assert.equal(workflow.concurrency.group, "production-deploy")
  assert.equal(workflow.concurrency["cancel-in-progress"], false)
  const steps = workflow.jobs["deploy-production"].steps
  assert.equal(steps[1].run, "node scripts/assert-production-head.mjs")
  assert.equal(steps[1].env.GITHUB_TOKEN, "${{ github.token }}")
})
