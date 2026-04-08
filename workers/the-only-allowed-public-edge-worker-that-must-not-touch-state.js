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

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()

  try {
    return await statefulWorker.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        redirect: "manual",
      }),
    )
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
  async fetch(request, env) {
    return handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env)
  },
}
