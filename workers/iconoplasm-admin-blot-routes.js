const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })

const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json", "listBacklog", "upload", "republish"])

function assertServices(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin blot service is missing: ${name}`)
    }
  }
}

async function requestPayload(request) {
  if (request.method === "GET" || request.method === "HEAD") return {}
  try {
    const value = await request.json()
    return value && typeof value === "object" ? value : {}
  } catch {
    return null
  }
}

export function createIconoplasmAdminBlotHandlers(services) {
  assertServices(services)
  const { isAdmin, json, listBacklog, upload, republish } = services

  // A newly registered blot changes what the gene's stable object carries, so
  // the gene is republished before the upload answers. A failed republish
  // leaves the stored blot a success; the next publication of the gene picks
  // the blot up.
  async function republishQuietly(env, symbol) {
    try {
      await republish(env, symbol)
      return true
    } catch (error) {
      console.error(
        "Blot upload republish failed:",
        symbol,
        String(error?.message || error).slice(0, 300),
      )
      return false
    }
  }

  async function backlog({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_blots_backlog_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    const payload = await requestPayload(request)
    if (payload === null) {
      return done("admin_blots_backlog_400", json({ error: "Invalid JSON" }, 400, NO_STORE))
    }
    try {
      const result = await listBacklog(env, {
        request,
        payload,
      })
      return done("admin_blots_backlog", json(result, 200, NO_STORE))
    } catch (error) {
      const status = Number(error?.status || 0) || 500
      return done(
        `admin_blots_backlog_${status}`,
        json(
          {
            error: String(error?.message || error || "Blot backlog failed"),
            ...(error?.code ? { code: String(error.code) } : {}),
          },
          status,
          NO_STORE,
        ),
      )
    }
  }

  async function put({ match, request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_blots_upload_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    try {
      const result = await upload(env, {
        request,
        symbol: match?.params?.symbol || "",
      })
      if (result?.changed === true) {
        result.republished = await republishQuietly(env, result.symbol)
      }
      return done("admin_blots_upload", json(result, 200, NO_STORE))
    } catch (error) {
      const status = Number(error?.status || 0) || 500
      return done(
        `admin_blots_upload_${status}`,
        json(
          {
            error: String(error?.message || error || "Blot upload failed"),
            ...(error?.code ? { code: String(error.code) } : {}),
          },
          status,
          NO_STORE,
        ),
      )
    }
  }

  return Object.freeze({
    "admin_blots.backlog": backlog,
    "admin_blots.upload": put,
  })
}
