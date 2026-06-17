const THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE =
  "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE"

function missingTheOnlyAllowedStatefulWorkerResponse() {
  return Response.json(
    {
      error:
        "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE binding missing for a fail-closed public worker",
      code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  )
}

export async function handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx = { waitUntil() {} },
) {
  // Repo-wide hard fence:
  // this public worker is never allowed to gain D1/KV/R2/session capability.
  // It is only allowed to forward requests to the one internal worker that may
  // touch state. If someone tries to "just add a binding here for one feature",
  // they are recreating the exact failure mode this architecture is meant to end.
  const statefulWorker = env?.[THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE]
  if (!statefulWorker || typeof statefulWorker.fetch !== "function") {
    return missingTheOnlyAllowedStatefulWorkerResponse()
  }

  // ICONOPLASM CANONICAL PORTRAIT PUBLISH CONTRACT.
  // Search terms: PRL split-brain, public edge card cache, canonical blot,
  // logged-out stale card, KV_GALLERY_VERSION.
  //
  // Do not cache `/api/iconoplasm/cards/:symbol` in this public edge worker.
  // This worker intentionally has no KV binding, so it cannot include the live
  // KV_GALLERY_VERSION barrier in a cache key. A symbol-only edge cache is the
  // wrong architecture: after a vote promotes a new canonical portrait and the
  // stateful worker publishes a new card artifact, logged-out users can still
  // receive the old symbol-only edge response until that cache expires or an
  // operator purges it by hand. The internal stateful worker already has the
  // version-aware cache key because it can read the barrier. Keep this proxy
  // state-free and let the stateful worker own public card freshness.

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()

  try {
    const response = await statefulWorker.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        redirect: "manual",
      }),
    )
    return response
  } catch {
    return Response.json(
      {
        error: "The only allowed stateful worker is unavailable",
        code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env, ctx)
  },
}
