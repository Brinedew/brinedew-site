import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { parse as parseYaml } from "yaml"
import {
  assertCronTriggersInstalled,
  durableObjectMigrationPending,
  lastTopLevelMigrationTag,
  statefulWorkerDeployMode,
  wantedProductionCrons,
} from "./stateful-worker-deploy-mode.mjs"

const CONFIG = readFileSync(
  new URL(
    "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    import.meta.url,
  ),
  "utf8",
)
const api =
  (result, ok = true) =>
  async () => ({
    ok,
    status: ok ? 200 : 403,
    json: async () => ({ success: ok, result }),
  })

// B-922: a normal push uploads a Worker version, and a version upload never
// changes cron triggers, so a toml `crons` edit shipped that way leaves
// production on the old trigger strings. The Worker matches triggers by exact
// string, so every recurring job then stops without an error. These are the
// ways the release check could fail, written before the code that handles them:
// 1. the toml adds, removes or moves a minute and the installed list lacks it
//    -> the release needs `wrangler deploy`;
// 2. the same strings in another order (the API returns them sorted, the toml
//    does not) -> no drift, or every release would run a full deploy forever;
// 3. the installed list is empty while the toml's is not -> drift (a legitimate
//    state after containment), not an error;
// 4. the API errors, answers `success: false`, or returns a body without a
//    `result.schedules` array of `{cron: string}` -> throw, never guess "fine";
// 5. the toml declares no top-level `crons` -> throw: `wrangler deploy` leaves
//    installed triggers alone in that case, so the drift could never converge;
// 6. the staging environment's empty `crons = []` must never be read as
//    production's list;
// 7. a hung or redirected call must not hang or leak the token elsewhere;
// 8. a pending Durable Object tag with matching triggers, and matching
//    triggers with no pending tag, both stay correct (the old behavior);
// 9. after the release deploys, the installed triggers are read again and any
//    difference fails the release, in the normal and the maintenance path.
const SCHEDULES = (crons) => ({ schedules: crons.map((cron) => ({ cron, created_on: "t" })) })
const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
// Routes by exact URL path. Anything else is a test bug: nothing may reach the
// real Cloudflare API from a test.
function fakeCloudflare({ name = "w", tag = "v1", crons, scheduleResponse } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, init })
    if (path === "/client/v4/accounts/acct/workers/scripts")
      return json(200, { success: true, result: [{ id: name, migration_tag: tag }] })
    if (path === `/client/v4/accounts/acct/workers/scripts/${name}/schedules`)
      return scheduleResponse ?? json(200, { success: true, result: SCHEDULES(crons ?? []) })
    throw new Error(`unexpected Cloudflare request: ${path}`)
  }
  return { fetchImpl, calls }
}
const tomlWith = (crons, extra = "") =>
  `name = "w"
[[migrations]]
tag = "v1"
[triggers]
crons = ${JSON.stringify(crons)}
${extra}`
const deployMode = (toml, cloudflare) =>
  statefulWorkerDeployMode({
    toml,
    accountId: "acct",
    apiToken: "t",
    fetchImpl: cloudflare.fetchImpl,
  })

test("the production migration list is read, not staging's", () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v1"\n[[env.staging.migrations]]\ntag = "v9"\n`
  assert.equal(lastTopLevelMigrationTag(toml), "v1")
  assert.match(lastTopLevelMigrationTag(CONFIG), /^v\d+$/)
})

test("a config tag ahead of the deployed script is pending", async () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v6"\n[[migrations]]\ntag = "v7"\n`
  const pending = await durableObjectMigrationPending({
    toml,
    accountId: "a",
    apiToken: "t",
    fetchImpl: api([{ id: "w", migration_tag: "v6" }]),
  })
  assert.equal(pending.pending, true)
  const current = await durableObjectMigrationPending({
    toml,
    accountId: "a",
    apiToken: "t",
    fetchImpl: api([{ id: "w", migration_tag: "v7" }]),
  })
  assert.equal(current.pending, false)
})

test("API errors and a missing script fail closed", async () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v1"\n`
  await assert.rejects(
    durableObjectMigrationPending({
      toml,
      accountId: "a",
      apiToken: "t",
      fetchImpl: api(null, false),
    }),
    /HTTP 403/,
  )
  await assert.rejects(
    durableObjectMigrationPending({
      toml,
      accountId: "a",
      apiToken: "t",
      fetchImpl: api([{ id: "x" }]),
    }),
    /not deployed/,
  )
})

// B-898 Stage 3 failure modes for a release that deletes a Durable Object class.
// 1. The toml deletes a class that a binding still names, or that the Worker
//    module still exports: Cloudflare refuses the deploy and the whole release
//    stops after the build.
// 2. The deletion is in the toml's staging list but not production's (or the
//    reverse), so one environment keeps a class the other has dropped.
// 3. The deletion is not the last top-level tag, so the release detector reads
//    an older tag and ships the code with `versions upload`, which Cloudflare
//    refuses for an unapplied migration.
function tomlBlocks(toml, header) {
  const blocks = []
  let current = null
  for (const line of toml.split(/\r?\n/)) {
    const match = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/)
    if (match) {
      current = match[1].trim() === header ? [] : null
      if (current) blocks.push(current)
    } else if (current) current.push(line)
  }
  return blocks.map((lines) => lines.join("\n"))
}

const deletedClasses = (toml, header) =>
  tomlBlocks(toml, header).flatMap((block) => {
    const match = block.match(/deleted_classes\s*=\s*\[([^\]]*)\]/)
    return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : []
  })

function workerSourceFiles() {
  const root = new URL("../workers/", import.meta.url)
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
    .map((name) => [name, readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8")])
}

test("every deleted Durable Object class is unbound and unexported, in production and in staging", () => {
  const production = deletedClasses(CONFIG, "migrations")
  const staging = deletedClasses(CONFIG, "env.staging.migrations")
  assert.deepEqual(staging, production, "staging deletes exactly what production deletes")
  assert.ok(production.includes("IconoplasmVoteCoordinator"), "the vote coordinator is deleted")
  const bound = [
    ...tomlBlocks(CONFIG, "durable_objects.bindings"),
    ...tomlBlocks(CONFIG, "env.staging.durable_objects.bindings"),
  ].map((block) => block.match(/class_name\s*=\s*"([^"]+)"/)?.[1])
  const sources = workerSourceFiles()
  for (const name of production) {
    assert.ok(!bound.includes(name), `${name} is still bound`)
    const exportPattern = new RegExp(
      `export\s+class\s+${name}\b|export\s*\{[^}]*\b${name}\b[^}]*\}`,
    )
    for (const [file, source] of sources)
      assert.doesNotMatch(source, exportPattern, `${file} still exports ${name}`)
  }
})

test("the last top-level migration deletes the vote coordinator, so the release runs wrangler deploy", () => {
  assert.equal(lastTopLevelMigrationTag(CONFIG), "v9")
  const last = tomlBlocks(CONFIG, "migrations").at(-1)
  assert.match(last, /tag\s*=\s*"v9"/)
  assert.match(last, /deleted_classes\s*=\s*\["IconoplasmVoteCoordinator"\]/)
  const stagingLast = tomlBlocks(CONFIG, "env.staging.migrations").at(-1)
  assert.match(stagingLast, /deleted_classes\s*=\s*\["IconoplasmVoteCoordinator"\]/)
})

// B-922 failure modes 1 to 9 (see the list above the fakes).
test("a minute the toml adds and the installed trigger lacks needs wrangler deploy, and says which strings differ", async () => {
  const toml = tomlWith(["0,1,2 * * * *", "56,58,59 23 * * *"])
  const mode = await deployMode(
    toml,
    fakeCloudflare({ crons: ["0,2 * * * *", "56,58,59 23 * * *"] }),
  )
  assert.equal(mode.migrationPending, false)
  assert.equal(mode.cronDrift.drifted, true)
  assert.deepEqual(mode.cronDrift.onlyInToml, ["0,1,2 * * * *"])
  assert.deepEqual(mode.cronDrift.onlyInstalled, ["0,2 * * * *"])
  assert.equal(mode.needsWranglerDeploy, true)
})

test("the same trigger strings in another order are not drift", async () => {
  const toml = tomlWith(["6 12 * * *", "0,1,2 * * * *", "56,58,59 23 * * *"])
  const mode = await deployMode(
    toml,
    fakeCloudflare({ crons: ["0,1,2 * * * *", "56,58,59 23 * * *", "6 12 * * *"] }),
  )
  assert.equal(mode.cronDrift.drifted, false)
  assert.equal(mode.needsWranglerDeploy, false)
})

test("an installed trigger the toml no longer lists is drift too", async () => {
  const mode = await deployMode(
    tomlWith(["0 * * * *"]),
    fakeCloudflare({ crons: ["0 * * * *", "17 * * * *"] }),
  )
  assert.deepEqual(mode.cronDrift.onlyInstalled, ["17 * * * *"])
  assert.equal(mode.needsWranglerDeploy, true)
})

test("an empty installed list is drift to repair, not an error", async () => {
  const mode = await deployMode(tomlWith(["0 * * * *"]), fakeCloudflare({ crons: [] }))
  assert.equal(mode.cronDrift.drifted, true)
  assert.equal(mode.needsWranglerDeploy, true)
})

test("a pending Durable Object tag still needs wrangler deploy when the triggers match, and neither needs nothing", async () => {
  const toml = `${tomlWith(["0 * * * *"])}[[migrations]]\ntag = "v2"\n`
  const pending = await deployMode(toml, fakeCloudflare({ tag: "v1", crons: ["0 * * * *"] }))
  assert.equal(pending.migrationPending, true)
  assert.equal(pending.cronDrift.drifted, false)
  assert.equal(pending.needsWranglerDeploy, true)
  const idle = await deployMode(toml, fakeCloudflare({ tag: "v2", crons: ["0 * * * *"] }))
  assert.equal(idle.needsWranglerDeploy, false)
})

test("a schedules response that cannot be trusted fails closed", async () => {
  const toml = tomlWith(["0 * * * *"])
  const bad = {
    "HTTP 403": json(403, { success: false, errors: [{ code: 10000 }] }),
    "HTTP 404": json(404, { success: false }),
    "success false": json(200, { success: false, result: SCHEDULES(["0 * * * *"]) }),
    "no result": json(200, { success: true }),
    "no schedules": json(200, { success: true, result: {} }),
    "schedules not an array": json(200, { success: true, result: { schedules: "0 * * * *" } }),
    "schedule without a cron string": json(200, {
      success: true,
      result: { schedules: [{ cron: "0 * * * *" }, { created_on: "t" }] },
    }),
    "not JSON": { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("x")) },
  }
  for (const [name, scheduleResponse] of Object.entries(bad)) {
    await assert.rejects(
      deployMode(toml, fakeCloudflare({ scheduleResponse })),
      /Cloudflare schedules API/,
      name,
    )
  }
})

test("a toml with no usable top-level crons throws, and staging's empty list is never production's", async () => {
  assert.throws(
    () => wantedProductionCrons(`name = "w"\n[env.staging.triggers]\ncrons = []\n`),
    /no top-level crons/,
  )
  assert.throws(() => wantedProductionCrons(`name = "w"\n[triggers]\ncrons = [1]\n`), /crons/)
  assert.throws(() => wantedProductionCrons(`name = "w"\n[triggers]\ncrons = ["", "x"]\n`), /crons/)
  const toml = tomlWith(["1 * * * *"], `[env.staging.triggers]\ncrons = []\n`)
  assert.deepEqual(wantedProductionCrons(toml), ["1 * * * *"])
  const mode = await deployMode(toml, fakeCloudflare({ crons: [] }))
  assert.deepEqual(mode.cronDrift.onlyInToml, ["1 * * * *"])
  // A toml that reaches wrangler with `crons = []` really does clear the
  // installed triggers, so that one is a legitimate declared state.
  assert.deepEqual(wantedProductionCrons(tomlWith([])), [])
})

test("both Cloudflare reads are bounded, authenticated, address the script by name and refuse redirects", async () => {
  const cloudflare = fakeCloudflare({ crons: ["0 * * * *"] })
  await deployMode(tomlWith(["0 * * * *"]), cloudflare)
  assert.deepEqual(
    cloudflare.calls.map((call) => call.path),
    [
      "/client/v4/accounts/acct/workers/scripts",
      "/client/v4/accounts/acct/workers/scripts/w/schedules",
    ],
  )
  for (const { init } of cloudflare.calls) {
    assert.equal(init.headers.authorization, "Bearer t")
    assert.equal(init.redirect, "error")
    assert.ok(init.signal instanceof AbortSignal, "a hung call must time out")
  }
})

test("verification after the release passes on matching triggers and names every difference otherwise", async () => {
  const toml = tomlWith(["0,1 * * * *", "56,58,59 23 * * *"])
  await assertCronTriggersInstalled({
    toml,
    accountId: "acct",
    apiToken: "t",
    fetchImpl: fakeCloudflare({ crons: ["56,58,59 23 * * *", "0,1 * * * *"] }).fetchImpl,
  })
  await assert.rejects(
    assertCronTriggersInstalled({
      toml,
      accountId: "acct",
      apiToken: "t",
      fetchImpl: fakeCloudflare({ crons: ["55 23 * * *", "56,58,59 23 * * *"] }).fetchImpl,
    }),
    (error) => error.message.includes("0,1 * * * *") && error.message.includes("55 23 * * *"),
  )
})

test("the checked-in config's own triggers: any order is no drift, one missing string is drift", async () => {
  const wanted = wantedProductionCrons(CONFIG)
  assert.ok(wanted.length >= 2, "the production config declares its triggers")
  const tag = lastTopLevelMigrationTag(CONFIG)
  const same = await deployMode(
    CONFIG,
    fakeCloudflare({ name: "geneguessr-api", tag, crons: [...wanted].reverse() }),
  )
  assert.equal(same.needsWranglerDeploy, false)
  const missing = await deployMode(
    CONFIG,
    fakeCloudflare({ name: "geneguessr-api", tag, crons: wanted.slice(1) }),
  )
  assert.deepEqual(missing.cronDrift.onlyInToml, [wanted[0]])
  assert.equal(missing.needsWranglerDeploy, true)
})

// The wiring: the release must ask before it uploads, branch on the answer,
// and read the installed triggers again after the last Worker activation, in
// the maintenance path as well as the normal one.
const WORKFLOW = parseYaml(
  readFileSync(new URL("../.github/workflows/deploy-quartz.yml", import.meta.url), "utf8"),
)
const STEPS = WORKFLOW.jobs["deploy-production"].steps
const STATEFUL_CONFIG = "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"

test("the release asks the deploy-mode script before uploading and branches on its answer", () => {
  const detect = STEPS.findIndex((step) => step.id === "deploy_mode")
  assert.ok(detect >= 0, "a step with id deploy_mode exists")
  assert.equal(STEPS[detect].if, "inputs.data_maintenance != true")
  assert.ok(
    STEPS[detect].run.includes(`node scripts/stateful-worker-deploy-mode.mjs ${STATEFUL_CONFIG}`),
  )
  assert.ok(STEPS[detect]["timeout-minutes"] <= 5, "the check has its own deadline")
  const deploy = STEPS.findIndex((step) => step.name === "Deploy the compatible stateful Worker")
  assert.ok(detect < deploy, "the check runs before the upload")
  assert.match(
    STEPS[deploy].run,
    /steps\.deploy_mode\.outputs\.needs_wrangler_deploy \}\}" = "true"/,
  )
  assert.match(STEPS[deploy].run, /wrangler deploy --env=""/)
  assert.match(STEPS[deploy].run, /wrangler versions upload --env=""/)
})

test("the installed triggers are verified after the last stateful Worker activation, in both release paths", () => {
  const verify = STEPS.findIndex((step) =>
    step.run?.includes("stateful-worker-deploy-mode.mjs --verify"),
  )
  assert.ok(verify >= 0, "a verification step exists")
  assert.ok(STEPS[verify].run.includes(`--verify ${STATEFUL_CONFIG}`))
  assert.equal(STEPS[verify].if, "steps.migrations.outputs.continuation_required != 'true'")
  assert.ok(STEPS[verify]["timeout-minutes"] <= 5)
  const activations = STEPS.flatMap((step, index) =>
    step.run?.includes(STATEFUL_CONFIG) && /wrangler (deploy|versions deploy)\b/.test(step.run)
      ? [index]
      : [],
  )
  assert.ok(activations.length >= 3, "the normal and maintenance activations were found")
  assert.ok(
    verify > Math.max(...activations),
    "verification runs after every stateful deploy, or it would read stale triggers",
  )
})
