// Reconciles cloudflare/the-only-brinedew-static-edge-policy.json (B-834).
//
// Owner of every Cloudflare setting that lets brinedew.bio and
// geneguessr.brinedew.bio be served by Pages without a Worker per request.
// Never change these settings in the dashboard; edit the policy and run:
//
//   node scripts/reconcile-brinedew-static-edge-policy.mjs --check
//   node scripts/reconcile-brinedew-static-edge-policy.mjs --apply prepare
//   node scripts/reconcile-brinedew-static-edge-policy.mjs --apply cutover
//
// `prepare` is safe while the broad Worker routes still exist (Pages domains,
// DNS targets, redirect rules). `cutover` must run right after the deploy that
// narrows wrangler.toml routes: it adds the GeneGuessr URL rewrites (which
// would confuse the old Worker), deletes retired routes, and turns off Web
// Analytics auto-injection (the page now loads the beacon after consent).
import { readFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"

const POLICY_URL = new URL(
  "../cloudflare/the-only-brinedew-static-edge-policy.json",
  import.meta.url,
)
const API = "https://api.cloudflare.com/client/v4"

export async function loadStaticEdgePolicy() {
  const policy = JSON.parse(await readFile(POLICY_URL, "utf8"))
  if (policy?.schemaVersion !== 1 || !policy.zoneName || !policy.pagesProject) {
    throw new Error("Static edge policy is incomplete or uses an unsupported schema")
  }
  return policy
}

function client({ apiToken, fetchImpl = fetch }) {
  return async function call(path, { method = "GET", body, allowNotFound = false } = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    const payload = text.trim() ? JSON.parse(text) : null
    if (allowNotFound && response.status === 404) return null
    if (!response.ok || payload?.success === false) {
      throw new Error(
        `Cloudflare ${method} ${path} failed (HTTP ${response.status}): ${text.slice(0, 400)}`,
      )
    }
    return payload?.result ?? null
  }
}

export function desiredRedirectRule(rule) {
  const fromValue = rule.targetExpression
    ? { target_url: { expression: rule.targetExpression } }
    : { target_url: { value: rule.targetUrl } }
  return {
    ref: rule.ref,
    description: rule.description,
    expression: rule.expression,
    action: "redirect",
    action_parameters: {
      from_value: { ...fromValue, status_code: rule.statusCode, preserve_query_string: true },
    },
    enabled: true,
  }
}

export function desiredRewriteRule(rule) {
  return {
    ref: rule.ref,
    description: rule.description,
    expression: rule.expression,
    action: "rewrite",
    action_parameters: { uri: { path: { value: rule.path } } },
    enabled: true,
  }
}

// Cloudflare returns rule parameters with its own key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function sameRule(existing, desired) {
  return (
    existing?.expression === desired.expression &&
    existing?.action === desired.action &&
    existing?.enabled !== false &&
    JSON.stringify(canonical(existing?.action_parameters)) ===
      JSON.stringify(canonical(desired.action_parameters))
  )
}

async function reconcilePhase(call, zoneId, phase, name, desiredRules, { apply, log }) {
  const path = `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`
  const existing = await call(path, { allowNotFound: true })
  const current = Array.isArray(existing?.rules) ? existing.rules : []
  const refs = new Set(desiredRules.map((rule) => rule.ref))
  const foreign = current.filter((rule) => !refs.has(rule.ref))
  const drift = desiredRules.filter(
    (rule) =>
      !sameRule(
        current.find((c) => c.ref === rule.ref),
        rule,
      ),
  )
  if (!drift.length) {
    log(`${phase}: current (${desiredRules.length} rule(s))`)
    return 0
  }
  log(`${phase}: ${drift.length} rule(s) to write: ${drift.map((r) => r.ref).join(", ")}`)
  if (!apply) return drift.length
  // Keep any rule this policy does not own; replace only owned refs.
  const rules = [...foreign.map(({ id, version, last_updated, ...rest }) => rest), ...desiredRules]
  if (existing?.id) {
    await call(`/zones/${zoneId}/rulesets/${existing.id}`, {
      method: "PUT",
      body: { name: existing.name || name, kind: "zone", phase, rules },
    })
  } else {
    await call(`/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: { name, kind: "zone", phase, rules },
    })
  }
  log(`${phase}: written`)
  return 0
}

export async function reconcileStaticEdgePolicy({
  apiToken,
  accountId,
  mode = "check",
  stage = "all",
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  if (!apiToken || !accountId)
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required")
  const apply = mode === "apply"
  const doPrepare = stage === "prepare" || stage === "all"
  const doCutover = stage === "cutover" || stage === "all"
  const policy = await loadStaticEdgePolicy()
  const call = client({ apiToken, fetchImpl })
  const zones = await call(`/zones?name=${encodeURIComponent(policy.zoneName)}`)
  const zoneId = (zones || []).find((zone) => zone.name === policy.zoneName)?.id
  if (!zoneId) throw new Error(`Zone ${policy.zoneName} not found`)
  let drift = 0

  if (doPrepare) {
    const domains = await call(
      `/accounts/${accountId}/pages/projects/${policy.pagesProject}/domains`,
    )
    for (const domain of policy.pagesCustomDomains) {
      const found = (domains || []).find((entry) => entry?.name === domain)
      if (found?.status === "active") {
        log(`pages domain ${domain}: active`)
        continue
      }
      drift += 1
      log(`pages domain ${domain}: ${found ? found.status : "missing"}`)
      if (apply && !found) {
        await call(`/accounts/${accountId}/pages/projects/${policy.pagesProject}/domains`, {
          method: "POST",
          body: { name: domain },
        })
        log(`pages domain ${domain}: attached (verification pending)`)
      }
    }

    const records = await call(`/zones/${zoneId}/dns_records?per_page=200`)
    for (const want of policy.dnsCnames) {
      // Mail, NS and TXT records at the same name are left alone.
      const same = (records || []).filter(
        (record) => record.name === want.name && ["A", "AAAA", "CNAME"].includes(record.type),
      )
      const ok =
        same.length === 1 &&
        same[0].type === "CNAME" &&
        same[0].content === want.content &&
        same[0].proxied === want.proxied
      if (ok) {
        log(`dns ${want.name}: CNAME ${want.content}`)
        continue
      }
      drift += 1
      log(
        `dns ${want.name}: ${same.map((r) => `${r.type} ${r.content}`).join(", ") || "none"} -> CNAME ${want.content}`,
      )
      if (!apply) continue
      for (const record of same.filter((r) => ["A", "AAAA", "CNAME"].includes(r.type))) {
        await call(`/zones/${zoneId}/dns_records/${record.id}`, { method: "DELETE" })
      }
      await call(`/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: {
          type: "CNAME",
          name: want.name,
          content: want.content,
          proxied: want.proxied,
          ttl: 1,
        },
      })
      log(`dns ${want.name}: written`)
    }

    drift += await reconcilePhase(
      call,
      zoneId,
      "http_request_dynamic_redirect",
      policy.redirectRulesetName,
      policy.redirectRules.map(desiredRedirectRule),
      { apply, log },
    )
  }

  if (doCutover) {
    // Cutting the Worker routes before Pages serves these hosts would take
    // the sites down. Refuse unless every custom domain is verified.
    const domains = await call(
      `/accounts/${accountId}/pages/projects/${policy.pagesProject}/domains`,
    )
    const inactive = policy.pagesCustomDomains.filter(
      (domain) => (domains || []).find((entry) => entry?.name === domain)?.status !== "active",
    )
    if (apply && inactive.length) {
      throw new Error(`Refusing cutover: Pages domains not active yet: ${inactive.join(", ")}`)
    }
    drift += await reconcilePhase(
      call,
      zoneId,
      "http_request_transform",
      policy.rewriteRulesetName,
      policy.rewriteRules.map(desiredRewriteRule),
      { apply, log },
    )

    const routes = await call(`/zones/${zoneId}/workers/routes`)
    for (const route of routes || []) {
      if (!policy.retiredPublicEdgeRoutes.includes(route.pattern)) continue
      drift += 1
      log(`route ${route.pattern} -> ${route.script}: retired`)
      if (apply) {
        await call(`/zones/${zoneId}/workers/routes/${route.id}`, { method: "DELETE" })
        log(`route ${route.pattern}: deleted`)
      }
    }
    for (const pattern of policy.publicEdgeRoutes) {
      const found = (routes || []).find((route) => route.pattern === pattern)
      if (found?.script === policy.publicEdgeWorker) continue
      drift += 1
      log(`route ${pattern}: missing or wrong script`)
      if (!apply) continue
      if (found) {
        await call(`/zones/${zoneId}/workers/routes/${found.id}`, {
          method: "PUT",
          body: { pattern, script: policy.publicEdgeWorker },
        })
      } else {
        await call(`/zones/${zoneId}/workers/routes`, {
          method: "POST",
          body: { pattern, script: policy.publicEdgeWorker },
        })
      }
      log(`route ${pattern}: written`)
    }

    const sites = await call(`/accounts/${accountId}/rum/site_info/list`)
    const site = (sites || []).find(
      (entry) =>
        entry?.ruleset?.zone_name === policy.webAnalyticsSiteHost ||
        entry?.host === policy.webAnalyticsSiteHost,
    )
    if (site && site.auto_install !== policy.webAnalyticsAutoInstall) {
      drift += 1
      log(`web analytics auto_install ${site.auto_install} -> ${policy.webAnalyticsAutoInstall}`)
      if (apply) {
        await call(`/accounts/${accountId}/rum/site_info/${site.site_tag}`, {
          method: "PUT",
          body: {
            auto_install: policy.webAnalyticsAutoInstall,
            host: site.host || policy.webAnalyticsSiteHost,
            zone_tag: zoneId,
          },
        })
        log("web analytics auto_install: written")
      }
    } else {
      log(`web analytics auto_install: ${site ? site.auto_install : "site not found"}`)
    }
  }

  return { drift: apply ? 0 : drift }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const mode = args.includes("--apply") ? "apply" : "check"
  const stage = args.find((arg) => ["prepare", "cutover", "all"].includes(arg)) || "all"
  const { drift } = await reconcileStaticEdgePolicy({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    mode,
    stage,
  })
  if (mode === "check" && drift) {
    console.error(`${drift} setting(s) differ from the policy`)
    process.exitCode = 1
  }
}
