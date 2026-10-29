// B-1065 B2b: the gene page's caretaker role routes, on the roles table of the
// main database (caretaker-roles.js): whether this account can become the
// gene's caretaker, claiming or switching to it, accepting or declining an
// offer, leaving, and the Make Tags helper. The JSON is the one the gene page
// already speaks (quartz/static/iconoplasm/caretaker-*.js). B-1137 adds asking a
// gene's caretaker for the gene: sending, accepting, rejecting and withdrawing a
// request (caretaker-gene-requests.js).
import * as z from "zod/mini"

import { deliverPendingCaretakerGeneRequestNotifications } from "../iconoplasm-caretaker-comment-notifications.js"
import { createCaretakerSwitchPolicy } from "./caretaker/caretaker-switch-cooldown.js"
import { authorityError } from "./caretaker/manifestation-authority-contract.js"
import {
  jsonResponse,
  readBoundedJson,
  requireBrowserSession,
  requireStrictSameOriginMutation,
  safeErrorResponse,
} from "./caretaker/manifestation-authority-http-security.js"
import {
  TAGGERIZER_MESSAGES,
  TaggerizerError,
  admitTaggerizerCall,
  readTaggerizerInput,
  runTaggerizer,
  taggerizerDisabled,
} from "./caretaker/taggerizer.js"
import {
  createGeneRequest,
  decideGeneRequest,
  readGenePageCaretaking,
} from "./caretaker-gene-requests.js"
import { changeOwnRole, claimGene, requireSteward, rolesDb } from "./caretaker-roles.js"

const GENE = "/api/iconoplasm/caretaker/genes/:gene"
const boundedText = (max) => z.string().check(z.maxLength(max))
const REQUEST_BODY = z.object({
  command_id: z.string().check(z.minLength(8), z.maxLength(128)),
  holder_assignment_id: boundedText(128),
  offered_assignment_id: z.nullable(boundedText(128)),
  replace_request_id: z.nullish(boundedText(64)),
  note: z.nullish(boundedText(2000)),
  terms_accepted: z.literal(true),
  terms_version_id: boundedText(200),
})
const DECISION_BODY = z.object({
  expected_assignment_version: z.optional(z.int().check(z.positive())),
  terms_accepted: z.optional(z.boolean()),
  terms_version_id: z.optional(boundedText(200)),
})

// Zod checks the shape; caretaker-gene-requests.js checks the meaning.
function parsed(schema, body) {
  const result = schema.safeParse(body ?? {})
  if (!result.success) throw authorityError("INVALID_GENE_REQUEST", "Request body is invalid", 400)
  return result.data
}

function param(c, name) {
  try {
    return decodeURIComponent(c.req.param(name))
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

// `caretakerSession` resolves the signed-in Brinedew account (it 401s without
// one). `settleGene` re-runs a gene's election and republishes its gene object, for
// every gene whose caretaker changed: the object names the caretaker readers see.
export function registerCaretakerRoleRoutes(app, { caretakerSession, settleGene }) {
  const signedIn = (c) => requireBrowserSession(c.req.raw, c.env, caretakerSession)
  const now = () => new Date().toISOString()

  async function settle(c, symbols) {
    let ctx
    try {
      ctx = c.executionCtx
    } catch {}
    for (const symbol of new Set(symbols)) {
      try {
        await settleGene(c.env, ctx, symbol)
      } catch (error) {
        console.error("[ICONOPLASM_CARETAKER_ROLE_SETTLE]", symbol, error)
      }
    }
  }

  // A request's Discord message goes out at once; the scheduled delivery retries
  // whatever this misses.
  function deliverSoon(c) {
    let ctx
    try {
      ctx = c.executionCtx
    } catch {}
    const delivery = deliverPendingCaretakerGeneRequestNotifications(c.env, { limit: 2 }).catch(
      (error) => console.warn("[iconoplasm-gene-request-dm] inline delivery failed", error),
    )
    ctx?.waitUntil?.(delivery)
  }

  async function mutation(c, run, bodyLimit) {
    try {
      requireStrictSameOriginMutation(c.req.raw)
      const { accountId, session } = await signedIn(c)
      const { value: body } = await readBoundedJson(c.req.raw, bodyLimit)
      return await run({ accountId, session, body, db: rolesDb(c.env) })
    } catch (error) {
      return safeErrorResponse(error)
    }
  }

  app.get(`${GENE}/claim`, async (c) => {
    try {
      const { accountId, session } = await signedIn(c)
      return jsonResponse(
        await readGenePageCaretaking(rolesDb(c.env), c.env.DB, {
          geneLocator: param(c, "gene"),
          accountId,
          now: now(),
          switchPolicy: createCaretakerSwitchPolicy(c.env),
          session,
        }),
      )
    } catch (error) {
      return safeErrorResponse(error)
    }
  })

  app.post(`${GENE}/claim`, (c) =>
    mutation(c, async ({ accountId, session, body, db }) => {
      const { result, republish } = await claimGene(db, {
        geneLocator: param(c, "gene"),
        accountId,
        body,
        now: now(),
        switchPolicy: createCaretakerSwitchPolicy(c.env),
        session,
      })
      await settle(c, republish)
      return jsonResponse(result)
    }),
  )

  app.post(`${GENE}/assignments/:assignment/:action{accept|decline|end}`, (c) =>
    mutation(c, async ({ accountId, body, db }) => {
      const { result, republish } = await changeOwnRole(db, {
        geneLocator: param(c, "gene"),
        roleId: param(c, "assignment"),
        action: c.req.param("action"),
        accountId,
        body,
        now: now(),
      })
      await settle(c, republish)
      return jsonResponse(result)
    }),
  )

  app.post(`${GENE}/requests`, (c) =>
    mutation(c, async ({ accountId, body, db }) => {
      const { result, notify } = await createGeneRequest(db, {
        geneLocator: param(c, "gene"),
        accountId,
        body: parsed(REQUEST_BODY, body),
        now: now(),
      })
      if (notify) deliverSoon(c)
      return jsonResponse(result)
    }),
  )

  app.post(`${GENE}/requests/:request/:action{accept|reject|withdraw}`, (c) =>
    mutation(c, async ({ accountId, body, db }) => {
      const { result, republish, notify } = await decideGeneRequest(db, {
        geneLocator: param(c, "gene"),
        requestId: param(c, "request"),
        action: c.req.param("action"),
        accountId,
        body: parsed(DECISION_BODY, body),
        now: now(),
      })
      await settle(c, republish)
      if (notify) deliverSoon(c)
      return jsonResponse(result)
    }),
  )

  // B-995: a suggestion only. The same caretaker check as a save; then the kill
  // switch, the input, the caretaker's daily count (one D1 upsert) and one AI call.
  app.post(`${GENE}/taggerize`, (c) =>
    mutation(
      c,
      async ({ accountId, body, db }) => {
        await requireSteward(db, param(c, "gene"), accountId)
        try {
          if (taggerizerDisabled(c.env))
            throw new TaggerizerError("TAGGERIZER_DISABLED", TAGGERIZER_MESSAGES.disabled, 503)
          const input = readTaggerizerInput(body)
          const stamp = now()
          await admitTaggerizerCall(db, accountId, stamp)
          return jsonResponse({
            ok: true,
            suggestion: await runTaggerizer(c.env, input, Date.parse(stamp)),
          })
        } catch (error) {
          if (!(error instanceof TaggerizerError)) throw error
          const retry = error.extra?.retryAfterSeconds
          return jsonResponse(
            {
              ok: false,
              error: { code: error.code, message: error.message },
              ...(retry ? { retry_after_seconds: retry } : {}),
            },
            error.status,
            retry ? { "Retry-After": String(retry) } : {},
          )
        }
      },
      96 * 1024,
    ),
  )
}
