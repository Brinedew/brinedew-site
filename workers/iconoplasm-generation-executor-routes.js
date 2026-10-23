import {
  IconoplasmGenerationLeaseError,
  failExactGenerationLease,
  readExactGenerationLeaseMaterial,
  renewExactGenerationLease,
} from "./iconoplasm-generation-lease.js"

import { IconoplasmGenerationSourceError } from "./lib/iconoplasm-generation-provenance.js"
import { d1DailyRowLimitResponse } from "./lib/cloudflare-availability.js"
import {
  GENERATION_COMPLETION_MAX_REQUESTS,
  generationCompletionSize,
} from "./lib/iconoplasm-mutation-write-bounds.js"

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
  const unavailable = d1DailyRowLimitResponse(error)
  if (unavailable) return unavailable
  const expected =
    error instanceof IconoplasmGenerationLeaseError ||
    error instanceof IconoplasmGenerationSourceError
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
  // One claim leases at most GENERATION_COMPLETION_MAX_REQUESTS requests, so a
  // larger body is not one session's completion. It is refused before any write,
  // and nothing about the leases or requests changes: send it again in parts.
  const size = generationCompletionSize(body)
  if (
    size.items > GENERATION_COMPLETION_MAX_REQUESTS ||
    size.requestIds > GENERATION_COMPLETION_MAX_REQUESTS
  ) {
    return json(
      {
        ok: false,
        error: {
          code: "GENERATION_COMPLETION_TOO_LARGE",
          message: `A completion carries at most ${GENERATION_COMPLETION_MAX_REQUESTS} requests in at most ${GENERATION_COMPLETION_MAX_REQUESTS} items; this one carries ${size.requestIds} requests in ${size.items} items. Nothing was written. Send it again in parts.`,
        },
      },
      400,
    )
  }
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
  // One receipt covers a whole order, and an order can span publications. The
  // receipt this publication completed also closes the order's requests that
  // earlier publications left waiting for it.
  const published = new Set(requestIds)
  const siblings = (delivery?.delivered_request_ids || []).filter((id) => !published.has(id))
  for (let offset = 0; offset < siblings.length; offset += 50) {
    const closed = await reconcileDeliveredFulfillments(env, {
      requestIds: siblings.slice(offset, offset + 50),
    }).catch(() => ({ finalized: 0 }))
    settlement.finalized = Number(settlement.finalized || 0) + Number(closed?.finalized || 0)
  }
  // The portraits are on their cards once fulfillGenerationRequests answers;
  // the receipt is the website's job, not the publication's. Ask the
  // workstation to call again only while this call sent a receipt cleanly and
  // another order in this publication is ready to send now. A receipt that
  // waits for the rest of its order, or for a Discord retry, goes out from the
  // quarter-hour fulfillment cron (runScheduledIconoplasmFulfillment). Failing
  // the publication for it turned the Drain red on every order larger than one
  // session (2026-10-23: a 10-portrait SOX11 order) and fixed nothing.
  const continueInline =
    delivery?.ok === true &&
    delivery?.more_ready === true &&
    Number(delivery?.delivered || 0) > 0 &&
    Number(delivery?.failed || 0) === 0 &&
    Number(delivery?.unknown || 0) === 0 &&
    Number(delivery?.suppressed || 0) === 0
  if (continueInline) {
    return json({
      ...result,
      ok: false,
      code: "DISCORD_DELIVERY_PENDING",
      error: "Image publication succeeded; another requester's Discord receipt is ready to send.",
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
    readGenerationMaterial = readExactGenerationLeaseMaterial,
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

    if (routeId === "authority_generation_lease_material") {
      try {
        return json(
          await readGenerationMaterial({
            env,
            leaseToken: match?.params?.lease_token,
            leaseOwnerId: body?.lease_owner_id,
            expectedLeaseVersion: body?.expected_lease_version,
          }),
        )
      } catch (error) {
        return rejected(
          error,
          "GENERATION_MATERIAL_UNAVAILABLE",
          "Exact generation material is unavailable",
        )
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
