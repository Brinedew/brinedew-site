const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })

const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json", "listBacklog", "upload"])

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
  const { isAdmin, json, listBacklog, upload } = services

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
