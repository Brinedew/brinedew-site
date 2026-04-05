export var ICONOPLASM_DISCOVERY_DEFAULT_ORDER = "newest"
export var ICONOPLASM_GALLERY_DEFAULT_ORDER = "votes"

export var ICONOPLASM_HOME_ORDERS = [
  { value: "newest", label: "Newest" },
  { value: "symbol", label: "A–Z" },
  { value: "shortest", label: "Shortest name first" },
  { value: "votes", label: "Votes" },
  { value: "uniqueness", label: "Uniqueness" },
  { value: "popularity", label: "Popularity" },
  { value: "heaviest", label: "Heaviest first" },
  { value: "lightest", label: "Lightest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "youngest", label: "Youngest first" },
  { value: "random", label: "Random" },
]

export function normalizeIconoplasmHomeOrder(value, fallback) {
  var candidate = String(value || "")
    .trim()
    .toLowerCase()
  if (candidate === "recent") candidate = "newest"
  if (candidate === "popular") candidate = "popularity"
  for (var i = 0; i < ICONOPLASM_HOME_ORDERS.length; i++) {
    if (ICONOPLASM_HOME_ORDERS[i].value === candidate) return candidate
  }
  var fallbackValue = String(fallback || "")
    .trim()
    .toLowerCase()
  for (var j = 0; j < ICONOPLASM_HOME_ORDERS.length; j++) {
    if (ICONOPLASM_HOME_ORDERS[j].value === fallbackValue) return fallbackValue
  }
  return ICONOPLASM_DISCOVERY_DEFAULT_ORDER
}