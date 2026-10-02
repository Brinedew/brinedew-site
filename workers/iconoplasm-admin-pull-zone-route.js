// B-898: THE ONLY writer of the Bunny pull zone's settings. The policy lives in
// bunny/the-only-iconoplasm-pull-zone-policy.json; the deploy sends it here
// (scripts/reconcile-iconoplasm-pull-zone.mjs) and this route applies it with
// the Worker's BUNNY_ACCOUNT_API_KEY, which exists nowhere else. Never change
// the pull zone in the Bunny dashboard: the next deploy would not know.
const BUNNY_API = "https://api.bunny.net"
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json"])

const PURGE_PATH = /^[a-z0-9][a-z0-9/_.*-]{0,120}$/
const isInt = (value) => Number.isInteger(value) && value >= 0

function validEdgeRule(rule) {
  return (
    rule &&
    typeof rule === "object" &&
    typeof rule.description === "string" &&
    rule.description.trim().length > 0 &&
    isInt(rule.actionType) &&
    typeof rule.actionParameter1 === "string" &&
    isInt(rule.triggerMatchingType) &&
    Array.isArray(rule.triggers) &&
    rule.triggers.length > 0 &&
    rule.triggers.every(
      (trigger) =>
        trigger &&
        isInt(trigger.type) &&
        isInt(trigger.patternMatchingType) &&
        Array.isArray(trigger.patternMatches) &&
        trigger.patternMatches.length > 0 &&
        trigger.patternMatches.every((pattern) => typeof pattern === "string" && pattern),
    ) &&
    Array.isArray(rule.purgeOnChange) &&
    rule.purgeOnChange.every(
      (path) => typeof path === "string" && PURGE_PATH.test(path) && !path.includes(".."),
    )
  )
}

// The Bunny form of a policy rule. Guid null creates the rule; an existing
// rule (matched by description) keeps its Guid so the call updates it.
function bunnyEdgeRule(rule, guid) {
  return {
    Guid: guid || null,
    ActionType: rule.actionType,
    ActionParameter1: rule.actionParameter1,
    ActionParameter2: "",
    TriggerMatchingType: rule.triggerMatchingType,
    Description: rule.description,
    Enabled: true,
    Triggers: rule.triggers.map((trigger) => ({
      Type: trigger.type,
      PatternMatchingType: trigger.patternMatchingType,
      PatternMatches: trigger.patternMatches,
      Parameter1: "",
    })),
  }
}

function sameEdgeRule(existing, desired) {
  if (!existing) return false
  const triggers = (list) =>
    JSON.stringify(
      (Array.isArray(list) ? list : []).map((trigger) => [
        Number(trigger?.Type),
        Number(trigger?.PatternMatchingType),
        (Array.isArray(trigger?.PatternMatches) ? trigger.PatternMatches : []).map(String),
      ]),
    )
  return (
    Number(existing.ActionType) === desired.ActionType &&
    String(existing.ActionParameter1 ?? "") === desired.ActionParameter1 &&
    Number(existing.TriggerMatchingType) === desired.TriggerMatchingType &&
    existing.Enabled === true &&
    triggers(existing.Triggers) === triggers(desired.Triggers)
  )
}

function validPolicy(value) {
  return (
    value &&
    typeof value === "object" &&
    value.schemaVersion === 1 &&
    typeof value.pullZoneName === "string" &&
    value.pullZoneName.trim() &&
    value.settings &&
    typeof value.settings === "object" &&
    Array.isArray(value.ensureAccessControlOriginHeaderExtensions) &&
    value.ensureAccessControlOriginHeaderExtensions.every(
      (ext) => typeof ext === "string" && /^[a-z0-9]{1,16}$/.test(ext),
    ) &&
    (value.edgeRules === undefined ||
      (Array.isArray(value.edgeRules) && value.edgeRules.every(validEdgeRule)))
  )
}

export function createIconoplasmAdminPullZoneHandlers(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin pull zone service is missing: ${name}`)
    }
  }
  const { isAdmin, json } = services
  const fetchImpl = typeof services.fetchImpl === "function" ? services.fetchImpl : fetch

  async function reconcile({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_publication_pull_zone_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    let policy
    try {
      policy = await request.json()
    } catch {
      policy = null
    }
    if (!validPolicy(policy)) {
      return done(
        "admin_publication_pull_zone_400",
        json({ error: "Body must be the pull zone policy (schemaVersion 1)" }, 400, NO_STORE),
      )
    }
    const accountKey = String(env?.BUNNY_ACCOUNT_API_KEY || "").trim()
    if (!accountKey) {
      return done(
        "admin_publication_pull_zone_503",
        json({ error: "BUNNY_ACCOUNT_API_KEY is not configured" }, 503, NO_STORE),
      )
    }
    const headers = { AccessKey: accountKey, Accept: "application/json" }
    const listed = await fetchImpl(`${BUNNY_API}/pullzone`, { method: "GET", headers })
    if (!listed.ok) {
      await listed.body?.cancel().catch(() => {})
      return done(
        "admin_publication_pull_zone_502",
        json({ error: `Bunny pull zone list failed (${listed.status})` }, 502, NO_STORE),
      )
    }
    const zones = await listed.json().catch(() => [])
    const zone = (Array.isArray(zones) ? zones : []).find(
      (item) => String(item?.Name || "") === policy.pullZoneName.trim(),
    )
    if (!zone) {
      return done(
        "admin_publication_pull_zone_404",
        json({ error: `Pull zone not found: ${policy.pullZoneName}` }, 404, NO_STORE),
      )
    }
    const before = {
      EnableAccessControlOriginHeader: zone.EnableAccessControlOriginHeader === true,
      AccessControlOriginHeaderExtensions: Array.isArray(zone.AccessControlOriginHeaderExtensions)
        ? zone.AccessControlOriginHeaderExtensions.map(String)
        : [],
    }
    const extensions = [...before.AccessControlOriginHeaderExtensions]
    for (const ext of policy.ensureAccessControlOriginHeaderExtensions) {
      if (!extensions.includes(ext)) extensions.push(ext)
    }
    const after = {
      ...before,
      ...policy.settings,
      AccessControlOriginHeaderExtensions: extensions,
    }
    const changed = JSON.stringify(after) !== JSON.stringify(before)
    if (changed) {
      const updated = await fetchImpl(`${BUNNY_API}/pullzone/${Number(zone.Id)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(after),
      })
      await updated.body?.cancel().catch(() => {})
      if (!updated.ok) {
        return done(
          "admin_publication_pull_zone_502",
          json(
            { error: `Bunny pull zone update failed (${updated.status})`, before, after },
            502,
            NO_STORE,
          ),
        )
      }
    }
    // Edge rules: each policy rule is created or updated by description, and a
    // rule that changed purges the paths it covers once, because copies cached
    // before the change keep the expiry they were cached with.
    const edgeRules = []
    const existingRules = Array.isArray(zone.EdgeRules) ? zone.EdgeRules : []
    for (const rule of Array.isArray(policy.edgeRules) ? policy.edgeRules : []) {
      const existing = existingRules.find(
        (item) => String(item?.Description || "") === rule.description,
      )
      const desired = bunnyEdgeRule(rule, existing?.Guid)
      if (sameEdgeRule(existing, desired)) {
        edgeRules.push({ description: rule.description, changed: false, purged: [] })
        continue
      }
      const written = await fetchImpl(
        `${BUNNY_API}/pullzone/${Number(zone.Id)}/edgerules/addOrUpdate`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(desired),
        },
      )
      await written.body?.cancel().catch(() => {})
      if (!written.ok) {
        return done(
          "admin_publication_pull_zone_502",
          json(
            { error: `Bunny edge rule update failed (${written.status})`, rule: rule.description },
            502,
            NO_STORE,
          ),
        )
      }
      const purged = []
      for (const path of rule.purgeOnChange) {
        const url = `https://${policy.pullZoneName.trim()}.b-cdn.net/${path}`
        const purge = await fetchImpl(
          `${BUNNY_API}/purge?url=${encodeURIComponent(url)}&async=false`,
          { method: "POST", headers },
        )
        await purge.body?.cancel().catch(() => {})
        if (!purge.ok) {
          return done(
            "admin_publication_pull_zone_502",
            json({ error: `Bunny purge failed (${purge.status})`, url }, 502, NO_STORE),
          )
        }
        purged.push(url)
      }
      edgeRules.push({ description: rule.description, changed: true, purged })
    }
    return done(
      "admin_publication_pull_zone",
      json(
        { ok: true, pull_zone_id: Number(zone.Id), changed, before, after, edge_rules: edgeRules },
        200,
        NO_STORE,
      ),
    )
  }

  return Object.freeze({ "admin_publication.pull_zone_reconcile": reconcile })
}
