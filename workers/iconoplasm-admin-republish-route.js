// B-898 (deletion stage, step A): the Actions publisher rewrites the stable
// object of every gene that changed by calling this route in small batches.
// Each gene costs about five subrequests inside the Worker, so one call takes
// at most REPUBLISH_MAX_SYMBOLS genes and stays under the 50-subrequest ceiling.
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json", "publish"])

export const REPUBLISH_MAX_SYMBOLS = 8

export function createIconoplasmAdminRepublishHandlers(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin republish service is missing: ${name}`)
    }
  }
  const { isAdmin, json, publish } = services

  async function republish({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_publication_republish_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    let payload
    try {
      payload = await request.json()
    } catch {
      payload = null
    }
    const symbols = [
      ...new Set(
        (Array.isArray(payload?.symbols) ? payload.symbols : [])
          .map((value) =>
            String(value || "")
              .trim()
              .toUpperCase(),
          )
          .filter((value) => SYMBOL.test(value)),
      ),
    ]
    if (!symbols.length || symbols.length > REPUBLISH_MAX_SYMBOLS) {
      return done(
        "admin_publication_republish_400",
        json({ error: `Provide 1 to ${REPUBLISH_MAX_SYMBOLS} gene symbols` }, 400, NO_STORE),
      )
    }
    const results = []
    for (const symbol of symbols) {
      try {
        results.push({ ok: true, ...(await publish(env, symbol)) })
      } catch (error) {
        results.push({ ok: false, symbol, error: String(error?.message || error).slice(0, 300) })
      }
    }
    const failed = results.filter((result) => !result.ok).length
    return done(
      "admin_publication_republish",
      json({ ok: true, published: results.length - failed, failed, results }, 200, NO_STORE),
    )
  }

  return Object.freeze({ "admin_publication.republish": republish })
}
