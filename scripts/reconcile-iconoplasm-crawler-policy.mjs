import { readFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"

const POLICY_URL = new URL("../cloudflare/iconoplasm-crawler-policy.json", import.meta.url)
const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4"

export async function loadIconoplasmCrawlerPolicy() {
  const policy = JSON.parse(await readFile(POLICY_URL, "utf8"))
  if (
    policy?.schemaVersion !== 1 ||
    !policy?.zoneName ||
    !policy?.hostname ||
    !policy?.ruleRef ||
    !policy?.ruleDescription ||
    !policy?.expression ||
    policy?.action !== "block"
  ) {
    throw new Error("Iconoplasm crawler policy is incomplete or uses an unsupported schema")
  }
  return policy
}

function responseDiagnostic(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

async function callCloudflare(
  apiToken,
  path,
  { method = "GET", body = undefined, allowNotFound = false, fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(`${CLOUDFLARE_API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  })
  const responseBody = await response.text()
  let payload = null
  if (responseBody.trim()) {
    try {
      payload = JSON.parse(responseBody)
    } catch (error) {
      throw new Error(
        `Cloudflare returned invalid JSON for ${method} ${path}: ${responseDiagnostic(responseBody)}`,
        { cause: error },
      )
    }
  }
  if (allowNotFound && response.status === 404) return null
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `Cloudflare API failed for ${method} ${path} (HTTP ${response.status}): ${responseDiagnostic(
        responseBody,
      )}`,
    )
  }
  return payload?.result ?? null
}

function desiredRule(policy) {
  return {
    action: policy.action,
    expression: policy.expression,
    description: policy.ruleDescription,
    enabled: true,
    ref: policy.ruleRef,
  }
}

function ruleMatchesPolicy(rule, policy) {
  const desired = desiredRule(policy)
  return (
    rule?.action === desired.action &&
    rule?.expression === desired.expression &&
    rule?.description === desired.description &&
    rule?.enabled !== false &&
    rule?.ref === desired.ref
  )
}

export async function reconcileIconoplasmCrawlerPolicy({
  apiToken,
  zoneName,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required")
  const policy = await loadIconoplasmCrawlerPolicy()
  const requestedZone = String(zoneName || policy.zoneName).trim()
  if (requestedZone !== policy.zoneName) {
    throw new Error(
      `Crawler policy is scoped to ${policy.zoneName}; refusing to apply it to ${requestedZone}`,
    )
  }

  const zones = await callCloudflare(apiToken, `/zones?name=${encodeURIComponent(requestedZone)}`, {
    fetchImpl,
  })
  const exactZones = (Array.isArray(zones) ? zones : []).filter(
    (zone) => String(zone?.name || "") === requestedZone,
  )
  if (exactZones.length !== 1 || !exactZones[0]?.id) {
    throw new Error(`Expected exactly one Cloudflare zone named ${requestedZone}`)
  }
  const zoneId = exactZones[0].id
  const entrypointPath = `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`
  const ruleset = await callCloudflare(apiToken, entrypointPath, {
    allowNotFound: true,
    fetchImpl,
  })

  if (!ruleset) {
    const created = await callCloudflare(apiToken, `/zones/${zoneId}/rulesets`, {
      method: "POST",
      fetchImpl,
      body: {
        name: policy.rulesetName,
        description: "Project-owned Cloudflare firewall policy reconciled during production deploy",
        kind: "zone",
        phase: "http_request_firewall_custom",
        rules: [desiredRule(policy)],
      },
    })
    logger.log(`Created ${policy.ruleRef} in ruleset ${created?.id || policy.rulesetName}`)
    return { outcome: "created_ruleset", zoneId, rulesetId: created?.id || null }
  }

  const existingRule = (Array.isArray(ruleset.rules) ? ruleset.rules : []).find(
    (rule) => rule?.ref === policy.ruleRef,
  )
  if (existingRule && ruleMatchesPolicy(existingRule, policy)) {
    logger.log(`Crawler policy already current: ${policy.ruleRef}`)
    return {
      outcome: "unchanged",
      zoneId,
      rulesetId: ruleset.id,
      ruleId: existingRule.id || null,
    }
  }

  if (existingRule?.id) {
    const updated = await callCloudflare(
      apiToken,
      `/zones/${zoneId}/rulesets/${ruleset.id}/rules/${existingRule.id}`,
      {
        method: "PATCH",
        fetchImpl,
        body: desiredRule(policy),
      },
    )
    logger.log(`Updated crawler policy rule ${policy.ruleRef}`)
    return {
      outcome: "updated_rule",
      zoneId,
      rulesetId: ruleset.id,
      ruleId: updated?.id || existingRule.id,
    }
  }

  const added = await callCloudflare(apiToken, `/zones/${zoneId}/rulesets/${ruleset.id}/rules`, {
    method: "POST",
    fetchImpl,
    body: desiredRule(policy),
  })
  logger.log(`Added crawler policy rule ${policy.ruleRef}`)
  return {
    outcome: "added_rule",
    zoneId,
    rulesetId: ruleset.id,
    ruleId: added?.id || null,
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  await reconcileIconoplasmCrawlerPolicy({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    zoneName: process.argv[2],
  })
}
