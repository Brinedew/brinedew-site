// B-1065 B2b: the gene page's caretaker role routes, on the roles table of the
// main database (caretaker-roles.js): whether this account can become the
// gene's caretaker, claiming or switching to it, accepting or declining an
// offer, leaving, and the Make Tags helper. The JSON is the one the gene page
// already speaks (quartz/static/iconoplasm/caretaker-*.js).
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
  changeOwnRole,
  claimGene,
  readClaimAvailability,
  requireSteward,
  rolesDb,
} from "./caretaker-roles.js"

const GENE = "/api/iconoplasm/caretaker/genes/:gene"

function param(c, name) {
  try {
    return decodeURIComponent(c.req.param(name))
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

// `caretakerSession` resolves the signed-in Brinedew account (it 401s without
// one). `settleGene` re-runs a gene's election and republishes its card, for a
// role that ended with its supervote on one of the gene's images.
export function registerCaretakerRoleRoutes(app, { caretakerSession, settleGene }) {
  const signedIn = (c) => requireBrowserSession(c.req.raw, c.env, caretakerSession)
  const now = () => new Date().toISOString()

  async function settle(c, symbols) {
    let ctx
    try {
      ctx = c.executionCtx
    } catch {}
    for (const symbol of symbols) {
      try {
        await settleGene(c.env, ctx, symbol)
      } catch (error) {
        console.error("[ICONOPLASM_CARETAKER_ROLE_SETTLE]", symbol, error)
      }
    }
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
        await readClaimAvailability(rolesDb(c.env), {
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
      const { result, reElect } = await claimGene(db, {
        geneLocator: param(c, "gene"),
        accountId,
        body,
        now: now(),
        switchPolicy: createCaretakerSwitchPolicy(c.env),
        session,
      })
      await settle(c, reElect)
      return jsonResponse(result)
    }),
  )

  app.post(`${GENE}/assignments/:assignment/:action{accept|decline|end}`, (c) =>
    mutation(c, async ({ accountId, body, db }) => {
      const { result, reElect } = await changeOwnRole(db, {
        geneLocator: param(c, "gene"),
        roleId: param(c, "assignment"),
        action: c.req.param("action"),
        accountId,
        body,
        now: now(),
      })
      await settle(c, reElect)
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
