function forbidden(name) {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`Anonymous read touched forbidden state binding: ${name}`)
      },
    },
  )
}

export function createThrowingStateBindings() {
  return Object.freeze({
    DB: forbidden("DB"),
    ICONOPLASM_DB: forbidden("ICONOPLASM_DB"),
    ICONOPLASM_AUTHORING_DB: forbidden("ICONOPLASM_AUTHORING_DB"),
    KV: forbidden("KV"),
    GAME_SESSIONS: forbidden("GAME_SESSIONS"),
    ICONOPLASM_VOTE_COORDINATORS: forbidden("ICONOPLASM_VOTE_COORDINATORS"),
    ICONOPLASM_CARD_PUBLICATION: forbidden("ICONOPLASM_CARD_PUBLICATION"),
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: forbidden("ICONOPLASM_SYNC_FINALIZATION_QUEUE"),
    ICONOPLASM_VOTE_PROJECTION_QUEUE: forbidden("ICONOPLASM_VOTE_PROJECTION_QUEUE"),
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: forbidden(
      "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE",
    ),
    ICONOPLASM_PRINT_COPY_BROWSER: forbidden("ICONOPLASM_PRINT_COPY_BROWSER"),
  })
}

function asHead(request, response) {
  if (request.method !== "HEAD") return response
  return new Response(null, { status: response.status, headers: response.headers })
}

export async function serveStaticFirstRequest(request, options) {
  const url = new URL(request.url)
  const method = String(request.method || "GET").toUpperCase()
  if (!new Set(["GET", "HEAD"]).has(method)) {
    return options.worker(request, options.bindings)
  }
  const asset = options.assets.get(url.pathname)
  if (asset) return asHead(request, asset.clone())
  if (url.pathname.startsWith("/blot/") || url.pathname.startsWith("/portraits/")) {
    return asHead(request, options.placeholder.clone())
  }
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/admin")) {
    return asHead(request, options.shell.clone())
  }
  return options.worker(request, options.bindings)
}
