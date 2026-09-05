import { authorizeIconoplasmAuthorityReplicaBearer } from "../iconoplasm-authority-service-auth.js"
import {
  OPERATION_COST_ROUTE_PREFIX,
  OPERATION_COST_PRINCIPAL_HEADER,
} from "./operation-cost-http.js"
import {
  readBoundedJson,
  safeErrorResponse,
} from "./caretaker/manifestation-authority-http-security.js"

function refuse(code, status) {
  return Response.json(
    { error: { code } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  )
}

// The legacy URL remains stable, but it no longer carries a D1 capability.
// A valid replica bearer alone cannot bypass registration and reservation.
export async function forwardReplicaCostRequest(request, env, authority) {
  if (!(await authorizeIconoplasmAuthorityReplicaBearer(request, env)).authorized)
    return refuse("AUTHENTICATION_REQUIRED", 401)
  const operationId = request.headers.get("x-iconoplasm-operation-id")
  const stepId = request.headers.get("x-iconoplasm-operation-step")
  if (!operationId) return refuse("COST_PREDICTION_NOT_REGISTERED", 428)
  if (!stepId) return refuse("COST_STEP_REQUIRED", 428)
  if (!authority) return refuse("COST_AUTHORITY_UNAVAILABLE", 503)
  let body
  if (request.method === "POST") {
    try {
      body = (await readBoundedJson(request, 16 * 1024)).value
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
  const url = new URL(request.url)
  const result = await authority.fetch(
    new Request(`https://iconoplasm.internal${OPERATION_COST_ROUTE_PREFIX}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [OPERATION_COST_PRINCIPAL_HEADER]: "replica" },
      body: JSON.stringify({
        operation_id: operationId,
        step_id: stepId,
        adapter_id: "authority-replica",
        arguments: {
          method: request.method === "HEAD" ? "GET" : request.method,
          path: url.pathname + url.search,
          body,
        },
      }),
    }),
  )
  const receipt = await result.json()
  if (!result.ok) return refuse(receipt.code || "COST_EXECUTION_FAILED", result.status)
  if (!receipt.result || !Number.isInteger(receipt.result.status))
    return refuse("COST_RECEIPT_INVALID", 503)
  return new Response(request.method === "HEAD" ? null : JSON.stringify(receipt.result.body), {
    status: receipt.result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Iconoplasm-Operation-Usage": JSON.stringify(receipt.usage),
    },
  })
}
