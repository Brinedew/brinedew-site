import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { createManifestationAuthoritySyncHandler } from "./caretaker/manifestation-authority-sync-handlers.js"
import { createManifestationAuthorityServiceHandler } from "./caretaker/manifestation-authority-service-handlers.js"
import { authorizeIconoplasmAuthorityReplicaBearer } from "../iconoplasm-authority-service-auth.js"

const ROOT = "/api/iconoplasm/authority"
const ID = "[^/]+"
const ROUTES = [
  ["POST", new RegExp(`^${ROOT}/snapshots$`), "snapshot-create", () => [128, 16]],
  ["GET", new RegExp(`^${ROOT}/snapshots/${ID}$`), "snapshot-status", () => [16, 0]],
  [
    "GET",
    new RegExp(`^${ROOT}/snapshots/${ID}/parts$`),
    "snapshot-page",
    (limit) => [4 * (limit + 2) + 64, 0],
  ],
  ["POST", new RegExp(`^${ROOT}/snapshots/${ID}/complete$`), "snapshot-complete", () => [32, 4]],
  ["GET", new RegExp(`^${ROOT}/events$`), "event-page", (limit) => [2 * (limit + 1) + 32, 0]],
  ["POST", new RegExp(`^${ROOT}/events/ack$`), "event-ack", () => [32, 4]],
  ["GET", new RegExp(`^${ROOT}/revisions/${ID}/body$`), "revision-body", () => [64, 0]],
  ["GET", new RegExp(`^${ROOT}/derivatives/${ID}/body$`), "derivative-body", () => [64, 0]],
  [
    "POST",
    new RegExp(`^${ROOT}/revisions/${ID}/tags-derivative-head$`),
    "derivative-select",
    () => [4096, 2048],
  ],
]

export function isReplicaCostRoute(method, pathname) {
  const effectiveMethod = method === "HEAD" ? "GET" : method
  return ROUTES.some(([verb, pattern]) => verb === effectiveMethod && pattern.test(pathname))
}

// These exact handlers use unique locator probes and capped indexed pages.
// Writes include the exact accepted-event projection in the same reservation.
// Source/schema identities cover the implementation and its query bounds.
export function createReplicaOperationCostAdapter({
  env,
  executable_sha256,
  schema_sha256,
  onAuthorityEvent,
}) {
  return {
    resource: "iconoplasm-authoring",
    executable_sha256,
    schema_sha256,
    audiences: ["admin", "replica"],
    async prepare(input) {
      if (
        !input ||
        Object.keys(input).some((key) => !["method", "path", "body"].includes(key)) ||
        typeof input.path !== "string" ||
        !input.path.startsWith(ROOT + "/") ||
        input.path.length > 8192 ||
        !["GET", "POST"].includes(input.method)
      )
        throw new OperationCostError("COST_REPLICA_REQUEST_INVALID")
      const url = new URL(input.path, "https://iconoplasm.brinedew.bio")
      const route = ROUTES.find(
        ([method, pattern]) => method === input.method && pattern.test(url.pathname),
      )
      if (!route || url.hash) throw new OperationCostError("COST_OPERATION_NOT_VERIFIED")
      if (route[2] === "derivative-select" && typeof onAuthorityEvent !== "function")
        throw new OperationCostError("COST_PROJECTION_REQUIRED")
      const body = input.body === undefined ? undefined : JSON.stringify(input.body)
      if (
        (input.method === "GET" && body !== undefined) ||
        (input.method === "POST" && body === undefined) ||
        (body !== undefined && new TextEncoder().encode(body).byteLength > 16 * 1024)
      )
        throw new OperationCostError("COST_REPLICA_REQUEST_INVALID")
      const limit = Math.max(
        1,
        Math.min(250, Math.trunc(Number(url.searchParams.get("limit"))) || 100),
      )
      const [rows_read, rows_written] = route[3](limit)
      const prepared = {
        method: input.method,
        path: url.pathname + url.search,
        body,
        route: route[2],
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ prepared, executable_sha256, schema_sha256 })),
      )
      return {
        ...prepared,
        bound: { rows_read, rows_written, requests: 1 },
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      }
    },
    async dispatch(prepared) {
      const meter = createOperationCostD1Meter(env.ICONOPLASM_AUTHORING_DB)
      const primary =
        prepared.route === "derivative-select"
          ? createOperationCostD1Meter(env.ICONOPLASM_DB)
          : null
      const scopedEnv = {
        ...env,
        ICONOPLASM_AUTHORING_DB: meter.db,
        ...(primary ? { ICONOPLASM_DB: primary.db } : {}),
      }
      const factory =
        prepared.route.endsWith("-body") || primary
          ? createManifestationAuthorityServiceHandler
          : createManifestationAuthoritySyncHandler
      const handler = factory({
        db: meter.db,
        env: scopedEnv,
        authorizeReplicaBearer: authorizeIconoplasmAuthorityReplicaBearer,
        ...(primary ? { onAuthorityEvent: (event) => onAuthorityEvent(event, scopedEnv) } : {}),
        onIntegrityFailure: async (failure) => {
          console.error("[ICONOPLASM_AUTHORITY_BODY_INTEGRITY]", failure)
        },
      })
      const request = new Request(`https://iconoplasm.brinedew.bio${prepared.path}`, {
        method: prepared.method,
        headers: {
          Authorization: `Bearer ${env.ICONOPLASM_AUTHORITY_REPLICA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: prepared.body,
      })
      const response = await handler(request)
      if (!response) throw new OperationCostError("COST_OPERATION_NOT_VERIFIED")
      const body = await response.json()
      const actual = meter.finish()
      if (primary) {
        const projection = primary.finish()
        actual.rows_read += projection.rows_read
        actual.rows_written += projection.rows_written
      }
      return { result: { status: response.status, body }, actual }
    },
  }
}
