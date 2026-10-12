// B-1065: the caretaker panel's text routes, on plain tables of the main database
// (migration 0125), next to the votes and roles. A gene's caretaker texts are rows of icono_caretaker_text_versions,
// grouped into lines (`line_id`, one caretaker's run on one gene). The text the
// gene uses is icono_gene_texts.chosen_caretaker_version_id, or the factory's own
// text when that is empty or withdrawn (lib/iconoplasm-gene-text.js, which the card
// and portrait requests read too).
//
// These routes replace the old authority's caretaker commands: a Bunny body per
// version and per Tags, about eight tables per save, an event per save and a
// projection drain to copy the result back out. The panel's JSON stays the same
// (quartz/static/iconoplasm/caretaker-manifestations-*.js), so a line is still a
// "manifestation" and a version a "revision" on the wire.
//
// Roles (claim, accept, leave, the admin's changes) live in caretaker-roles.js.
import { normalizeManifestationProse } from "../lib/iconoplasm-manifestation-prose.js"
import { normalizeManifestationTags } from "../lib/iconoplasm-manifestation-tags.js"
import { publicGeneText, readGeneText } from "../lib/iconoplasm-gene-text.js"
import { sha256Hex } from "../lib/iconoplasm-sha256.js"
import { authorityError } from "./caretaker/manifestation-authority-contract.js"
import {
  jsonResponse,
  readBoundedJson,
  requireBrowserSession,
  requireStrictSameOriginMutation,
  safeErrorResponse,
} from "./caretaker/manifestation-authority-http-security.js"
import { readCandidateSources } from "./caretaker/manifestation-candidate-sources.js"
import { canonicalManifestationFieldsJson } from "./caretaker/manifestation-tags-payload.js"
import { taggerizerDisabled } from "./caretaker/taggerizer.js"
import {
  caretakerPseudonym,
  caretakerTerms,
  requireSteward,
  resolveGene,
  rolesDb,
  viewerRole,
} from "./caretaker-roles.js"

const HISTORY_PAGE = 20
// The factory's text appears in the panel as one more line, "Original manifestation".
export const FACTORY_LINE_ID = "factory"
const OPEN_STATUSES = new Set(["pending_acceptance", "active", "suspended"])
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
// A save's JSON (prose, Tags and fields) is at most about 16 + 32 KiB.
const SAVE_BODY_LIMIT = 96 * 1024

const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first()
const all = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results || []

async function requireLine(db, gene, lineId) {
  const line = await first(
    db,
    `SELECT line_id FROM icono_caretaker_text_versions WHERE line_id = ? AND gene_symbol = ? LIMIT 1`,
    lineId,
    gene.canonical_symbol,
  )
  if (!line) throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  return line
}

// Withdrawing takes a line's versions (or every version a caretaker role wrote)
// out of use. When one of them was the gene's chosen text, the gene falls back to
// the newest remaining caretaker version with Tags, else to the factory's text.
// The statements run in the caller's batch, after anything else it writes, so
// account erasure and the admin's "withdraw" leave policy share this rule.
export function withdrawCaretakerTextStatements(db, { symbol, lineId, assignmentId, at }) {
  const [column, value] = lineId ? ["line_id", lineId] : ["caretaker_assignment_id", assignmentId]
  if (!symbol || !value)
    throw new TypeError("withdrawCaretakerTextStatements needs a gene and a line or role")
  return [
    db
      .prepare(
        `UPDATE icono_caretaker_text_versions SET withdrawn_at = ?
          WHERE gene_symbol = ? AND ${column} = ? AND withdrawn_at IS NULL`,
      )
      .bind(at, symbol, value),
    db
      .prepare(
        `UPDATE icono_gene_texts
            SET chosen_caretaker_version_id = (
              SELECT version_id FROM icono_caretaker_text_versions
               WHERE gene_symbol = ? AND withdrawn_at IS NULL AND tags IS NOT NULL
               ORDER BY created_at DESC, version_id DESC LIMIT 1),
                updated_at = CURRENT_TIMESTAMP
          WHERE gene_symbol = ? AND chosen_caretaker_version_id IN (
            SELECT version_id FROM icono_caretaker_text_versions
             WHERE gene_symbol = ? AND ${column} = ?)`,
      )
      .bind(symbol, symbol, symbol, value),
  ]
}

async function tagsSha256(tags, fieldsJson) {
  return sha256Hex(new TextEncoder().encode(`${tags}\n${fieldsJson ?? ""}`))
}

async function revisionView(row, viewerAccountId) {
  const hasTags = row.tags != null && String(row.tags).trim() !== ""
  return {
    manifestation_revision_id: row.version_id,
    manifestation_id: row.line_id,
    revision_number: Number(row.version),
    body: row.text,
    body_available: true,
    lifecycle: row.withdrawn_at ? "withdrawn" : "active",
    author_is_viewer: Boolean(row.account_id) && row.account_id === viewerAccountId,
    derivative: hasTags
      ? {
          manifestation_derivative_id: row.version_id,
          status: "accepted",
          tags_sha256: await tagsSha256(row.tags, row.fields_json),
          body_available: true,
        }
      : null,
    generation_provenance: null,
    created_at: row.created_at,
  }
}

// Versions carry their author's name, as every Wikipedia revision does (owner,
// 27 Sep 2026): the account's pseudonym (caretakerPseudonym). A removed account
// never shows it.
async function authorLabels(env, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))]
  const removed = new Set()
  if (ids.length && env?.DB?.prepare) {
    const rows = await all(
      env.DB,
      `SELECT account_id FROM brinedew_accounts
        WHERE account_id IN (${ids.map(() => "?").join(", ")})
          AND status IN ('erasure_pending', 'erased')`,
      ...ids,
    )
    for (const row of rows) removed.add(row.account_id)
  }
  const labels = new Map()
  for (const id of ids)
    labels.set(id, removed.has(id) ? "Removed account" : await caretakerPseudonym(id))
  return labels
}

function authorLabel(labels, accountId, viewerAccountId) {
  if (!accountId) return "Original manifestation"
  if (accountId === viewerAccountId) return "You"
  return labels.get(accountId) || "Anonymous caretaker"
}

function decodeCursor(raw) {
  if (!raw) return null
  try {
    const value = JSON.parse(atob(String(raw).replaceAll("-", "+").replaceAll("_", "/")))
    if (typeof value?.c === "string" && typeof value?.v === "string") return value
  } catch {}
  throw authorityError("INVALID_CURSOR", "History cursor is invalid")
}

function encodeCursor(row) {
  return btoa(JSON.stringify({ c: row.created_at, v: row.version_id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
}

const VERSION_COLUMNS = `version_id, line_id, version, account_id, text, tags, fields_json,
  withdrawn_at, created_at`

export async function readCaretakerTextDossier(env, { geneLocator, accountId, cursor }) {
  const db = rolesDb(env)
  const gene = await resolveGene(db, geneLocator)
  const symbol = gene.canonical_symbol
  const assignment = await viewerRole(db, symbol, accountId)
  if (!assignment) return { enabled: false }
  const steward = assignment.status === "active"
  const page = decodeCursor(cursor)
  const [factory, lineRows, pageRows, count, current] = await Promise.all([
    first(
      db,
      `SELECT text_id, version, text, tags, fields_json, readers_see, updated_at
         FROM icono_gene_texts WHERE gene_symbol = ?`,
      symbol,
    ),
    // Each line with its newest version, which holds the line's state.
    all(
      db,
      `SELECT v.line_id, v.account_id, v.caretaker_assignment_id, v.version_id AS head_id,
              v.readers_see, v.withdrawn_at,
              (SELECT MIN(f.created_at) FROM icono_caretaker_text_versions f
                WHERE f.line_id = v.line_id) AS created_at
         FROM icono_caretaker_text_versions v
        WHERE v.gene_symbol = ?
          AND v.version = (SELECT MAX(m.version) FROM icono_caretaker_text_versions m
                            WHERE m.line_id = v.line_id)
        ORDER BY created_at, v.line_id`,
      symbol,
    ),
    all(
      db,
      `SELECT ${VERSION_COLUMNS} FROM icono_caretaker_text_versions
        WHERE gene_symbol = ?
          AND (? IS NULL OR created_at < ? OR (created_at = ? AND version_id < ?))
        ORDER BY created_at DESC, version_id DESC
        LIMIT ${HISTORY_PAGE + 1}`,
      symbol,
      page?.c ?? null,
      page?.c ?? null,
      page?.c ?? null,
      page?.v ?? null,
    ),
    first(
      db,
      `SELECT COUNT(*) AS total FROM icono_caretaker_text_versions WHERE gene_symbol = ?`,
      symbol,
    ),
    readGeneText(db, symbol),
  ])
  const shown = pageRows.slice(0, HISTORY_PAGE)
  const canonicalId = current?.text_id || ""
  const currentRole = (line) =>
    steward && line.caretaker_assignment_id === assignment.caretaker_assignment_id
  // A role can hold an older withdrawn line and a newer one; the newest is its own.
  const ownLine = lineRows.findLast(currentRole)
  // The chosen text and the caretaker's own newest version always reach the
  // panel, even when they sit beyond the loaded page of History.
  const shownIds = new Set(shown.map((row) => row.version_id))
  const missing = [canonicalId, ownLine?.head_id].filter(
    (id) => id && id !== factory?.text_id && !shownIds.has(id),
  )
  const pinnedRows = missing.length
    ? await all(
        db,
        `SELECT ${VERSION_COLUMNS} FROM icono_caretaker_text_versions
          WHERE gene_symbol = ? AND version_id IN (${missing.map(() => "?").join(", ")})`,
        symbol,
        ...missing,
      )
    : []
  const viewerId = accountId
  const revisions = await Promise.all(shown.map((row) => revisionView(row, viewerId)))
  const pinned = await Promise.all(pinnedRows.map((row) => revisionView(row, viewerId)))
  if (factory) {
    pinned.push(
      await revisionView(
        {
          version_id: factory.text_id,
          line_id: FACTORY_LINE_ID,
          version: factory.version,
          account_id: null,
          text: factory.text,
          tags: factory.tags,
          fields_json: factory.fields_json,
          withdrawn_at: null,
          created_at: factory.updated_at,
        },
        viewerId,
      ),
    )
  }
  const chosenLine = lineRows.find((line) =>
    [...revisions, ...pinned].some(
      (revision) =>
        revision.manifestation_revision_id === canonicalId &&
        revision.manifestation_id === line.line_id,
    ),
  )
  let fallbackLabel = "the current canonical manifestation"
  if (ownLine && chosenLine?.line_id === ownLine.line_id) {
    const fallback = await first(
      db,
      `SELECT version_id FROM icono_caretaker_text_versions
        WHERE gene_symbol = ? AND line_id <> ? AND withdrawn_at IS NULL AND tags IS NOT NULL
        LIMIT 1`,
      symbol,
      ownLine.line_id,
    )
    fallbackLabel = fallback ? "an earlier caretaker manifestation" : "Original manifestation"
  }
  const labels = await authorLabels(
    env,
    lineRows.map((line) => line.account_id),
  )
  const manifestations = []
  if (factory) {
    manifestations.push({
      manifestation_id: FACTORY_LINE_ID,
      origin: "system_seed",
      status: "active",
      manifestation_head_revision_id: factory.text_id,
      row_version: Number(factory.version),
      non_withdrawable: true,
      public_page_visible: Number(factory.readers_see) === 1,
      author_is_viewer: false,
      belongs_to_current_assignment: false,
      author_label: "Original manifestation",
      can_withdraw: false,
      can_restore: false,
      created_at: factory.updated_at,
      withdrawal_preview: null,
      revisions: [],
    })
  }
  for (const line of lineRows) {
    const withdrawn = Boolean(line.withdrawn_at)
    const own = line.account_id === viewerId
    manifestations.push({
      manifestation_id: line.line_id,
      origin: "caretaker",
      status: withdrawn ? "withdrawn" : "active",
      manifestation_head_revision_id: line.head_id,
      row_version: 1,
      non_withdrawable: false,
      public_page_visible: Number(line.readers_see) === 1,
      author_is_viewer: own,
      belongs_to_current_assignment: currentRole(line),
      author_label: authorLabel(labels, line.account_id, viewerId),
      can_withdraw: steward && !withdrawn,
      can_restore: steward && withdrawn,
      created_at: line.created_at,
      withdrawal_preview: own ? { fallback_label: fallbackLabel } : null,
      revisions: revisions.filter((revision) => revision.manifestation_id === line.line_id),
    })
  }
  const terms = assignment.status === "pending_acceptance" ? caretakerTerms() : null
  return {
    schema_version: 1,
    enabled: true,
    gene: {
      gene_id: gene.gene_id,
      symbol: gene.canonical_symbol,
      status: gene.status,
      merged_into_symbol: null,
      aliases: gene.aliases,
    },
    assignment: {
      caretaker_assignment_id: assignment.caretaker_assignment_id,
      status: assignment.status,
      assignment_version: Number(assignment.assignment_version),
      terms: terms
        ? {
            terms_version_id: terms.terms_version_id,
            document_url: terms.document_url,
            display_label: terms.display_label,
            content_sha256: terms.terms_sha256,
            effective_at: terms.effective_at,
          }
        : null,
      withdrawal_preview: ownLine ? { fallback_label: fallbackLabel } : null,
    },
    viewer: {
      is_caretaker: OPEN_STATUSES.has(assignment.status),
      can_accept: assignment.status === "pending_acceptance",
      can_decline: assignment.status === "pending_acceptance",
      can_edit: steward,
      suspended: assignment.status === "suspended",
    },
    head: {
      head_version: 0,
      canonical_selection_id: "",
      canonical_revision_id: canonicalId,
      gene_revision: 0,
    },
    pinned_revisions: pinned,
    manifestations,
    history: {
      total_count: Number(count?.total || 0),
      next_cursor: pageRows.length > HISTORY_PAGE ? encodeCursor(shown.at(-1)) : null,
    },
  }
}

// The Tags of one version (or of the factory's text), for the editor.
export async function readCaretakerTextTags(env, { geneLocator, accountId, versionId }) {
  const db = rolesDb(env)
  const gene = await resolveGene(db, geneLocator)
  if (!(await viewerRole(db, gene.canonical_symbol, accountId)))
    throw authorityError("GENE_DOSSIER_FORBIDDEN", "A caretaker relationship is required", 403)
  const row =
    (await first(
      db,
      `SELECT tags, fields_json FROM icono_caretaker_text_versions
        WHERE gene_symbol = ? AND version_id = ?`,
      gene.canonical_symbol,
      versionId,
    )) ||
    (await first(
      db,
      `SELECT tags, fields_json FROM icono_gene_texts WHERE gene_symbol = ? AND text_id = ?`,
      gene.canonical_symbol,
      versionId,
    ))
  if (!row) throw authorityError("DERIVATIVE_NOT_FOUND", "Derivative was not found", 404)
  if (row.tags == null || !String(row.tags).trim())
    throw authorityError("DERIVATIVE_BODY_UNAVAILABLE", "Derivative body is unavailable", 410)
  return {
    manifestation_derivative_id: versionId,
    manifestation_revision_id: versionId,
    tags: {
      tags_text: row.tags,
      tags_sha256: await sha256Hex(new TextEncoder().encode(row.tags)),
      fields_json: row.fields_json ? JSON.parse(row.fields_json) : {},
    },
  }
}

function invalid(code, error) {
  return authorityError(code, String(error?.message || error), 400)
}

function readCommandId(body) {
  const commandId = String(body?.command_id || "").trim()
  if (!COMMAND_ID.test(commandId))
    throw authorityError("COMMAND_ID_REQUIRED", "A command_id is required", 400)
  return commandId
}

// A version's ID comes from its author and the panel's command ID, so a retried
// autosave (same command ID, B-874) finds the version it already saved.
async function versionIdFor(accountId, commandId) {
  const digest = await sha256Hex(
    new TextEncoder().encode(`iconoplasm.caretaker-save\n${accountId}\n${commandId}`),
  )
  return `revision_${digest.slice(0, 48)}`
}

function newLineId() {
  return `manifestation_${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 16)}`
}

function isConstraintError(error) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(error?.message || error))
}

export async function saveCaretakerText(env, { geneLocator, accountId, body, withTags }) {
  const db = rolesDb(env)
  const { gene, assignment } = await requireSteward(db, geneLocator, accountId)
  const commandId = readCommandId(body)
  let prose
  try {
    prose = normalizeManifestationProse(body.prose)
  } catch (error) {
    throw invalid("PROSE_INVALID", error)
  }
  let tags = null
  let fieldsJson = null
  if (withTags) {
    if (!String(body.tags_text || "").trim())
      throw authorityError("TAGS_REQUIRED", "A save with Tags needs at least one tag", 400)
    try {
      tags = normalizeManifestationTags(String(body.tags_text)).tags
    } catch (error) {
      throw invalid("TAGS_INVALID", error)
    }
    try {
      fieldsJson = canonicalManifestationFieldsJson(body.fields_json ?? {})
    } catch (error) {
      throw invalid("FIELDS_INVALID", error)
    }
  }
  const versionId = await versionIdFor(accountId, commandId)
  const saved = await first(
    db,
    `SELECT line_id FROM icono_caretaker_text_versions WHERE version_id = ?`,
    versionId,
  )
  if (saved)
    return {
      gene,
      ok: true,
      replayed: true,
      manifestation_revision_id: versionId,
      manifestation_id: saved.line_id,
    }
  // The role's latest line, unless it was withdrawn: new writing after a
  // withdrawal starts a line of its own.
  const latest = await first(
    db,
    `SELECT line_id, withdrawn_at FROM icono_caretaker_text_versions
      WHERE gene_symbol = ? AND caretaker_assignment_id = ?
      ORDER BY created_at DESC, version DESC LIMIT 1`,
    gene.canonical_symbol,
    assignment.caretaker_assignment_id,
  )
  const lineId = latest && !latest.withdrawn_at ? latest.line_id : newLineId()
  const at = new Date().toISOString()
  const statements = [
    // Numbered within the line in the statement itself; UNIQUE (line_id, version)
    // makes two racing saves end with one winner. A new version keeps the line's
    // readers-see flag.
    db
      .prepare(
        `INSERT INTO icono_caretaker_text_versions
           (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
            text, text_sha256, tags, fields_json, readers_see, created_at)
         SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?,
                COALESCE((SELECT readers_see FROM icono_caretaker_text_versions
                           WHERE line_id = ? ORDER BY version DESC LIMIT 1), 0), ?
           FROM icono_caretaker_text_versions WHERE line_id = ?`,
      )
      .bind(
        versionId,
        gene.canonical_symbol,
        lineId,
        accountId,
        assignment.caretaker_assignment_id,
        prose.prose,
        await sha256Hex(prose.bytes),
        tags,
        fieldsJson,
        lineId,
        at,
        lineId,
      ),
  ]
  // B-874: a save with Tags is what new images are drawn from.
  if (withTags)
    statements.push(
      db
        .prepare(
          `UPDATE icono_gene_texts SET chosen_caretaker_version_id = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE gene_symbol = ?`,
        )
        .bind(versionId, gene.canonical_symbol),
    )
  await runWrite(db, statements)
  return { ok: true, manifestation_revision_id: versionId, manifestation_id: lineId, gene }
}

async function runWrite(db, statements) {
  try {
    await db.batch(statements)
  } catch (error) {
    if (!isConstraintError(error)) throw error
    throw authorityError(
      "TEXT_VERSION_CONFLICT",
      "Another save of this text landed first; reload and save again",
      409,
    )
  }
}

export async function withdrawCaretakerLine(env, { geneLocator, accountId, lineId }) {
  const db = rolesDb(env)
  const { gene } = await requireSteward(db, geneLocator, accountId)
  if (lineId === FACTORY_LINE_ID)
    throw authorityError("MANIFESTATION_NOT_WITHDRAWABLE", "The original text stays", 409)
  await requireLine(db, gene, lineId)
  await runWrite(
    db,
    withdrawCaretakerTextStatements(db, {
      symbol: gene.canonical_symbol,
      lineId,
      at: new Date().toISOString(),
    }),
  )
  return { ok: true, manifestation_id: lineId, gene }
}

// Restoring brings back the versions withdrawn with the line's newest one and
// makes the line the gene's text again ("restored and made canonical").
export async function restoreCaretakerLine(env, { geneLocator, accountId, lineId }) {
  const db = rolesDb(env)
  const { gene } = await requireSteward(db, geneLocator, accountId)
  await requireLine(db, gene, lineId)
  const head = await first(
    db,
    `SELECT withdrawn_at FROM icono_caretaker_text_versions
      WHERE line_id = ? ORDER BY version DESC LIMIT 1`,
    lineId,
  )
  const statements = []
  if (head?.withdrawn_at)
    statements.push(
      db
        .prepare(
          `UPDATE icono_caretaker_text_versions SET withdrawn_at = NULL
            WHERE line_id = ? AND withdrawn_at = ?`,
        )
        .bind(lineId, head.withdrawn_at),
    )
  statements.push(
    db
      .prepare(
        `UPDATE icono_gene_texts
            SET chosen_caretaker_version_id = COALESCE((
              SELECT version_id FROM icono_caretaker_text_versions
               WHERE line_id = ? AND withdrawn_at IS NULL AND tags IS NOT NULL
               ORDER BY version DESC LIMIT 1), chosen_caretaker_version_id),
                updated_at = CURRENT_TIMESTAMP
          WHERE gene_symbol = ?`,
      )
      .bind(lineId, gene.canonical_symbol),
  )
  await runWrite(db, statements)
  return { ok: true, manifestation_id: lineId, gene }
}

export async function setCaretakerLineVisibility(env, { geneLocator, accountId, lineId, body }) {
  const db = rolesDb(env)
  const { gene } = await requireSteward(db, geneLocator, accountId)
  if (typeof body?.visible !== "boolean")
    throw authorityError("VISIBLE_REQUIRED", "visible must be true or false", 400)
  await requireLine(db, gene, lineId)
  await runWrite(db, [
    db
      .prepare(`UPDATE icono_caretaker_text_versions SET readers_see = ? WHERE line_id = ?`)
      .bind(body.visible ? 1 : 0, lineId),
  ])
  return { ok: true, manifestation_id: lineId, gene }
}

const GENE = "/api/iconoplasm/caretaker/genes/:gene"

// The panel's routes. `caretakerSession` resolves the signed-in Brinedew account
// (it 401s without one); `publishGene` rebuilds the gene's published card.
export function registerCaretakerTextRoutes(app, { caretakerSession, publishGene }) {
  const session = async (c) =>
    (await requireBrowserSession(c.req.raw, c.env, caretakerSession)).accountId

  // The card shows a caretaker text only while readers may see it, so it is
  // rebuilt only when what readers see changes, not on every autosave of a
  // hidden text. A failed rebuild tells the panel the public view is behind.
  async function publicText(env, symbol) {
    return publicGeneText(await readGeneText(rolesDb(env), symbol))
  }
  async function write(c, run) {
    try {
      requireStrictSameOriginMutation(c.req.raw)
      const accountId = await session(c)
      const parsed = await readBoundedJson(c.req.raw, SAVE_BODY_LIMIT)
      const geneLocator = decodeURIComponent(c.req.param("gene"))
      const symbolBefore = (await resolveGene(rolesDb(c.env), geneLocator)).canonical_symbol
      const before = await publicText(c.env, symbolBefore)
      const { gene, ...result } = await run({ geneLocator, accountId, body: parsed.value })
      const after = await publicText(c.env, gene.canonical_symbol)
      let pending = false
      if (before?.prose !== after?.prose) {
        try {
          await publishGene(c.env, gene.canonical_symbol)
        } catch (error) {
          console.error("[ICONOPLASM_CARETAKER_CARD_REPUBLISH]", gene.canonical_symbol, error)
          pending = true
        }
      }
      return jsonResponse(pending ? { ...result, projection_pending: true } : result)
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
  const line = (c) => decodeURIComponent(c.req.param("line"))

  app.get(GENE, async (c) => {
    try {
      const accountId = await session(c)
      const dossier = await readCaretakerTextDossier(c.env, {
        geneLocator: decodeURIComponent(c.req.param("gene")),
        accountId,
        cursor: c.req.query("history_cursor"),
      })
      if (!dossier.enabled) return jsonResponse(dossier)
      // B-724: which saved version made each candidate image; null when unreadable.
      const sources = await readCandidateSources(c.env?.ICONOPLASM_DB, dossier.gene.symbol)
      return jsonResponse({
        ...dossier,
        taggerizer_enabled: !taggerizerDisabled(c.env),
        ...(sources ? { candidate_sources: sources } : {}),
      })
    } catch (error) {
      return safeErrorResponse(error)
    }
  })
  app.get(`${GENE}/derivatives/:version/body`, async (c) => {
    try {
      return jsonResponse(
        await readCaretakerTextTags(c.env, {
          geneLocator: decodeURIComponent(c.req.param("gene")),
          accountId: await session(c),
          versionId: decodeURIComponent(c.req.param("version")),
        }),
      )
    } catch (error) {
      return safeErrorResponse(error)
    }
  })
  app.post(`${GENE}/saves`, (c) =>
    write(c, (input) => saveCaretakerText(c.env, { ...input, withTags: true })),
  )
  app.post(`${GENE}/revisions`, (c) =>
    write(c, (input) => saveCaretakerText(c.env, { ...input, withTags: false })),
  )
  app.delete(`${GENE}/manifestations/:line`, (c) =>
    write(c, (input) => withdrawCaretakerLine(c.env, { ...input, lineId: line(c) })),
  )
  app.post(`${GENE}/manifestations/:line/restore`, (c) =>
    write(c, (input) => restoreCaretakerLine(c.env, { ...input, lineId: line(c) })),
  )
  app.post(`${GENE}/manifestations/:line/page-visibility`, (c) =>
    write(c, (input) => setCaretakerLineVisibility(c.env, { ...input, lineId: line(c) })),
  )
}
