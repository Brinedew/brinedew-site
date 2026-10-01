// B-898 Stage 1: THE ONLY catalog upload path. The home, gallery and search
// pages read one stable object, `catalog/v3/index.json`, from the free CDN.
// Building it means reading all 19k genes, which is more CPU than a free-plan
// Worker request gets (10 ms), so a GitHub Actions script builds it and hands
// the bytes to this route. The Worker holds the Bunny storage password and the
// account key for the purge; the runner holds neither. Streams nothing through
// the CPU but the bytes themselves: no hashing, no JSON parse of the body.
import {
  STABLE_CATALOG_OBJECT_KEY,
  STABLE_CATALOG_OBJECT_LIMIT,
  STABLE_GENE_OBJECT_CACHE_CONTROL,
} from "./lib/iconoplasm-published-card-objects.js"

export { STABLE_CATALOG_OBJECT_KEY, STABLE_CATALOG_OBJECT_LIMIT }

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json", "putObject", "purgeObject"])

export function createIconoplasmAdminCatalogObjectHandlers(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin catalog object service is missing: ${name}`)
    }
  }
  const { isAdmin, json, putObject, purgeObject } = services

  async function put({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done(
        "admin_publication_catalog_object_403",
        json({ error: "Unauthorized" }, 403, NO_STORE),
      )
    }
    const declared = Number(request.headers.get("content-length") || 0)
    if (declared > STABLE_CATALOG_OBJECT_LIMIT) {
      return done(
        "admin_publication_catalog_object_413",
        json({ error: "Catalog object exceeds its byte limit" }, 413, NO_STORE),
      )
    }
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength > STABLE_CATALOG_OBJECT_LIMIT) {
      return done(
        "admin_publication_catalog_object_413",
        json({ error: "Catalog object exceeds its byte limit" }, 413, NO_STORE),
      )
    }
    // A JSON object, cheaply: first and last non-whitespace bytes. The reader
    // validates the schema; this only keeps a truncated upload off the CDN.
    let first = 0
    let last = bytes.byteLength - 1
    while (first <= last && bytes[first] <= 0x20) first += 1
    while (last >= first && bytes[last] <= 0x20) last -= 1
    if (first > last || bytes[first] !== 0x7b || bytes[last] !== 0x7d) {
      return done(
        "admin_publication_catalog_object_400",
        json({ error: "Catalog object must be one JSON object" }, 400, NO_STORE),
      )
    }
    try {
      await putObject(env, STABLE_CATALOG_OBJECT_KEY, bytes, {
        contentType: "application/json",
        cacheControl: STABLE_GENE_OBJECT_CACHE_CONTROL,
      })
    } catch (error) {
      return done(
        "admin_publication_catalog_object_503",
        json(
          { error: String(error?.message || error || "Catalog object PUT failed") },
          503,
          NO_STORE,
        ),
      )
    }
    const purged = await purgeObject(env, STABLE_CATALOG_OBJECT_KEY)
    return done(
      "admin_publication_catalog_object",
      json(
        {
          ok: true,
          key: STABLE_CATALOG_OBJECT_KEY,
          bytes: bytes.byteLength,
          purged: purged === true,
        },
        200,
        NO_STORE,
      ),
    )
  }

  return Object.freeze({ "admin_publication.catalog_object_put": put })
}
