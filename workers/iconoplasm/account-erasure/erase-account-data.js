// B-987: the one operator command that fulfils an erasure request.
//
// `eraseBrinedewAccountOnRequest` is what POST /api/iconoplasm/admin/accounts/erase runs. One
// request does a bounded slice of the work and says whether it is finished; the operator sends
// the same request again until `erasure.complete` is true. Every statement is keyed by the
// person's Discord id and changes at most ERASURE_SLICE_ROWS rows, so a re-run after any failure
// (a Worker killed mid-way, a spent daily budget, a refused batch) finds what is left and
// continues. Nothing is stored about the progress: the rows themselves are the progress.
//
// Order, and why it is this order:
//   1. The account becomes `erasure_pending`. From then on every session of the person is
//      refused and wiped on its next request (the GameSession object checks the account status),
//      so nothing new is written under the Discord id while the data goes.
//   2. The data steps (erasure-steps.js): the Iconoplasm database, then the accounts database,
//      then the cold audit copy, then the GeneGuessr Durable Objects and the KV keys that embed
//      the Discord id.
//   3. The caretaker authority is told the account is `erasure_pending` (it ends the person's
//      assignments under the `retain` policy). It refuses to tombstone an account it has not seen
//      pending, and the account projection outbox keeps only the newest state of an account, so
//      this has to be delivered before step 4 replaces it with `erased`.
//   4. Only when every step reports done, the account is completed: `erased`, provider link and
//      `users` row deleted, fingerprints scrubbed (eraseBrinedewAccount). That is the last place
//      the Discord id lives, and the steps above need it, so it goes last and in one transaction.
//      The scheduled projection drain then tombstones the account in the authority.
//
// Cost bounds (D1 free plan: 100,000 rows written and 5,000,000 rows read a day for the whole
// account, 1,000 D1 calls and 10 ms of CPU a Worker request): a request writes at most
// `maxRowsWritten` rows (default ERASURE_DEFAULT_ROW_WRITES; each pass reserves the worst case of
// every statement it sends, the steps' own weights, before it sends them) and makes at most
// ERASURE_MAX_D1_CALLS D1 calls for the data, plus the five or six of the account lifecycle. A
// pass is one D1 batch per database holding one bounded slice of every step that still has work,
// so a small erasure is a handful of calls. A heavy one takes several requests, and belongs at the
// end of the UTC day (docs/ICONOPLASM_OPERATIONS.md).
//
// The steps whose column has no index (portrait creators, publish event actors, the caretaker
// outbox) cost a table scan to ask. They run last, after everything indexed is gone, and walk
// each table once by rowid.
import { projectBrinedewAccountToManifestationAuthority } from "../../lib/brinedew-authority-account-projection.js"
import {
  BrinedewAccountIdentityError,
  brinedewFormerAuthorLabel,
  eraseBrinedewAccount,
  normalizeBrinedewAccountId,
  readBrinedewAccount,
  readBrinedewAccountDiscordSubjects,
  requestBrinedewAccountErasure,
} from "../../lib/brinedew-account-identity.js"
import {
  canWriteExternalPortraitStorage,
  deletePortraitStorageObject,
} from "../../lib/iconoplasm-portrait-storage.js"
import {
  DiscordMirrorError,
  anonymiseCommentPost,
  discordMirrorConfig,
} from "./discord-comment-mirror.js"
import { ERASURE_DATABASES, ERASURE_SLICE_ROWS, ERASURE_STEPS } from "./erasure-steps.js"
import { deletableJobImageKeys, jobImagesSliceSql } from "./job-result-images.js"

export const ERASURE_DEFAULT_ROW_WRITES = 5000
export const ERASURE_MIN_ROW_WRITES = 100
export const ERASURE_MAX_D1_CALLS = 20
export const ERASURE_MAX_KV_OPERATIONS = 100
// External fetch() calls (the Bunny object deletes and the Discord calls) one request may make. The
// free plan allows 50 per invocation; the rest is headroom.
export const ERASURE_MAX_EXTERNAL_FETCHES = 40
// A slice of comments names at most this many genes, and each gene's cached comment list is one
// KV delete.
const COMMENT_SLICE_ROWS = 25
const JOB_IMAGE_SLICE_ROWS = 12
// A job writes at most three renditions, one delete each.
const OBJECTS_PER_JOB = 3
const CUSTOM_ACTIONS = new Set(["comments", "job_images"])

function rowsFrom(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function isMissingTable(error) {
  return /no such table/i.test(String(error?.message || error))
}

function databaseFor(env, database) {
  const binding = ERASURE_DATABASES[database]
  const db = env?.[binding] || null
  // The cold audit copy is created by code on the first archive run; a deployment without it has
  // nothing to erase there. The other two are required.
  if (!db && database !== "audit") {
    throw new TypeError(`The ${binding} database binding is required to erase an account`)
  }
  return db
}

function bindValues(binders, context) {
  return (binders || []).map((binder) => binder(context))
}

function spendRowsWritten(budget, meta, changed, weight) {
  const reported = Number(meta?.rows_written)
  const written = Number.isFinite(reported) && reported > 0 ? reported : changed * weight
  budget.writes -= written
  budget.rowsWritten += written
}

function sliceSql(step, limit) {
  const columns = step.key === "rowid" ? "rowid" : step.key.join(", ")
  const left = step.key === "rowid" ? "rowid" : `(${step.key.join(", ")})`
  const pick = `SELECT ${columns} FROM ${step.table} WHERE ${step.where} LIMIT ${limit}`
  return step.action === "delete"
    ? `DELETE FROM ${step.table} WHERE ${left} IN (${pick})`
    : `UPDATE ${step.table} SET ${step.set} WHERE ${left} IN (${pick})`
}

function applyByRowidSql(step) {
  const pick = "SELECT value FROM json_each(?)"
  return step.action === "delete"
    ? `DELETE FROM ${step.table} WHERE rowid IN (${pick})`
    : `UPDATE ${step.table} SET ${step.set} WHERE rowid IN (${pick})`
}

// The slice each still-open step may run in the next pass: ERASURE_SLICE_ROWS, or what is left of
// the row-write budget after the worst case of the steps before it. Reserving the worst case
// keeps a request's writes under its budget whatever the data holds.
function planPass(open, budget) {
  const planned = []
  let reserved = 0
  for (const step of open.values()) {
    const limit = Math.min(ERASURE_SLICE_ROWS, Math.floor((budget.writes - reserved) / step.weight))
    if (limit < 1) continue
    planned.push({ step, limit })
    reserved += limit * step.weight
  }
  return { planned, reserved }
}

// Indexed steps of one database: a probe, then passes of one batch each, until every step with
// work has found its end (a slice that changes fewer rows than it asked for) or the budget is
// spent. True when finished.
async function runIndexedPasses(env, database, steps, context, budget, changedBy) {
  const db = databaseFor(env, database)
  if (!steps.length) return true
  // A request keeps no memory of the last one, so it first asks which steps still have a row to
  // change (one read batch, an index lookup each) and reserves budget only for those.
  if (budget.calls < 1) return false
  const probed = await db.batch(
    steps.map((step) =>
      db
        .prepare(`SELECT 1 AS hit FROM ${step.table} WHERE ${step.where} LIMIT 1`)
        .bind(...bindValues(step.whereBinds, context)),
    ),
  )
  budget.calls -= 1
  const open = new Map(
    steps.filter((_, index) => rowsFrom(probed[index]).length).map((step) => [step.id, step]),
  )
  while (open.size) {
    if (budget.calls < 1) return false
    const { planned, reserved } = planPass(open, budget)
    if (!planned.length) return false
    const results = await db.batch(
      planned.map(({ step, limit }) =>
        db
          .prepare(sliceSql(step, limit))
          .bind(...bindValues(step.setBinds, context), ...bindValues(step.whereBinds, context)),
      ),
      { maxRowsWritten: reserved },
    )
    budget.calls -= 1
    planned.forEach(({ step, limit }, index) => {
      const count = Number(results[index]?.meta?.changes ?? 0)
      spendRowsWritten(budget, results[index]?.meta, count, step.weight)
      changedBy.set(step.id, (changedBy.get(step.id) || 0) + count)
      if (count < limit) open.delete(step.id)
    })
  }
  return true
}

// Unindexed steps of one database: each pass is a batch of selects (the next rowids that match,
// after a cursor per step) and a batch of updates by rowid. A select that returns fewer rowids
// than it asked for has reached the end of the table.
async function runScanPasses(env, database, steps, context, budget, changedBy) {
  const db = databaseFor(env, database)
  if (!db || !steps.length) return true
  const open = new Map(steps.map((step) => [step.id, step]))
  const cursor = new Map(steps.map((step) => [step.id, 0]))
  try {
    while (open.size) {
      if (budget.calls < 2) return false
      const { planned } = planPass(open, budget)
      if (!planned.length) return false
      const found = await db.batch(
        planned.map(({ step, limit }) =>
          db
            .prepare(
              `SELECT rowid AS k FROM ${step.table}
               WHERE rowid > ? AND (${step.where}) ORDER BY rowid LIMIT ${limit}`,
            )
            .bind(cursor.get(step.id), ...bindValues(step.whereBinds, context)),
        ),
      )
      budget.calls -= 1
      const apply = []
      planned.forEach(({ step, limit }, index) => {
        const ids = rowsFrom(found[index]).map((row) => Number(row.k))
        if (ids.length < limit) open.delete(step.id)
        if (ids.length) {
          cursor.set(step.id, ids[ids.length - 1])
          apply.push({ step, ids })
        }
      })
      if (!apply.length) continue
      const results = await db.batch(
        apply.map(({ step, ids }) =>
          db
            .prepare(applyByRowidSql(step))
            .bind(...bindValues(step.setBinds, context), JSON.stringify(ids)),
        ),
        { maxRowsWritten: apply.reduce((sum, { step, ids }) => sum + ids.length * step.weight, 0) },
      )
      budget.calls -= 1
      apply.forEach(({ step }, index) => {
        const count = Number(results[index]?.meta?.changes ?? 0)
        spendRowsWritten(budget, results[index]?.meta, count, step.weight)
        changedBy.set(step.id, (changedBy.get(step.id) || 0) + count)
      })
    }
    return true
  } catch (error) {
    if (database === "audit" && isMissingTable(error)) return true
    throw error
  }
}

// Public comments stay under the anonymous label; a comment its author had already removed goes.
// Each slice does four things, in this order, so a failure at any point leaves the rows to the next
// run: (1) the gene's cached comment list (KV, 24 hours), which carries the old name and avatar, is
// dropped (a reader that arrives in between reads D1: a GET never fills the cache); (2) the
// comment's copy in the public Discord channel is rewritten to the label, or deleted for a removed
// comment (B-992, discord-comment-mirror.js); (3) the rows are rewritten or deleted. The rows are
// the progress: a comment whose Discord post is done but whose row is not is found again, finds
// no post that names the person, and moves on.
async function runCommentsStep(env, step, context, budget, services, changedBy, discord) {
  const db = databaseFor(env, step.database)
  for (;;) {
    const limit = Math.min(COMMENT_SLICE_ROWS, Math.floor(budget.writes / step.weight))
    if (limit < 1 || budget.calls < 2) return false
    const found = await db
      .prepare(
        `SELECT id, gene_symbol, username, body, status, created_at FROM icono_gene_comments
         WHERE user_id = ? ORDER BY id LIMIT ${limit}`,
      )
      .bind(context.userId)
      .all()
    budget.calls -= 1
    const rows = rowsFrom(found)
    if (!rows.length) return true
    const symbols = [...new Set(rows.map((row) => String(row.gene_symbol || "")).filter(Boolean))]
    if (env.KV && services?.geneCommentsCacheKey) {
      if (budget.kv < symbols.length) return false
      for (const symbol of symbols) await env.KV.delete(services.geneCommentsCacheKey(symbol))
      budget.kv -= symbols.length
    }
    // Each comment needs up to two Discord calls (find the post, then edit or delete it). A comment
    // the budget cannot reach waits for the next request, as does everything after a rate limit.
    const handled = []
    let interrupted = false
    for (const row of rows) {
      if (discord.config) {
        if (budget.fetches < 2) {
          interrupted = true
          break
        }
        try {
          const outcome = await anonymiseCommentPost(discord.config, budget, row, {
            label: context.label,
            remove: row.status === "deleted",
          })
          const counter = `discord_posts_${outcome}`
          changedBy.set(counter, (changedBy.get(counter) || 0) + 1)
        } catch (error) {
          if (error instanceof DiscordMirrorError && error.code === "DISCORD_RATE_LIMITED") {
            budget.retryAfterSeconds = Math.max(budget.retryAfterSeconds, error.retryAfterSeconds)
            interrupted = true
            break
          }
          throw error
        }
      }
      handled.push(row)
    }
    if (handled.length) {
      const removed = handled.filter((row) => row.status === "deleted").map((row) => row.id)
      const kept = handled.filter((row) => row.status !== "deleted").map((row) => row.id)
      const results = await db.batch(
        [
          db
            .prepare(
              `UPDATE icono_gene_comments SET user_id = ?, username = ?, avatar_url = ''
               WHERE id IN (SELECT value FROM json_each(?)) AND status <> 'deleted'`,
            )
            .bind(context.accountId, context.label, JSON.stringify(kept)),
          db
            .prepare(
              `DELETE FROM icono_gene_comments
               WHERE id IN (SELECT value FROM json_each(?)) AND status = 'deleted'`,
            )
            .bind(JSON.stringify(removed)),
        ],
        { maxRowsWritten: handled.length * step.weight },
      )
      budget.calls -= 1
      for (const result of results) {
        const count = Number(result?.meta?.changes ?? 0)
        spendRowsWritten(budget, result?.meta, count, step.weight)
        changedBy.set(step.id, (changedBy.get(step.id) || 0) + count)
      }
    }
    if (interrupted) return false
    if (rows.length < limit) return true
  }
}

// B-993: an unpublished job's result images are deleted from the portrait storage, then the job's
// row (job-result-images.js says which keys are safe to delete and why). Runs before every other
// step of the Iconoplasm database, so the generic steps never see an unpublished job that wrote an
// image. A delete that fails throws and leaves the row, so the next request repeats it.
async function runJobImagesStep(env, step, context, budget, changedBy) {
  const db = databaseFor(env, step.database)
  const sql = jobImagesSliceSql(step.table, step.geneColumn)
  for (;;) {
    const limit = Math.min(
      JOB_IMAGE_SLICE_ROWS,
      Math.floor(budget.fetches / OBJECTS_PER_JOB),
      Math.floor(budget.writes / step.weight),
    )
    if (limit < 1 || budget.calls < 2) return false
    const found = await db.prepare(sql).bind(context.userId, limit).all()
    budget.calls -= 1
    const jobs = rowsFrom(found)
    if (!jobs.length) return true
    const keys = new Set()
    for (const job of jobs) {
      if (!Number(job.published)) for (const key of deletableJobImageKeys(job)) keys.add(key)
    }
    if (keys.size && !env?.ICONOPLASM_PORTRAITS?.delete && !canWriteExternalPortraitStorage(env)) {
      throw new Error("Portrait storage is not configured for deletes; cannot erase job images")
    }
    for (const key of keys) {
      await deletePortraitStorageObject(env, key, { maxAttempts: 1 })
      budget.fetches -= 1
    }
    if (keys.size) {
      changedBy.set("job_image_objects", (changedBy.get("job_image_objects") || 0) + keys.size)
    }
    const [result] = await db.batch(
      [
        db
          .prepare(`DELETE FROM ${step.table} WHERE rowid IN (SELECT value FROM json_each(?))`)
          .bind(JSON.stringify(jobs.map((job) => job.k))),
      ],
      { maxRowsWritten: jobs.length * step.weight },
    )
    budget.calls -= 1
    const count = Number(result?.meta?.changes ?? 0)
    spendRowsWritten(budget, result?.meta, count, step.weight)
    changedBy.set(step.id, (changedBy.get(step.id) || 0) + count)
    if (jobs.length < limit) return true
  }
}

// The public ids of the person's emulsions (built from their username). Other people's
// favourites, the picker's rollup rows and published portraits are keyed or labelled by them, and
// the ids are readable only until the accounts-database steps delete the versions, so they are
// read first on every run.
async function readEmulsionIds(env, userId) {
  const found = await env.DB.prepare(
    `SELECT public_id FROM iconoplasm_user_emulsion_versions WHERE user_id = ?
     UNION
     SELECT public_id FROM iconoplasm_user_emulsion_public_slots WHERE user_id = ?`,
  )
    .bind(userId, userId)
    .all()
  return rowsFrom(found)
    .map((row) => String(row.public_id || ""))
    .filter(Boolean)
}

// GeneGuessr keeps a player's game state (guesses, hints, timestamps, results waiting for the
// stats row) in two Durable Objects named after the Discord id. Their reset route deletes all
// storage. Idempotent, and cheap enough to repeat on every run.
async function resetGameSessions(env, userId) {
  const namespace = env?.GAME_SESSIONS
  if (!namespace?.idFromName || !namespace?.get) {
    throw new TypeError("The GAME_SESSIONS binding is required to erase an account")
  }
  for (const name of [`user_${userId}`, `practice_user_${userId}`]) {
    const response = await namespace
      .get(namespace.idFromName(name))
      .fetch("https://sessions/reset", { method: "POST" })
    if (!response.ok) throw new Error(`Game session ${response.status} while erasing an account`)
  }
}

// KV keys that embed the Discord id (last used image model, cached Krea uploads). All of them
// expire on their own (90 and 30 days); the id in the key is the personal part, so they go now.
async function eraseKvKeys(env, userId, services, budget) {
  const kv = env?.KV
  if (!kv || !services?.userKvKeyScopes) return true
  const scopes = services.userKvKeyScopes(userId)
  for (const key of scopes.exact) {
    if (budget.kv < 1) return false
    await kv.delete(key)
    budget.kv -= 1
  }
  for (const prefix of scopes.prefixes) {
    for (;;) {
      if (budget.kv < 2) return false
      const listed = await kv.list({ prefix, limit: Math.min(100, budget.kv - 1) })
      budget.kv -= 1
      const keys = Array.isArray(listed?.keys) ? listed.keys : []
      if (!keys.length) break
      for (const entry of keys) await kv.delete(entry.name)
      budget.kv -= keys.length
      if (listed.list_complete) break
    }
  }
  return true
}

/**
 * Removes the data of every Discord id one account is reachable by, one bounded slice. `complete`
 * is true when every step, the game sessions and the KV keys are finished for all of them.
 */
export async function eraseAccountData(
  env,
  { accountId, discordIds, maxRowsWritten = ERASURE_DEFAULT_ROW_WRITES, skipDiscordMirror = false },
  services = {},
) {
  const label = await brinedewFormerAuthorLabel(accountId)
  // The label ends in ten hex digits of a hash of the account id: stable, anonymous, and valid as
  // an emulsion id.
  const emulsionLabel = `ERASED-${label.slice(-10)}`
  const budget = {
    writes: Math.max(
      ERASURE_MIN_ROW_WRITES,
      Math.min(ERASURE_DEFAULT_ROW_WRITES, Math.trunc(Number(maxRowsWritten) || 0)),
    ),
    calls: ERASURE_MAX_D1_CALLS,
    kv: ERASURE_MAX_KV_OPERATIONS,
    fetches: ERASURE_MAX_EXTERNAL_FETCHES,
    retryAfterSeconds: 0,
    rowsWritten: 0,
  }
  // The comments' copies in the public Discord channel (B-992). A deployment without the bot never
  // mirrored a comment. `skip_discord_mirror` is the operator's way past a Discord that cannot be
  // reached: the response says so, and the posts are then fixed by hand.
  const discord = {
    config: skipDiscordMirror ? null : discordMirrorConfig(env),
    state: skipDiscordMirror
      ? "skipped"
      : discordMirrorConfig(env)
        ? "processed"
        : "not_configured",
  }
  const changedBy = new Map()
  let complete = true
  for (const userId of discordIds) {
    if (budget.calls < 1) {
      complete = false
      break
    }
    const context = { userId, accountId, label, emulsionLabel, emulsionIds: [] }
    context.emulsionIds = await readEmulsionIds(env, userId)
    budget.calls -= 1
    const steps = ERASURE_STEPS.filter(
      (step) => !(step.needsEmulsionIds && !context.emulsionIds.length),
    )
    const pick = (database, scan) =>
      steps.filter(
        (step) =>
          step.database === database &&
          Boolean(step.scan) === scan &&
          !CUSTOM_ACTIONS.has(step.action),
      )
    const comments = steps.find((step) => step.action === "comments")
    // The Iconoplasm database first (the accounts database is about to delete the emulsion ids it
    // needs), indexed steps before unindexed ones, the accounts database next, the cold copy last.
    // The unpublished jobs' stored images go before everything else of the Iconoplasm database
    // (B-993): the generic steps delete the rest of those jobs' rows, and must never see a job
    // whose image is still in the storage.
    let finished = true
    for (const step of steps.filter((candidate) => candidate.action === "job_images")) {
      if (finished) finished = await runJobImagesStep(env, step, context, budget, changedBy)
    }
    if (finished) {
      finished = await runIndexedPasses(
        env,
        "iconoplasm",
        pick("iconoplasm", false),
        context,
        budget,
        changedBy,
      )
    }
    if (finished && comments) {
      finished = await runCommentsStep(env, comments, context, budget, services, changedBy, discord)
    }
    if (finished) {
      finished = await runScanPasses(
        env,
        "iconoplasm",
        pick("iconoplasm", true),
        context,
        budget,
        changedBy,
      )
    }
    if (finished) {
      finished = await runIndexedPasses(
        env,
        "accounts",
        pick("accounts", false),
        context,
        budget,
        changedBy,
      )
    }
    if (finished) {
      finished = await runScanPasses(env, "audit", pick("audit", true), context, budget, changedBy)
    }
    if (finished) {
      await resetGameSessions(env, userId)
      finished = await eraseKvKeys(env, userId, services, budget)
    }
    if (!finished) complete = false
  }
  return {
    complete,
    rows_written: budget.rowsWritten,
    changed: Object.fromEntries([...changedBy].filter(([, count]) => count > 0)),
    discord_mirror: discord.state,
    ...(budget.retryAfterSeconds ? { retry_after_seconds: budget.retryAfterSeconds } : {}),
  }
}

/**
 * The operator command. Repeated with the same `commandId` until `erasure.complete` is true; the
 * completed request replays on any later repeat. Never completes the account while a row keyed
 * by its Discord id remains.
 */
export async function eraseBrinedewAccountOnRequest(
  env,
  {
    accountId: accountIdValue,
    commandId,
    reasonCode = "erasure_request",
    actorAccountId = null,
    now = Date.now(),
    maxRowsWritten,
    skipDiscordMirror = false,
  } = {},
  services = {},
) {
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const db = env?.DB
  const lifecycle = { accountId, commandId, reasonCode, actorAccountId, now }
  const current = await readBrinedewAccount(db, accountId)
  if (!current) {
    throw new BrinedewAccountIdentityError("ACCOUNT_NOT_FOUND", "Brinedew account not found", 404)
  }
  if (current.status === "erased") {
    // A repeat of the completing command replays; a different command refuses.
    const account = await eraseBrinedewAccount(db, lifecycle)
    return { account, erasure: { complete: true, rows_written: 0, changed: {} } }
  }
  await requestBrinedewAccountErasure(db, lifecycle)
  const discordIds = await readBrinedewAccountDiscordSubjects(db, accountId)
  const erasure = await eraseAccountData(
    env,
    { accountId, discordIds, maxRowsWritten, skipDiscordMirror },
    services,
  )
  if (!erasure.complete) {
    return { account: await readBrinedewAccount(db, accountId), erasure }
  }
  await projectBrinedewAccountToManifestationAuthority({
    primaryDb: db,
    authoringDb: env.ICONOPLASM_AUTHORING_DB,
    accountId,
    now: Date.now(),
  })
  return { account: await eraseBrinedewAccount(db, lifecycle), erasure }
}
