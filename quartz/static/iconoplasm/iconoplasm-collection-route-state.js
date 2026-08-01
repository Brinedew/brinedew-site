export var ICONOPLASM_TRANSIENT_COLLECTION_URL_PARAMS = Object.freeze([
  "page",
  "after",
  "offset",
  "cursor",
  "anchor",
  "anchorOffset",
])

export function buildIconoplasmCollectionVisibleUrl(currentHref, options) {
  var config = options || {}
  var url = new URL(currentHref)
  var order = String(config.order || "").trim()
  var defaultOrder = String(config.defaultOrder || "").trim()
  var scope = String(config.scope || "").trim()
  var seed = String(config.seed || "").trim()

  if (order && order !== defaultOrder) url.searchParams.set("order", order)
  else url.searchParams.delete("order")

  if (scope === "shared") url.searchParams.set("scope", "shared")
  else url.searchParams.delete("scope")

  if (order === "random" && seed) url.searchParams.set("seed", seed)
  else url.searchParams.delete("seed")

  for (var i = 0; i < ICONOPLASM_TRANSIENT_COLLECTION_URL_PARAMS.length; i += 1) {
    url.searchParams.delete(ICONOPLASM_TRANSIENT_COLLECTION_URL_PARAMS[i])
  }

  return url.pathname + url.search + url.hash
}
