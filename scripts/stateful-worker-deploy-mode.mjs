// A normal release uploads a Worker version with `wrangler versions upload`,
// and a version upload cannot change two things that only `wrangler deploy`
// applies: a Durable Object class migration (Cloudflare refuses the upload),
// and the Cron triggers (a version upload leaves the installed ones alone).
// The Worker matches a scheduled event to its job by the exact trigger string,
// so a toml whose `crons` differ from the installed ones makes every recurring
// job stop without an error. This script is the one place that decides whether
// a release needs `wrangler deploy`: it asks Cloudflare which migration tag and
// which cron schedules are installed and compares both with the checked-in
// config. The deploy workflow also runs it with --verify after the last Worker
// activation, so a deploy that did not install the triggers fails the release.
//
// Ways this can go wrong, each handled below:
// 1. a new tag in the config is not deployed yet -> pending (use wrangler deploy);
// 2. the deployed tag equals the config's last tag -> not pending;
// 3. the Cloudflare API errors -> throw (fail closed, never guess);
// 4. the script is missing from the account -> throw;
// 5. [[env.staging.migrations]] must not be mistaken for production's list;
// 6. the config's crons and the installed schedules differ as sets -> pending;
//    the same strings in another order (the API sorts them) -> not pending;
// 7. an untrustworthy schedules answer (error, no list, a schedule without a
//    cron string) -> throw; an empty installed list is real drift, not an error;
// 8. a config with no top-level crons -> throw, because `wrangler deploy` leaves
//    installed triggers alone then and the drift could never converge;
//    [env.staging.triggers] must not be mistaken for production's list;
// 9. a hung or redirected request -> timeout or throw, never a hang.
import { appendFileSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { parse as parseToml } from "toml"

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"

export function lastTopLevelMigrationTag(toml) {
  const tags = []
  let inTopLevelMigration = false
  for (const line of toml.split(/\r?\n/)) {
    const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/)
    if (header) {
      inTopLevelMigration = header[1].trim() === "migrations"
      continue
    }
    const tag = inTopLevelMigration && line.match(/^\s*tag\s*=\s*"([^"]+)"/)
    if (tag) tags.push(tag[1])
  }
  if (!tags.length) throw new Error("No top-level [[migrations]] tag found in the Worker config")
  return tags.at(-1)
}

export function scriptName(toml) {
  const match = toml.match(/^name\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error("Worker config has no top-level name")
  return match[1]
}

// The production trigger list is the top-level [triggers] table. The staging
// environment's own empty `crons = []` lives under env.staging and is never read.
export function wantedProductionCrons(toml) {
  const crons = parseToml(toml).triggers?.crons
  if (!Array.isArray(crons))
    throw new Error("Worker config has no top-level crons under [triggers]")
  if (crons.some((cron) => typeof cron !== "string" || !cron.trim()))
    throw new Error("Worker config [triggers] crons must all be non-empty strings")
  return crons
}

export function cronDrift({ wanted, installed }) {
  const inToml = new Set(wanted)
  const inCloudflare = new Set(installed)
  const onlyInToml = [...inToml].filter((cron) => !inCloudflare.has(cron)).sort()
  const onlyInstalled = [...inCloudflare].filter((cron) => !inToml.has(cron)).sort()
  return {
    wanted: [...inToml].sort(),
    installed: [...inCloudflare].sort(),
    onlyInToml,
    onlyInstalled,
    drifted: onlyInToml.length > 0 || onlyInstalled.length > 0,
  }
}

function describeCronDrift(name, drift) {
  return (
    `${name} cron triggers differ from the toml. ` +
    `Installed but not in the toml: ${JSON.stringify(drift.onlyInstalled)}. ` +
    `In the toml but not installed: ${JSON.stringify(drift.onlyInToml)}.`
  )
}

async function cloudflareGet(path, what, { apiToken, fetchImpl }) {
  const response = await fetchImpl(`${CLOUDFLARE_API}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json().catch(() => null)
  if (!body)
    throw new Error(`Cloudflare ${what} API returned an unreadable body (HTTP ${response.status})`)
  if (!response.ok || !body.success)
    throw new Error(`Cloudflare ${what} API failed with HTTP ${response.status}`)
  return body.result
}

export async function durableObjectMigrationPending({
  toml,
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  const name = scriptName(toml)
  const wanted = lastTopLevelMigrationTag(toml)
  const scripts = await cloudflareGet(`/accounts/${accountId}/workers/scripts`, "scripts", {
    apiToken,
    fetchImpl,
  })
  if (!Array.isArray(scripts)) throw new Error("Cloudflare scripts API returned no script list")
  const script = scripts.find((item) => item.id === name)
  if (!script) throw new Error(`Worker ${name} is not deployed in this account`)
  return {
    name,
    wanted,
    deployed: script.migration_tag || null,
    pending: script.migration_tag !== wanted,
  }
}

export async function installedCronSchedules({ name, accountId, apiToken, fetchImpl = fetch }) {
  const result = await cloudflareGet(
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/schedules`,
    "schedules",
    { apiToken, fetchImpl },
  )
  const schedules = result?.schedules
  if (
    !Array.isArray(schedules) ||
    schedules.some((item) => typeof item?.cron !== "string" || !item.cron)
  )
    throw new Error("Cloudflare schedules API returned no usable schedules list")
  return schedules.map((item) => item.cron)
}

export async function statefulWorkerDeployMode({ toml, accountId, apiToken, fetchImpl = fetch }) {
  const wantedCrons = wantedProductionCrons(toml)
  const migration = await durableObjectMigrationPending({ toml, accountId, apiToken, fetchImpl })
  const installed = await installedCronSchedules({
    name: migration.name,
    accountId,
    apiToken,
    fetchImpl,
  })
  const drift = cronDrift({ wanted: wantedCrons, installed })
  return {
    name: migration.name,
    wantedTag: migration.wanted,
    deployedTag: migration.deployed,
    migrationPending: migration.pending,
    cronDrift: drift,
    needsWranglerDeploy: migration.pending || drift.drifted,
  }
}

// After the release has deployed, the installed triggers must be the toml's.
export async function assertCronTriggersInstalled({
  toml,
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  const name = scriptName(toml)
  const wanted = wantedProductionCrons(toml)
  const installed = await installedCronSchedules({ name, accountId, apiToken, fetchImpl })
  const drift = cronDrift({ wanted, installed })
  if (drift.drifted) throw new Error(describeCronDrift(name, drift))
  return { name, ...drift }
}

const workflowCommandText = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

async function main() {
  const verify = process.argv[2] === "--verify"
  const config = process.argv[verify ? 3 : 2]
  if (!config)
    throw new Error("Usage: stateful-worker-deploy-mode.mjs [--verify] <wrangler config>")
  const input = {
    toml: readFileSync(config, "utf8"),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  }
  if (verify) {
    const result = await assertCronTriggersInstalled(input)
    console.log(
      `${result.name}: the ${result.installed.length} installed cron triggers match the toml`,
    )
    return
  }
  const mode = await statefulWorkerDeployMode(input)
  console.log(
    `${mode.name}: deployed migration tag ${mode.deployedTag ?? "none"}, config ${mode.wantedTag}` +
      (mode.migrationPending ? " -> Durable Object migration pending" : ""),
  )
  if (mode.cronDrift.drifted) {
    console.log(
      `::warning title=Cron triggers differ from the toml::${workflowCommandText(describeCronDrift(mode.name, mode.cronDrift))}`,
    )
  } else {
    console.log(
      `${mode.name}: the ${mode.cronDrift.installed.length} installed cron triggers match the toml`,
    )
  }
  if (mode.needsWranglerDeploy) console.log(`${mode.name}: deploying with wrangler deploy`)
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `needs_wrangler_deploy=${mode.needsWranglerDeploy}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
