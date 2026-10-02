const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })

const REQUIRED_FUNCTIONS = Object.freeze([
  "fetchGallery",
  "isAdmin",
  "json",
  "normalizeFilter",
  "normalizeLimit",
  "normalizeMode",
  "normalizePage",
  "normalizeSort",
  "sanitizeText",
])

function assertGalleryServices(services) {
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin gallery service is missing: ${name}`)
    }
  }
}

export function createIconoplasmAdminGalleryHandlers(services) {
  assertGalleryServices(services)
  const {
    fetchGallery,
    isAdmin,
    json,
    normalizeFilter,
    normalizeLimit,
    normalizeMode,
    normalizePage,
    normalizeSort,
    sanitizeText,
  } = services

  async function list({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_gallery_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_gallery_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

    const url = new URL(request.url)
    const gallery = await fetchGallery(env, url, {
      page: normalizePage(url.searchParams.get("page") || "1"),
      limit: normalizeLimit(url.searchParams.get("limit") || "100"),
      filter: normalizeFilter(url.searchParams.get("filter") || "all"),
      sort: normalizeSort(url.searchParams.get("sort") || "name"),
      mode: normalizeMode(url.searchParams.get("mode") || "live"),
      query: String(url.searchParams.get("query") || url.searchParams.get("q") || ""),
    })
    return done(
      "admin_gallery",
      json(
        {
          ok: true,
          page: gallery.page,
          limit: gallery.limit,
          total: gallery.total,
          count: gallery.count,
          mode: gallery.mode,
          rows: gallery.rows,
        },
        200,
        NO_STORE,
      ),
    )
  }

  return Object.freeze({
    "admin_gallery.list": list,
  })
}
