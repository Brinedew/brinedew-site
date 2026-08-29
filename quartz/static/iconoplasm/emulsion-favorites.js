export function normalizeEmulsionFamilyId(raw) {
  var value = String(raw || "")
    .trim()
    .toUpperCase()
    .slice(0, 64)
  while (value.endsWith("-E")) value = value.slice(0, -2)
  var factoryEmulsion = /^[A-Z][1-9][0-9]*-([1-9][0-9]*)$/.exec(value)
  if (factoryEmulsion) value = "0-" + factoryEmulsion[1]
  return /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(value) ? value : ""
}

export function createEmulsionFavoriteStore(options) {
  var config = options || {}
  var readFavorites = config.readFavorites
  var writeFavorite = config.writeFavorite
  var favoriteIds = new Set()
  var pendingIds = new Set()
  var listeners = new Set()
  var loaded = false
  var loading = null

  function snapshot(extra) {
    return Object.assign(
      {
        favoriteIds: Array.from(favoriteIds),
        pendingIds: Array.from(pendingIds),
        loaded: loaded,
      },
      extra || {},
    )
  }

  function notify(extra) {
    var state = snapshot(extra)
    listeners.forEach(function (listener) {
      listener(state)
    })
    return state
  }

  function replace(ids) {
    favoriteIds = new Set(
      (Array.isArray(ids) ? ids : []).map(normalizeEmulsionFamilyId).filter(Boolean),
    )
    loaded = true
    return notify()
  }

  function load(force) {
    if (loaded && !force) return Promise.resolve(snapshot())
    if (loading) return loading
    loading = Promise.resolve()
      .then(function () {
        return readFavorites()
      })
      .then(function (payload) {
        loading = null
        return replace(payload && payload.favorite_emulsion_ids)
      })
      .catch(function (error) {
        loading = null
        notify({ error: error })
        throw error
      })
    return loading
  }

  function toggle(rawId) {
    var emulsionId = normalizeEmulsionFamilyId(rawId)
    if (!emulsionId) return Promise.reject(new Error("Invalid emulsion ID."))
    if (pendingIds.has(emulsionId)) return Promise.resolve(snapshot())
    var previous = favoriteIds.has(emulsionId)
    var next = !previous
    if (next) favoriteIds.add(emulsionId)
    else favoriteIds.delete(emulsionId)
    pendingIds.add(emulsionId)
    notify({ changedId: emulsionId, optimistic: true })
    return Promise.resolve()
      .then(function () {
        return writeFavorite(emulsionId, next)
      })
      .then(function () {
        pendingIds.delete(emulsionId)
        return notify({ changedId: emulsionId })
      })
      .catch(function (error) {
        pendingIds.delete(emulsionId)
        if (previous) favoriteIds.add(emulsionId)
        else favoriteIds.delete(emulsionId)
        notify({ changedId: emulsionId, error: error, rolledBack: true })
        throw error
      })
  }

  return {
    has: function (rawId) {
      return favoriteIds.has(normalizeEmulsionFamilyId(rawId))
    },
    isPending: function (rawId) {
      return pendingIds.has(normalizeEmulsionFamilyId(rawId))
    },
    isLoaded: function () {
      return loaded
    },
    ids: function () {
      return Array.from(favoriteIds)
    },
    load: load,
    replace: replace,
    reset: function () {
      favoriteIds.clear()
      pendingIds.clear()
      loaded = false
      loading = null
      return notify()
    },
    subscribe: function (listener) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    },
    toggle: toggle,
  }
}
