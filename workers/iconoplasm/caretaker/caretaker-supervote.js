export const CARETAKER_SUPERVOTE_WEIGHT = 10
export const CARETAKER_SUPERVOTE_HISTORY_LIMIT = 100

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ASSIGNMENT_STATUSES = new Set(["pending_acceptance", "active", "suspended", "ended"])

export class CaretakerSupervoteError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = "CaretakerSupervoteError"
    this.code = code
    this.status = status
  }
}

function fail(code, message, status = 400) {
  throw new CaretakerSupervoteError(code, message, status)
}

function normalizeId(value, field) {
  const normalized = String(value || "").trim()
  if (!ID_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  return normalized
}

function normalizeSymbol(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", "gene_symbol is invalid")
  return normalized
}

function normalizeSha256(value, { optional = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (optional && !normalized) return null
  if (!SHA256_PATTERN.test(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "asset_sha256 is invalid")
  }
  return normalized
}

function normalizeVersion(value, field, { minimum = 0 } = {}) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  }
  return normalized
}

function normalizeRequestSha256(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "request_sha256 is invalid")
  }
  return normalized
}

function normalizeReason(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .slice(0, 2000)
}

function first(sql, query, ...bindings) {
  return sql.exec(query, ...bindings).toArray()[0] || null
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""))
  } catch {
    return fallback
  }
}

function normalizeAssignmentEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === "object" ? rawEvent : {}
  const gene = event.gene && typeof event.gene === "object" ? event.gene : {}
  const assignment =
    event.assignment && typeof event.assignment === "object" ? event.assignment : {}
  const status = String(assignment.status || event.assignment_status || "")
    .trim()
    .toLowerCase()
  if (!ASSIGNMENT_STATUSES.has(status)) {
    fail("INVALID_ASSIGNMENT_PROJECTION", "Assignment status is invalid")
  }
  return {
    event_id: normalizeId(event.event_id || event.event_uuid, "event_id"),
    event_sequence: normalizeVersion(event.event_sequence, "event_sequence", { minimum: 1 }),
    gene_id: normalizeId(gene.gene_id || event.gene_id, "gene_id"),
    gene_symbol: normalizeSymbol(
      gene.canonical_symbol || gene.symbol || event.canonical_symbol || event.gene_symbol,
    ),
    caretaker_assignment_id: normalizeId(
      assignment.caretaker_assignment_id || event.caretaker_assignment_id,
      "caretaker_assignment_id",
    ),
    caretaker_account_id: normalizeId(
      assignment.account_id || event.caretaker_account_id || event.account_id,
      "caretaker_account_id",
    ),
    status,
    assignment_version: normalizeVersion(
      assignment.assignment_version ?? event.assignment_version,
      "assignment_version",
      { minimum: 1 },
    ),
  }
}

function normalizeEligibilityEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === "object" ? rawEvent : {}
  const eligible = Number(event.eligible)
  if (eligible !== 0 && eligible !== 1) {
    fail("INVALID_ELIGIBILITY_PROJECTION", "Candidate eligibility must be explicit")
  }
  const eventSequence = normalizeVersion(event.source_event_sequence, "source_event_sequence", {
    minimum: 1,
  })
  return {
    event_id: normalizeId(
      event.event_id || `candidate-eligibility:${eventSequence}`,
      "eligibility_event_id",
    ),
    event_sequence: eventSequence,
    gene_symbol: normalizeSymbol(event.gene_symbol),
    asset_sha256: normalizeSha256(event.asset_sha256),
    eligibility_version: normalizeVersion(event.eligibility_version, "eligibility_version", {
      minimum: 1,
    }),
    eligible: Boolean(eligible),
    reason: normalizeReason(event.reason || event.source_status, "Candidate eligibility changed"),
  }
}

function assignmentEventType(previousStatus, nextStatus) {
  if (nextStatus === "ended") return "assignment_ended"
  if (nextStatus === "suspended") return "assignment_suspended"
  if (previousStatus === "suspended" && nextStatus === "active") return "assignment_resumed"
  return "assignment_projected"
}

function activeSelection(assignment, head) {
  return Boolean(
    head?.asset_sha256 &&
    assignment &&
    ["active", "suspended"].includes(String(assignment.status || "")),
  )
}

function assignmentSnapshot(row) {
  if (!row) return null
  return {
    gene_id: String(row.gene_id),
    gene_symbol: String(row.gene_symbol),
    caretaker_assignment_id: String(row.caretaker_assignment_id),
    caretaker_account_id: String(row.caretaker_account_id),
    status: String(row.status),
    assignment_version: Number(row.assignment_version),
    authority_event_id: String(row.authority_event_id),
    authority_event_sequence: Number(row.authority_event_sequence),
  }
}

function supervoteSnapshot(assignment, head, viewerAccountId = "") {
  const selected = activeSelection(assignment, head)
  const accountId = String(viewerAccountId || "").trim()
  return {
    schema_version: 1,
    assignment: assignmentSnapshot(assignment),
    assignment_status: assignment ? String(assignment.status) : null,
    assignment_version: Number(assignment?.assignment_version || 0),
    accepted_event_sequence: Number(assignment?.authority_event_sequence || 0),
    supervote_version: Number(head?.supervote_version || 0),
    asset_sha256: selected ? String(head.asset_sha256) : null,
    active: selected,
    suspended: String(assignment?.status || "") === "suspended",
    weight: CARETAKER_SUPERVOTE_WEIGHT,
    can_mutate: Boolean(
      assignment && assignment.status === "active" && accountId === assignment.caretaker_account_id,
    ),
  }
}

function outboxPayload({
  mutationId,
  eventType,
  commandId = null,
  requestSha256 = null,
  assignment,
  head,
  fromAssetSha256 = null,
  toAssetSha256 = null,
  response = null,
  recomputeRequired = true,
}) {
  return JSON.stringify({
    schema_version: 1,
    mutation_id: mutationId,
    event_type: eventType,
    command_id: commandId,
    request_sha256: requestSha256,
    assignment: assignmentSnapshot(assignment),
    supervote: supervoteSnapshot(assignment, head),
    from_asset_sha256: fromAssetSha256,
    to_asset_sha256: toAssetSha256,
    response,
    recompute_required: recomputeRequired,
  })
}

export async function caretakerSupervoteRequestSha256(fields) {
  const source = fields && typeof fields === "object" ? fields : {}
  const canonical = JSON.stringify({
    command_id: String(source.command_id || ""),
    gene_symbol: normalizeSymbol(source.gene_symbol),
    caretaker_account_id: normalizeId(source.caretaker_account_id, "caretaker_account_id"),
    asset_sha256: normalizeSha256(source.asset_sha256, { optional: true }),
    expected_assignment_version: normalizeVersion(
      source.expected_assignment_version,
      "expected_assignment_version",
      { minimum: 1 },
    ),
    expected_supervote_version: normalizeVersion(
      source.expected_supervote_version,
      "expected_supervote_version",
    ),
  })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export function caretakerWeightedScore(row) {
  const ordinaryScore = Number(row?.score ?? row?.image_score ?? 0) || 0
  return ordinaryScore + (row?.caretaker_supervote ? CARETAKER_SUPERVOTE_WEIGHT : 0)
}

export function compareCaretakerWeightedCandidates(left, right, fallback = () => 0) {
  return (
    caretakerWeightedScore(right) - caretakerWeightedScore(left) ||
    Number(Boolean(right?.caretaker_supervote)) - Number(Boolean(left?.caretaker_supervote)) ||
    fallback(left, right)
  )
}

export class CaretakerSupervoteLedger {
  constructor({ storage, getSymbol, armAlarm } = {}) {
    if (!storage?.sql || typeof storage.transactionSync !== "function") {
      throw new TypeError("Durable Object SQL storage is required")
    }
    if (typeof getSymbol !== "function") throw new TypeError("getSymbol is required")
    this.storage = storage
    this.sql = storage.sql
    this.getSymbol = getSymbol
    this.armAlarm = typeof armAlarm === "function" ? armAlarm : async () => {}
  }

  install() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS caretaker_assignment_projection (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        gene_id TEXT NOT NULL,
        gene_symbol TEXT NOT NULL,
        caretaker_assignment_id TEXT NOT NULL,
        caretaker_account_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending_acceptance', 'active', 'suspended', 'ended')
        ),
        assignment_version INTEGER NOT NULL CHECK (assignment_version >= 1),
        authority_event_id TEXT NOT NULL,
        authority_event_sequence INTEGER NOT NULL CHECK (authority_event_sequence >= 1),
        projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS caretaker_supervote_head (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        caretaker_assignment_id TEXT,
        caretaker_account_id TEXT,
        asset_sha256 TEXT,
        supervote_version INTEGER NOT NULL DEFAULT 0 CHECK (supervote_version >= 0),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO caretaker_supervote_head (singleton) VALUES (1);
      CREATE TABLE IF NOT EXISTS caretaker_supervote_command_receipts (
        command_id TEXT PRIMARY KEY,
        request_sha256 TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS caretaker_supervote_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        command_id TEXT,
        request_sha256 TEXT,
        caretaker_assignment_id TEXT NOT NULL,
        caretaker_account_id TEXT NOT NULL,
        assignment_status TEXT NOT NULL,
        assignment_version INTEGER NOT NULL,
        from_asset_sha256 TEXT,
        to_asset_sha256 TEXT,
        supervote_version INTEGER NOT NULL,
        authority_event_id TEXT,
        authority_event_sequence INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS caretaker_supervote_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_caretaker_supervote_outbox_pending
        ON caretaker_supervote_outbox (delivered_at, id);
      CREATE TABLE IF NOT EXISTS caretaker_supervote_asset_eligibility (
        asset_sha256 TEXT PRIMARY KEY,
        eligibility_version INTEGER NOT NULL CHECK (eligibility_version >= 1),
        eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
        source_event_id TEXT NOT NULL,
        source_event_sequence INTEGER NOT NULL UNIQUE CHECK (source_event_sequence >= 1),
        reason TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  readAssignment() {
    return first(
      this.sql,
      `SELECT gene_id, gene_symbol, caretaker_assignment_id, caretaker_account_id,
              status, assignment_version, authority_event_id, authority_event_sequence
         FROM caretaker_assignment_projection
        WHERE singleton = 1`,
    )
  }

  readHead() {
    return (
      first(
        this.sql,
        `SELECT caretaker_assignment_id, caretaker_account_id, asset_sha256,
                supervote_version, updated_at
           FROM caretaker_supervote_head
          WHERE singleton = 1`,
      ) || { supervote_version: 0, asset_sha256: null }
    )
  }

  snapshot(viewerAccountId = "") {
    return supervoteSnapshot(this.readAssignment(), this.readHead(), viewerAccountId)
  }

  compactHistory() {
    this.sql.exec(
      `DELETE FROM caretaker_supervote_audit
        WHERE id NOT IN (
          SELECT id
            FROM caretaker_supervote_audit
           ORDER BY id DESC
           LIMIT ?
        )`,
      CARETAKER_SUPERVOTE_HISTORY_LIMIT,
    )
    this.sql.exec(
      `DELETE FROM caretaker_supervote_command_receipts
        WHERE command_id NOT IN (
          SELECT command_id
            FROM caretaker_supervote_audit
           WHERE command_id IS NOT NULL
        )`,
    )
    this.sql.exec(
      `DELETE FROM caretaker_supervote_outbox
        WHERE delivered_at IS NOT NULL
          AND id NOT IN (
            SELECT id
              FROM caretaker_supervote_outbox
             WHERE delivered_at IS NOT NULL
             ORDER BY id DESC
             LIMIT ?
          )`,
      CARETAKER_SUPERVOTE_HISTORY_LIMIT,
    )
  }

  decorateSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {}
    const selectedAsset = this.snapshot().asset_sha256
    const isSelected = Boolean(
      selectedAsset && normalizeSha256(source.asset_sha256, { optional: true }) === selectedAsset,
    )
    return {
      ...source,
      caretaker_supervote: isSelected,
      caretaker_supervote_weight: isSelected ? CARETAKER_SUPERVOTE_WEIGHT : 0,
      weighted_score:
        Number(source.image_score || 0) + (isSelected ? CARETAKER_SUPERVOTE_WEIGHT : 0),
    }
  }

  decorateAssetSummaries(rows) {
    const selectedAsset = this.snapshot().asset_sha256
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const selected = Boolean(selectedAsset && row?.asset_sha256 === selectedAsset)
      return {
        ...row,
        caretaker_supervote: selected,
        caretaker_supervote_weight: selected ? CARETAKER_SUPERVOTE_WEIGHT : 0,
        weighted_score: Number(row?.score || 0) + (selected ? CARETAKER_SUPERVOTE_WEIGHT : 0),
      }
    })
  }

  async projectAssignment(rawEvent) {
    const event = normalizeAssignmentEvent(rawEvent)
    const coordinatorSymbol = normalizeSymbol(this.getSymbol() || event.gene_symbol)
    if (coordinatorSymbol !== event.gene_symbol) {
      fail("ASSIGNMENT_GENE_MISMATCH", "Assignment event belongs to another gene", 409)
    }
    await this.armAlarm(1)
    return this.storage.transactionSync(() => {
      const current = this.readAssignment()
      const head = this.readHead()
      if (current) {
        const currentSequence = Number(current.authority_event_sequence)
        if (event.event_sequence === currentSequence) {
          if (event.event_id !== current.authority_event_id) {
            fail("ASSIGNMENT_EVENT_CONFLICT", "Event sequence already has another event", 409)
          }
          return { ok: true, changed: false, replayed: true, snapshot: this.snapshot() }
        }
        if (event.event_sequence < currentSequence) {
          fail("STALE_ASSIGNMENT_EVENT", "Assignment projection cannot move backward", 409)
        }
        if (event.gene_id !== current.gene_id) {
          fail("ASSIGNMENT_GENE_MISMATCH", "Stable gene identity changed", 409)
        }
        if (
          event.caretaker_assignment_id === current.caretaker_assignment_id &&
          event.assignment_version === Number(current.assignment_version)
        ) {
          if (
            event.caretaker_account_id !== current.caretaker_account_id ||
            event.status !== current.status ||
            event.gene_symbol !== current.gene_symbol
          ) {
            fail(
              "ASSIGNMENT_SNAPSHOT_CONFLICT",
              "Assignment version already represents different authority state",
              409,
            )
          }
          return {
            ok: true,
            changed: false,
            replayed: true,
            snapshot: this.snapshot(),
          }
        }
        if (
          event.caretaker_assignment_id === current.caretaker_assignment_id &&
          event.assignment_version < Number(current.assignment_version)
        ) {
          fail("STALE_ASSIGNMENT_EVENT", "Assignment version cannot move backward", 409)
        }
        if (
          event.caretaker_assignment_id !== current.caretaker_assignment_id &&
          current.status !== "ended"
        ) {
          fail(
            "ASSIGNMENT_REPLACEMENT_CONFLICT",
            "Open assignment must end before replacement",
            409,
          )
        }
      }

      const previousStatus = String(current?.status || "")
      const previousAsset = normalizeSha256(head?.asset_sha256, { optional: true })
      const assignmentChanged =
        current && event.caretaker_assignment_id !== current.caretaker_assignment_id
      const mustDeactivate = event.status === "ended" || assignmentChanged
      const nextAsset = mustDeactivate ? null : previousAsset
      const nextVersion =
        Number(head?.supervote_version || 0) + Number(Boolean(previousAsset && mustDeactivate))
      const mutationId = `caretaker-assignment:${event.event_id}`
      const eventType = assignmentEventType(previousStatus, event.status)

      this.sql.exec(
        `INSERT INTO caretaker_assignment_projection (
           singleton, gene_id, gene_symbol, caretaker_assignment_id,
           caretaker_account_id, status, assignment_version,
           authority_event_id, authority_event_sequence, projected_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(singleton) DO UPDATE SET
           gene_id = excluded.gene_id,
           gene_symbol = excluded.gene_symbol,
           caretaker_assignment_id = excluded.caretaker_assignment_id,
           caretaker_account_id = excluded.caretaker_account_id,
           status = excluded.status,
           assignment_version = excluded.assignment_version,
           authority_event_id = excluded.authority_event_id,
           authority_event_sequence = excluded.authority_event_sequence,
           projected_at = CURRENT_TIMESTAMP`,
        event.gene_id,
        event.gene_symbol,
        event.caretaker_assignment_id,
        event.caretaker_account_id,
        event.status,
        event.assignment_version,
        event.event_id,
        event.event_sequence,
      )
      this.sql.exec(
        `UPDATE caretaker_supervote_head
            SET caretaker_assignment_id = ?, caretaker_account_id = ?,
                asset_sha256 = ?, supervote_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE singleton = 1`,
        event.caretaker_assignment_id,
        event.caretaker_account_id,
        nextAsset,
        nextVersion,
      )
      const assignment = this.readAssignment()
      const nextHead = this.readHead()
      this.sql.exec(
        `INSERT INTO caretaker_supervote_audit (
           mutation_id, event_type, caretaker_assignment_id, caretaker_account_id,
           assignment_status, assignment_version, from_asset_sha256, to_asset_sha256,
           supervote_version, authority_event_id, authority_event_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        mutationId,
        eventType,
        event.caretaker_assignment_id,
        event.caretaker_account_id,
        event.status,
        event.assignment_version,
        previousAsset,
        nextAsset,
        nextVersion,
        event.event_id,
        event.event_sequence,
      )
      this.sql.exec(
        `INSERT INTO caretaker_supervote_outbox (mutation_id, payload_json)
         VALUES (?, ?)`,
        mutationId,
        outboxPayload({
          mutationId,
          eventType,
          assignment,
          head: nextHead,
          fromAssetSha256: previousAsset,
          toAssetSha256: nextAsset,
          recomputeRequired: previousAsset !== nextAsset,
        }),
      )
      this.compactHistory()
      return { ok: true, changed: true, replayed: false, snapshot: this.snapshot() }
    })
  }

  async setSelection({
    accountId,
    assetSha256 = null,
    commandId,
    requestSha256,
    expectedAssignmentVersion,
    expectedSupervoteVersion,
  } = {}) {
    const account = normalizeId(accountId, "caretaker_account_id")
    const targetAsset = normalizeSha256(assetSha256, { optional: true })
    const command = normalizeId(commandId, "command_id")
    const requestHash = normalizeRequestSha256(requestSha256)
    const expectedAssignment = normalizeVersion(
      expectedAssignmentVersion,
      "expected_assignment_version",
      { minimum: 1 },
    )
    const expectedSupervote = normalizeVersion(
      expectedSupervoteVersion,
      "expected_supervote_version",
    )
    await this.armAlarm(1)
    return this.storage.transactionSync(() => {
      const receipt = first(
        this.sql,
        `SELECT request_sha256, response_json
           FROM caretaker_supervote_command_receipts
          WHERE command_id = ?`,
        command,
      )
      if (receipt) {
        if (receipt.request_sha256 !== requestHash) {
          fail("COMMAND_ID_CONFLICT", "command_id was already used for another request", 409)
        }
        return { ...parseJson(receipt.response_json, {}), replayed: true }
      }

      const assignment = this.readAssignment()
      const head = this.readHead()
      if (!assignment) fail("CARETAKER_ASSIGNMENT_REQUIRED", "Caretaker assignment is missing", 403)
      if (assignment.status === "suspended") {
        fail(
          "CARETAKER_ASSIGNMENT_SUSPENDED",
          "Suspended caretakers cannot move the supervote",
          409,
        )
      }
      if (assignment.status !== "active") {
        fail("CARETAKER_ASSIGNMENT_INACTIVE", "An active caretaker assignment is required", 403)
      }
      if (assignment.caretaker_account_id !== account) {
        fail(
          "CARETAKER_ASSIGNMENT_NOT_OWNED",
          "Only this gene's caretaker can move the supervote",
          403,
        )
      }
      if (Number(assignment.assignment_version) !== expectedAssignment) {
        fail("STALE_ASSIGNMENT_STATE", "Caretaker assignment changed", 409)
      }
      if (Number(head.supervote_version || 0) !== expectedSupervote) {
        fail("STALE_SUPERVOTE_STATE", "Caretaker supervote changed", 409)
      }
      if (
        targetAsset &&
        !first(
          this.sql,
          `SELECT asset_sha256, eligibility_version
             FROM caretaker_supervote_asset_eligibility
            WHERE asset_sha256 = ? AND eligible = 1`,
          targetAsset,
        )
      ) {
        fail(
          "SUPERVOTE_TARGET_INELIGIBLE",
          "Caretaker supervotes require an eligible, current candidate blot",
          409,
        )
      }

      const previousAsset = normalizeSha256(head.asset_sha256, { optional: true })
      const changed = previousAsset !== targetAsset
      // Every accepted command advances the CAS token. Once its bounded receipt
      // leaves the replay horizon, the original token is therefore guaranteed
      // stale instead of accidentally executing the command a second time.
      const nextVersion = Number(head.supervote_version || 0) + 1
      const eventType = targetAsset
        ? previousAsset
          ? changed
            ? "supervote_moved"
            : "supervote_confirmed"
          : "supervote_set"
        : "supervote_cleared"
      const mutationId = `caretaker-supervote:${command}`

      this.sql.exec(
        `UPDATE caretaker_supervote_head
            SET asset_sha256 = ?, supervote_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE singleton = 1`,
        targetAsset,
        nextVersion,
      )
      const nextHead = this.readHead()
      const response = {
        ok: true,
        changed,
        replayed: false,
        mutation_id: mutationId,
        accepted_event_sequence: Number(assignment.authority_event_sequence),
        supervote: supervoteSnapshot(assignment, nextHead, account),
      }
      this.sql.exec(
        `INSERT INTO caretaker_supervote_audit (
           mutation_id, event_type, command_id, request_sha256,
           caretaker_assignment_id, caretaker_account_id, assignment_status,
           assignment_version, from_asset_sha256, to_asset_sha256,
           supervote_version, authority_event_id, authority_event_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        mutationId,
        eventType,
        command,
        requestHash,
        assignment.caretaker_assignment_id,
        account,
        assignment.status,
        assignment.assignment_version,
        previousAsset,
        targetAsset,
        nextVersion,
        assignment.authority_event_id,
        assignment.authority_event_sequence,
      )
      this.sql.exec(
        `INSERT INTO caretaker_supervote_outbox (mutation_id, payload_json)
         VALUES (?, ?)`,
        mutationId,
        outboxPayload({
          mutationId,
          eventType,
          commandId: command,
          requestSha256: requestHash,
          assignment,
          head: nextHead,
          fromAssetSha256: previousAsset,
          toAssetSha256: targetAsset,
          response,
          recomputeRequired: changed,
        }),
      )
      this.sql.exec(
        `INSERT INTO caretaker_supervote_command_receipts (
           command_id, request_sha256, response_json
         ) VALUES (?, ?, ?)`,
        command,
        requestHash,
        JSON.stringify(response),
      )
      this.compactHistory()
      return response
    })
  }

  projectAssetEligibilityInTransaction(rawEvent) {
    const event = normalizeEligibilityEvent(rawEvent)
    if (normalizeSymbol(this.getSymbol()) !== event.gene_symbol) {
      fail("ELIGIBILITY_GENE_MISMATCH", "Candidate eligibility belongs to another gene", 409)
    }
    const current = first(
      this.sql,
      `SELECT asset_sha256, eligibility_version, eligible,
              source_event_id, source_event_sequence
         FROM caretaker_supervote_asset_eligibility
        WHERE asset_sha256 = ?`,
      event.asset_sha256,
    )
    if (current) {
      const currentVersion = Number(current.eligibility_version)
      if (event.eligibility_version === currentVersion) {
        if (
          current.source_event_id !== event.event_id ||
          Number(current.source_event_sequence) !== event.event_sequence ||
          Boolean(current.eligible) !== event.eligible
        ) {
          fail(
            "CANDIDATE_ELIGIBILITY_CONFLICT",
            "Candidate eligibility version already has different content",
            409,
          )
        }
        return {
          ok: true,
          changed: false,
          replayed: true,
          asset_sha256: event.asset_sha256,
          eligibility_version: currentVersion,
          eligible: Boolean(current.eligible),
          supervote: this.snapshot(),
        }
      }
      if (event.eligibility_version < currentVersion) {
        fail(
          "STALE_CANDIDATE_ELIGIBILITY",
          "Candidate eligibility projection cannot move backward",
          409,
        )
      }
    }

    this.sql.exec(
      `INSERT INTO caretaker_supervote_asset_eligibility (
         asset_sha256, eligibility_version, eligible,
         source_event_id, source_event_sequence, reason, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(asset_sha256) DO UPDATE SET
         eligibility_version = excluded.eligibility_version,
         eligible = excluded.eligible,
         source_event_id = excluded.source_event_id,
         source_event_sequence = excluded.source_event_sequence,
         reason = excluded.reason,
         updated_at = CURRENT_TIMESTAMP`,
      event.asset_sha256,
      event.eligibility_version,
      event.eligible ? 1 : 0,
      event.event_id,
      event.event_sequence,
      event.reason,
    )

    const assignment = this.readAssignment()
    const head = this.readHead()
    const selectedAsset = normalizeSha256(head?.asset_sha256, { optional: true })
    const selectionCleared = !event.eligible && selectedAsset === event.asset_sha256
    const mutationId = `caretaker-supervote-eligibility:${event.event_id}`
    if (selectionCleared) {
      const nextVersion = Number(head.supervote_version || 0) + 1
      this.sql.exec(
        `UPDATE caretaker_supervote_head
            SET asset_sha256 = NULL, supervote_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE singleton = 1`,
        nextVersion,
      )
      const nextHead = this.readHead()
      this.sql.exec(
        `INSERT INTO caretaker_supervote_audit (
           mutation_id, event_type, caretaker_assignment_id, caretaker_account_id,
           assignment_status, assignment_version, from_asset_sha256, to_asset_sha256,
           supervote_version, authority_event_id, authority_event_sequence
         ) VALUES (?, 'supervote_asset_invalidated', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        mutationId,
        assignment.caretaker_assignment_id,
        assignment.caretaker_account_id,
        assignment.status,
        assignment.assignment_version,
        event.asset_sha256,
        nextVersion,
        assignment.authority_event_id,
        assignment.authority_event_sequence,
      )
      this.sql.exec(
        `INSERT INTO caretaker_supervote_outbox (mutation_id, payload_json)
         VALUES (?, ?)`,
        mutationId,
        outboxPayload({
          mutationId,
          eventType: "supervote_asset_invalidated",
          assignment,
          head: nextHead,
          fromAssetSha256: event.asset_sha256,
          toAssetSha256: null,
          recomputeRequired: true,
        }),
      )
    }
    this.compactHistory()
    return {
      ok: true,
      changed: true,
      replayed: false,
      selection_cleared: selectionCleared,
      mutation_id: selectionCleared ? mutationId : null,
      asset_sha256: event.asset_sha256,
      eligibility_version: event.eligibility_version,
      eligible: event.eligible,
      supervote: this.snapshot(),
    }
  }

  projectAssetEligibility(rawEvent) {
    return this.storage.transactionSync(() => this.projectAssetEligibilityInTransaction(rawEvent))
  }

  projectAssetEligibilityBatch({ projections } = {}) {
    const items = Array.isArray(projections) ? projections : []
    if (!items.length || items.length > 5000) {
      fail("INVALID_SUPERVOTE_INPUT", "projections must contain 1 to 5000 items")
    }
    return this.storage.transactionSync(() => {
      const results = items.map((event) => this.projectAssetEligibilityInTransaction(event))
      return {
        ok: true,
        changed: results.filter((result) => result.changed).length,
        replayed: results.filter((result) => result.replayed).length,
        results,
      }
    })
  }

  pendingOutboxRows(limit = 50) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 50) || 50))
    return this.sql
      .exec(
        `SELECT id, mutation_id, payload_json, attempts
           FROM caretaker_supervote_outbox
          WHERE delivered_at IS NULL
          ORDER BY id ASC
          LIMIT ?`,
        safeLimit,
      )
      .toArray()
  }

  async drainOutbox(deliver) {
    if (typeof deliver !== "function") throw new TypeError("deliver is required")
    const rows = this.pendingOutboxRows(50)
    for (const row of rows) {
      try {
        const payload = parseJson(row.payload_json)
        if (!payload) throw new Error("Invalid caretaker supervote outbox payload")
        await deliver(payload)
        this.storage.transactionSync(() => {
          this.sql.exec(
            `UPDATE caretaker_supervote_outbox
                SET delivered_at = CURRENT_TIMESTAMP, last_error = ''
              WHERE id = ? AND delivered_at IS NULL`,
            Number(row.id),
          )
          this.compactHistory()
        })
      } catch (error) {
        const attempts = Math.max(0, Number(row.attempts || 0)) + 1
        this.sql.exec(
          `UPDATE caretaker_supervote_outbox
              SET attempts = ?, last_error = ?
            WHERE id = ? AND delivered_at IS NULL`,
          attempts,
          String(error?.message || error || "outbox delivery failed").slice(0, 2000),
          Number(row.id),
        )
        await this.armAlarm(Math.min(60_000, Math.max(1_000, 2 ** Math.min(attempts, 6) * 1_000)))
        return { ok: false, delivered: 0, pending: rows.length, error: String(error) }
      }
    }
    const remaining = this.pendingOutboxRows(1).length
    if (remaining) await this.armAlarm(1)
    return { ok: true, delivered: rows.length, pending: remaining }
  }
}

export { normalizeAssignmentEvent, normalizeEligibilityEvent, supervoteSnapshot }
