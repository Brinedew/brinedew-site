import { OperationCostError } from "./operation-cost-ledger.js"

// The adapter and its verified cost calculation are supplied by the authority,
// never by a request body. Only this executor receives the provider capability.
// The HTTP surface must not expose ledger.reserve or ledger.settle to callers.
export class OperationCostExecutor {
  constructor({ ledger, adapters, beforeReserve = async () => {} }) {
    this.ledger = ledger
    this.adapters = adapters
    this.beforeReserve = beforeReserve
  }

  async execute(input) {
    if (!input?.operation_id) throw new OperationCostError("COST_PREDICTION_NOT_REGISTERED")
    const plan = this.ledger.readPlan(input.operation_id)
    if (plan.status !== "active") throw new OperationCostError("COST_PLAN_TRIPPED")
    if (Object.hasOwn(plan.steps, input.step_id))
      throw new OperationCostError("COST_STEP_ALREADY_RESERVED")
    const adapter = this.adapters.get(input.adapter_id)
    if (!adapter) throw new OperationCostError("COST_OPERATION_NOT_VERIFIED")
    if (
      adapter.executable_sha256 !== plan.immutable.executable_sha256 ||
      input.adapter_id !== plan.immutable.adapter_id ||
      adapter.schema_sha256 !== plan.immutable.schema_sha256 ||
      adapter.resource !== plan.immutable.resource
    ) {
      throw new OperationCostError("COST_PLAN_IDENTITY_MISMATCH")
    }
    // This preparation validates input and computes a proven maximum. It may
    // not query the provider to discover its bound: that would be unadmitted work.
    const prepared = await adapter.prepare(input.arguments)
    for (const meter of ["rows_read", "rows_written", "requests"]) {
      if (plan.used[meter] + prepared.bound[meter] > plan.ceiling[meter]) {
        throw new OperationCostError("COST_TWICE_PREDICTION_LIMIT")
      }
    }
    await this.beforeReserve()
    const permit = this.ledger.reserve({
      id: plan.id,
      step_id: input.step_id,
      step_sha256: prepared.sha256,
      executable_sha256: adapter.executable_sha256,
      schema_sha256: adapter.schema_sha256,
      resource: adapter.resource,
      adapter_id: input.adapter_id,
      bound: prepared.bound,
    })
    // On a rejected/missing/ambiguous provider response there is no refund and
    // no automatic retry. Replaying this step cannot execute the operation twice.
    const receipt = await adapter.dispatch(prepared)
    const result = this.ledger.settle({ ...permit, actual: receipt.actual })
    if (result.status !== "active") throw new OperationCostError("COST_VERIFIED_BOUND_EXCEEDED")
    return { result: receipt.result, usage: result.used, ceiling: result.ceiling }
  }
}
