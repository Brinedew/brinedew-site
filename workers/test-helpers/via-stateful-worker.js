import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// Production routes iconoplasm.brinedew.bio/* straight to the stateful Worker
// with the raw request (B-869 retired the public-edge proxy that tests used to
// go through). Tests that model the stateful env behind a binding reach it the
// same way; tests without a binding call the handler directly.
export function viaStatefulWorker(request, env, ctx = { waitUntil() {} }) {
  const worker = env?.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE
  if (worker && typeof worker.fetch === "function") return worker.fetch(request)
  return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    request,
    env,
    ctx,
  )
}
