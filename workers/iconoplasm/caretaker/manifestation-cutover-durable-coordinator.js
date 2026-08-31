import { createIconoplasmManifestationAuthorityRuntimeHandler } from "../../iconoplasm-manifestation-authority-runtime.js"

const CUTOVER_ACTION_ROUTE = /^\/api\/iconoplasm\/authority\/cutover\/runs\/([^/]+)\/actions$/

function cutoverRunId(pathname) {
  const match = String(pathname || "").match(CUTOVER_ACTION_ROUTE)
  if (!match) return null
  try {
    const value = decodeURIComponent(match[1])
    return /^cutover_[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null
  } catch {
    return null
  }
}

function coordinatorResponse(code, status = 503) {
  return Response.json({ error: { code } }, { status })
}

export async function forwardManifestationCutoverActionToCoordinator(request, env) {
  if (request.method !== "POST") return null
  const runId = cutoverRunId(new URL(request.url).pathname)
  if (!runId) return null
  // Slow Bunny PUT/GET propagation is network wait, not serialized authority
  // work. Keeping it inside a Durable Object billed the wait as active DO
  // duration and exhausted the account-wide Free allowance. The signed body is
  // still validated by the ordinary authority handler; this header selects the
  // execution plane only and grants no authority.
  if (request.headers.get("x-iconoplasm-cutover-action") === "materialize") return null
  const namespace = env?.ICONOPLASM_MANIFESTATION_CUTOVER_COORDINATORS
  if (
    !namespace ||
    typeof namespace.idFromName !== "function" ||
    typeof namespace.get !== "function"
  ) {
    return coordinatorResponse("MANIFESTATION_CUTOVER_COORDINATOR_REQUIRED")
  }
  // Do not parse a potentially large request body in the 10 ms edge
  // invocation. The bounded operator supplies only this routing hint; the
  // authority handler inside the Durable Object still validates the signed
  // JSON shard identity as the source of truth.
  const shard = String(request.headers.get("x-iconoplasm-cutover-shard") || "")
  const match = shard.match(/^(1|2|4|8|16|32):(\d{1,2})$/)
  const count = Number(match?.[1] || 0)
  const index = Number(match?.[2] || -1)
  const lane = match && index >= 0 && index < count ? `shard:${count}:${index}` : "control"
  const stub = namespace.get(namespace.idFromName(`${runId}:${lane}`))
  try {
    return await stub.fetch(request)
  } catch (error) {
    // A rejected stub fetch otherwise escapes into the public runtime's
    // generic 500 boundary and erases the distinction between an application
    // error and an unavailable Durable Object. Keep diagnostics bounded and
    // payload-free: neither source prose nor bearer credentials belong here.
    console.error("[ICONOPLASM_CUTOVER_COORDINATOR_UNAVAILABLE]", {
      cutover_run_id: runId,
      lane,
      error_name: String(error?.name || "Error").slice(0, 80),
      error_message: String(error?.message || "Cutover coordinator unavailable").slice(0, 320),
    })
    return coordinatorResponse("MANIFESTATION_CUTOVER_COORDINATOR_UNAVAILABLE")
  }
}

export class IconoplasmManifestationCutoverCoordinator {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    if (!cutoverRunId(new URL(request.url).pathname) || request.method !== "POST") {
      return coordinatorResponse("MANIFESTATION_CUTOVER_COORDINATOR_ROUTE_NOT_FOUND", 404)
    }
    const handler = createIconoplasmManifestationAuthorityRuntimeHandler({
      env: {
        ...this.env,
        ICONOPLASM_CUTOVER_EXECUTION_PLANE: "durable_object",
      },
      resolveSession: async () => {
        throw new Error("Caretaker sessions are not resolved by the cutover coordinator")
      },
      onAuthorityEvent: async () => {},
      onIntegrityFailure: async (failure) => {
        console.error("[ICONOPLASM_AUTHORITY_BODY_INTEGRITY]", failure)
      },
      scheduleBackground: (promise) => this.state?.waitUntil?.(promise),
    })
    const response = await handler(request)
    return response || coordinatorResponse("MANIFESTATION_CUTOVER_COORDINATOR_ROUTE_NOT_FOUND", 404)
  }
}

// ARCHITECTURE FENCE [IPD-012]: serialized cutover control transitions run in
// the SQLite Durable Object. Per-gene materialization stays on bounded ordinary
// Worker requests so external storage propagation cannot consume shared DO
// duration. Public caretaker commands remain bounded edge requests.
