// B-898: THE ONLY writer of the Bunny pull zone's settings. The policy lives in
// bunny/the-only-iconoplasm-pull-zone-policy.json; the deploy sends it here
// (scripts/reconcile-iconoplasm-pull-zone.mjs) and this route applies it with
// the Worker's BUNNY_ACCOUNT_API_KEY, which exists nowhere else. Never change
// the pull zone in the Bunny dashboard: the next deploy would not know.
const BUNNY_API = "https://api.bunny.net"
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json"])

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
    )
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
    return done(
      "admin_publication_pull_zone",
      json({ ok: true, pull_zone_id: Number(zone.Id), changed, before, after }, 200, NO_STORE),
    )
  }

  return Object.freeze({ "admin_publication.pull_zone_reconcile": reconcile })
}
