// Explicit test fixture for mutation paths. Production code has no unbound
// fallback; tests that intend admission must install this named authority.
export function withTestMutationAuthority(env) {
  if (env.ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE) return env
  return {
    ...env,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
      idFromName: () => "test-global",
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname
          const body = await request.json().catch(() => ({}))
          if (path === "/reserve-mutation-writes") {
            return Response.json({
              ok: true,
              replayed: false,
              lane: body.lane,
              operation_id: body.operation_id,
              reserved_units: body.units,
            })
          }
          return Response.json({
            day_key: body.day_key,
            cycle_key: body.cycle_key,
            rows_read: 0,
            rows_written: 0,
            query_count: 0,
            request_count: 0,
            exhausted: false,
            exhausted_by: null,
          })
        },
      }),
    },
  }
}
