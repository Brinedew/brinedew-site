const THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE =
  "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE"

export async function handleBenchmarkRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  request,
  env,
) {
  const statefulWorker = env?.[THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE]
  if (!statefulWorker || typeof statefulWorker.fetch !== "function") {
    return Response.json(
      {
        error:
          "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE binding missing for benchmark edge worker",
        code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()

  return statefulWorker.fetch(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      redirect: "manual",
    }),
  )
}

export default {
  async fetch(request, env) {
    return handleBenchmarkRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      request,
      env,
    )
  },
}
