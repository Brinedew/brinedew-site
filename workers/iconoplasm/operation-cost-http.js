import { OperationCostError, OperationCostLedger } from "../lib/operation-cost-ledger.js"
import { OperationCostExecutor } from "../lib/operation-cost-executor.js"
import { OPERATION_COST_IDENTITIES } from "../generated/operation-cost-identities.js"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"
import { createOperationCostQueryRegistry } from "./operation-cost-query-registry.js"
import { createOperationCostAccountUsageReader } from "./operation-cost-account-usage.js"
import { createMigrationOperationCostAdapters } from "./operation-cost-migration-adapters.js"
import { createReplicaOperationCostAdapter } from "./operation-cost-replica-adapter.js"

const MAX_BODY_BYTES = 70_000
export const OPERATION_COST_ROUTE_PREFIX = "/api/iconoplasm/admin/cost/operations"
export const OPERATION_COST_PRINCIPAL_HEADER = "x-iconoplasm-cost-principal"

function response(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } })
}

async function readBody(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new OperationCostError("COST_REQUEST_BODY_REQUIRED")
  const parts = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new OperationCostError("COST_REQUEST_BODY_LIMIT")
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    body.set(part, offset)
    offset += part.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
  } catch {
    throw new OperationCostError("COST_REQUEST_BODY_INVALID")
  }
}

// Only the existing authenticated internal Worker may reach this authority.
// Its DO binding is not a public URL. Raw reserve/settle are deliberately absent.
export function createOperationCostAuthority(storage, env, options = {}) {
  const usage =
    options.usage ||
    createOperationCostAccountUsageReader({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
    })
  const ledger = new OperationCostLedger(
    storage,
    options.now,
    () => ledger.storedAccountUsage(),
    options.readOtherUsage,
  )
  const registry = createOperationCostQueryRegistry()
  const adapters = new Map([
    [
      "authority-replica",
      createReplicaOperationCostAdapter({
        env,
        ...OPERATION_COST_IDENTITIES,
        onAuthorityEvent: options.onAuthorityEvent,
      }),
    ],
    ...createMigrationOperationCostAdapters(env, OPERATION_COST_IDENTITIES),
    [
      "iconoplasm-d1",
      createOperationCostD1Adapter({
        db: env.ICONOPLASM_DB,
        registry,
        resource: "iconoplasm",
        ...OPERATION_COST_IDENTITIES,
      }),
    ],
  ])
  const executor = new OperationCostExecutor({
    ledger,
    adapters,
    beforeReserve: async () => {
      const sample = await usage.refresh()
      ledger.rememberAccountUsage(sample || usage.current())
    },
  })
  return {
    initialize: () => ledger.initialize(),
    async fetch(request) {
      try {
        // This header is set by the authenticated Worker, never trusted from
        // its external request. Missing attribution fails closed on the DO.
        const principal = request.headers.get(OPERATION_COST_PRINCIPAL_HEADER)
        if (!["admin", "replica"].includes(principal))
          throw new OperationCostError("COST_PRINCIPAL_REQUIRED")
        const allowed = (adapter) => (adapter?.audiences || ["admin"]).includes(principal)
        const pathname = new URL(request.url).pathname
        if (
          pathname !== OPERATION_COST_ROUTE_PREFIX &&
          !pathname.startsWith(OPERATION_COST_ROUTE_PREFIX + "/")
        )
          return response({ code: "COST_ROUTE_NOT_FOUND" }, 404)
        const suffix = pathname.slice(OPERATION_COST_ROUTE_PREFIX.length)
        // Discovery, registration and receipts spend Worker requests too.
        // Keep their shared allocation visible and reserve diagnostic headroom.
        if (
          (suffix === "" && ["GET", "HEAD"].includes(request.method)) ||
          (request.method === "POST" && ["/register", "/receipt"].includes(suffix))
        )
          ledger.recordControlRequest()
        if (suffix === "" && request.method === "HEAD")
          return new Response(null, { headers: { "Cache-Control": "no-store" } })
        if (suffix === "" && request.method === "GET") {
          return response({
            schema: "iconoplasm.operationCost.v1",
            features: ["preserved-budget-continuation"],
            adapters: [...adapters]
              .filter(([, adapter]) => allowed(adapter))
              .map(([id, adapter]) => ({
                id,
                resource: adapter.resource,
                executable_sha256: adapter.executable_sha256,
                schema_sha256: adapter.schema_sha256,
                query_ids: adapter.query_ids || [],
              })),
          })
        }
        if (request.method !== "POST" || !["/register", "/execute", "/receipt"].includes(suffix))
          return response({ code: "COST_ROUTE_NOT_FOUND" }, 404)
        const input = await readBody(request)
        if (suffix === "/register") {
          const adapter = adapters.get(input?.adapter_id)
          if (!adapter) throw new OperationCostError("COST_OPERATION_NOT_VERIFIED")
          if (!allowed(adapter)) throw new OperationCostError("COST_PRINCIPAL_FORBIDDEN")
          if (
            input?.executable_sha256 !== adapter.executable_sha256 ||
            input?.schema_sha256 !== adapter.schema_sha256 ||
            input?.resource !== adapter.resource
          )
            throw new OperationCostError("COST_PLAN_IDENTITY_MISMATCH")
          return response({ plan: ledger.register({ ...input, principal }) }, 201)
        }
        if (suffix === "/execute" && !input?.operation_id)
          throw new OperationCostError("COST_PREDICTION_NOT_REGISTERED")
        const plan = ledger.readPlan(suffix === "/receipt" ? input?.id : input?.operation_id)
        if (plan.immutable.principal !== principal && principal !== "admin")
          throw new OperationCostError("COST_PRINCIPAL_FORBIDDEN")
        if (suffix === "/receipt") return response({ plan })
        if (!allowed(adapters.get(input?.adapter_id)))
          throw new OperationCostError("COST_PRINCIPAL_FORBIDDEN")
        return response(await executor.execute(input))
      } catch (error) {
        if (!(error instanceof OperationCostError))
          return response({ code: "COST_AUTHORITY_UNAVAILABLE" }, 503)
        const status = /PRINCIPAL/.test(error.code)
          ? 403
          : /NOT_REGISTERED|PREDICTION_REQUIRED/.test(error.code)
            ? 428
            : /LIMIT|TRIPPED|INVALIDATED/.test(error.code)
              ? 429
              : /UNAVAILABLE|RECEIPT_MISSING/.test(error.code)
                ? 503
                : 400
        return response({ code: error.code }, status)
      }
    },
  }
}
