// Cloudflare refuses `wrangler versions upload` for a Worker whose config
// carries a Durable Object migration that is not applied yet: class lifecycle
// changes only go through `wrangler deploy`. The normal release uploads
// versions, so it asks this script first and switches to `wrangler deploy`
// only when the checked-in migrations are ahead of the deployed script.
//
// Ways this can go wrong, each handled below:
// 1. a new tag in the config is not deployed yet -> pending (use wrangler deploy);
// 2. the deployed tag equals the config's last tag -> not pending;
// 3. the Cloudflare API errors -> throw (fail closed, never guess);
// 4. the script is missing from the account -> throw;
// 5. [[env.staging.migrations]] must not be mistaken for production's list.
import { readFileSync, appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

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

export async function durableObjectMigrationPending({
  toml,
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  const name = scriptName(toml)
  const wanted = lastTopLevelMigrationTag(toml)
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers: { authorization: `Bearer ${apiToken}` } },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    throw new Error(`Cloudflare scripts API failed with HTTP ${response.status}`)
  }
  const script = body.result.find((item) => item.id === name)
  if (!script) throw new Error(`Worker ${name} is not deployed in this account`)
  return {
    name,
    wanted,
    deployed: script.migration_tag || null,
    pending: script.migration_tag !== wanted,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = process.argv[2]
  const result = await durableObjectMigrationPending({
    toml: readFileSync(config, "utf8"),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  })
  console.log(
    `${result.name}: deployed migration tag ${result.deployed ?? "none"}, config ${result.wanted}` +
      (result.pending ? " -> pending, deploying with wrangler deploy" : ""),
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `pending=${result.pending}\n`)
}
