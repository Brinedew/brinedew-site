import {
  IconoplasmGenerationLeaseError,
  failExactGenerationLease,
  renewExactGenerationLease,
} from "./iconoplasm-generation-lease.js"

const CACHE_CONTROL = "private, no-store"

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

function text(value, limit = 500) {
  return String(value || "")
    .trim()
    .slice(0, limit)
}

async function parseJson(request) {
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return {
      ok: false,
      response: json({ ok: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, 400),
    }
  }
}

function rejected(error, fallbackCode, fallbackMessage) {
  const expected = error instanceof IconoplasmGenerationLeaseError
  const status = expected ? Number(error.status || 409) : 500
  return json(
    {
      ok: false,
      error: {
        code: expected ? text(error.code, 96) : fallbackCode,
        message: expected ? text(error.message) || fallbackMessage : fallbackMessage,
      },
    },
    status,
  )
}

function requireDependencies(dependencies) {
  for (const name of [
    "authorizeGenerationBearer",
    "claimGenerationLeases",
    "fulfillGenerationRequests",
    "deliverPendingNotifications",
    "reconcileDeliveredFulfillments",
  ]) {
    if (typeof dependencies?.[name] !== "function") {
      throw new TypeError(`${name} is required`)
    }
  }
}

async function completeGenerationLeaseBatch({
  body,
  env,
  fulfillGenerationRequests,
  deliverPendingNotifications,
  reconcileDeliveredFulfillments,
  inlineDeliveryLimit,
  logger,
}) {
  const result = await fulfillGenerationRequests(env, {
    items: Array.isArray(body?.items) ? body.items : [],
    resolvedBy: "authority-generation-executor",
    publicationId: body?.publication_id || "",
  })
  if (!result.ok) return json(result, 409)
  if (!result.request_ids?.length) return json(result)

  const requestIds = result.request_ids
  const delivery = await deliverPendingNotifications(env, {
    requestIds,
    limit: Math.min(requestIds.length, inlineDeliveryLimit),
  }).catch((error) => {
    logger.error(
      "Iconoplasm fulfillment notification delivery failed",
      text(error?.message || error),
    )
    return {
      ok: false,
      considered: 0,
      delivered: 0,
      suppressed: 0,
      failed: requestIds.length,
      unknown: 0,
      error: text(error?.message || error || "unknown error"),
    }
  })
  const settlement = await reconcileDeliveredFulfillments(env, { requestIds }).catch((error) => ({
    ok: false,
    finalized: 0,
    pending_request_ids: requestIds,
    error: text(error?.message || error || "unknown error"),
  }))
  const deliveryComplete =
    delivery?.ok === true &&
    settlement?.ok === true &&
    Array.isArray(settlement?.pending_request_ids) &&
    settlement.pending_request_ids.length === 0 &&
    Number(delivery?.failed || 0) === 0 &&
    Number(delivery?.unknown || 0) === 0 &&
    Number(delivery?.suppressed || 0) === 0
  if (!deliveryComplete) {
    return json({
      ...result,
      ok: false,
      code: "DISCORD_DELIVERY_PENDING",
      error:
        "Image publication succeeded, but at least one requester has not received the required Discord DM yet.",
      notification_delivery: delivery,
      notification_settlement: settlement,
    })
  }
  return json({
    ...result,
    fulfilled: Number(settlement?.finalized || 0),
    notification_delivery: delivery,
    notification_settlement: settlement,
  })
}

export function createIconoplasmGenerationExecutorHandler(dependencies = {}) {
  requireDependencies(dependencies)
  const {
    authorizeGenerationBearer,
    claimGenerationLeases,
    fulfillGenerationRequests,
    deliverPendingNotifications,
    reconcileDeliveredFulfillments,
    renewGenerationLease = renewExactGenerationLease,
    failGenerationLease = failExactGenerationLease,
    inlineDeliveryLimit = 25,
    logger = console,
  } = dependencies

  return async function handleGenerationExecutorRoute({ match, request, env }) {
    const authorization = await authorizeGenerationBearer(request, env)
    if (!authorization?.authorized) {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401)
    }
    if (!env?.ICONOPLASM_DB) {
      return json(
        {
          ok: false,
          error: { code: "PRIMARY_DATABASE_MISSING", message: "ICONOPLASM_DB binding missing" },
        },
        500,
      )
    }

    const parsed = await parseJson(request)
    if (!parsed.ok) return parsed.response
    const body = parsed.value
    const routeId = String(match?.route?.id || "")

    if (routeId === "authority_generation_lease_claim") {
      try {
        const result = await claimGenerationLeases(env, {
          limit: body?.limit,
          leaseOwnerId: body?.lease_owner_id,
          leaseSeconds: body?.lease_seconds,
        })
        return json({ ok: true, ...result })
      } catch (error) {
        return rejected(error, "GENERATION_LEASE_CLAIM_FAILED", "Generation lease claim failed")
      }
    }

    if (
      routeId === "authority_generation_lease_renew" ||
      routeId === "authority_generation_lease_fail"
    ) {
      const leaseToken = String(match?.params?.lease_token || "")
      const input = {
        db: env.ICONOPLASM_DB,
        leaseToken,
        leaseOwnerId: body?.lease_owner_id,
        expectedLeaseVersion: body?.expected_lease_version,
        leaseSeconds: body?.lease_seconds,
        failureCode: body?.failure_code,
      }
      try {
        const result =
          routeId === "authority_generation_lease_renew"
            ? await renewGenerationLease(input)
            : await failGenerationLease(input)
        return json({ ok: true, ...result })
      } catch (error) {
        return rejected(error, "GENERATION_LEASE_ACTION_FAILED", "Generation lease action failed")
      }
    }

    if (routeId === "authority_generation_lease_complete") {
      return completeGenerationLeaseBatch({
        body,
        env,
        fulfillGenerationRequests,
        deliverPendingNotifications,
        reconcileDeliveredFulfillments,
        inlineDeliveryLimit: Math.max(1, Math.trunc(Number(inlineDeliveryLimit) || 25)),
        logger,
      })
    }

    return json(
      {
        ok: false,
        error: { code: "GENERATION_EXECUTOR_ROUTE_UNKNOWN", message: "Unknown executor route" },
      },
      404,
    )
  }
}
