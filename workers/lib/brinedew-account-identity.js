const ACCOUNT_ID_PATTERN = /^acct_[0-9a-f]{32}$/
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/
const ACCOUNT_STATUSES = new Set(["active", "disabled", "erasure_pending", "erased"])
// What an erasure writes where a provider-subject fingerprint (or a command id built from one) used
// to be: opaque, unique per event, derived from nothing about the person.
const ERASED_MARKER = "erased:"

export class BrinedewAccountIdentityError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = "BrinedewAccountIdentityError"
    this.code = code
    this.status = status
  }
}

export function normalizeBrinedewAccountId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  return ACCOUNT_ID_PATTERN.test(normalized) ? normalized : ""
}

function normalizeProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (!PROVIDER_PATTERN.test(normalized)) throw new TypeError("Invalid account identity provider")
  return normalized
}

function normalizeProviderSubject(value) {
  const normalized = String(value || "").trim()
  if (!normalized || normalized.length > 255 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError("Invalid account identity provider subject")
  }
  return normalized
}

function normalizeCommandId(value) {
  const normalized = String(value || "").trim()
  if (!COMMAND_ID_PATTERN.test(normalized)) throw new TypeError("Invalid account command ID")
  return normalized
}

function normalizeAccountStatus(value) {
  const status = String(value || "").trim()
  if (!ACCOUNT_STATUSES.has(status)) throw new TypeError("Invalid Brinedew account status")
  return status
}

function normalizeTimestamp(value) {
  return Math.max(0, Math.trunc(Number(value) || 0))
}

function normalizeReasonCode(value) {
  const reason = String(value || "").trim()
  if (reason.length > 100 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new TypeError("Invalid account lifecycle reason code")
  }
  return reason
}

function normalizeFinalLeavePolicy(value, { required = false } = {}) {
  const policy = String(value || "")
    .trim()
    .toLowerCase()
  if (!policy && !required) return null
  if (!new Set(["retain", "withdraw"]).has(policy)) {
    throw new TypeError("Final caretaker leave policy must be retain or withdraw")
  }
  return policy
}

function newEventId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function brinedewProviderSubjectFingerprint(providerValue, providerSubjectValue) {
  const provider = normalizeProvider(providerValue)
  const providerSubject = normalizeProviderSubject(providerSubjectValue)
  return `sha256:${await sha256Hex(`brinedew.provider-subject.v1\0${provider}\0${providerSubject}`)}`
}

export async function brinedewFormerAuthorLabel(accountIdValue) {
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const digest = await sha256Hex(`brinedew.former-author.v1\0${accountId}`)
  return `Former caretaker · ${digest.slice(0, 10).toUpperCase()}`
}

export function createBrinedewAccountId() {
  return `acct_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
}

function requireDb(db) {
  if (!db?.prepare || !db?.batch) throw new TypeError("A D1 database binding is required")
}

async function allRows(statement) {
  const result = await statement.all()
  return Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : []
}

async function readProviderIdentity(db, provider, providerSubject) {
  return db
    .prepare(
      `SELECT
         identity.account_id,
         identity.link_version,
         account.status,
         account.account_version,
         account.author_label
       FROM brinedew_account_identities identity
       INNER JOIN brinedew_accounts account
         ON account.account_id = identity.account_id
       WHERE identity.provider = ?
         AND identity.provider_subject = ?
       LIMIT 1`,
    )
    .bind(provider, providerSubject)
    .first()
}

export async function readBrinedewAccount(db, accountIdValue) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const row = await db
    .prepare(
      `SELECT account_id, status, account_version, author_label, anonymized_at
       FROM brinedew_accounts
       WHERE account_id = ?
       LIMIT 1`,
    )
    .bind(accountId)
    .first()
  if (!row?.account_id) return null
  return {
    account_id: accountId,
    status: normalizeAccountStatus(row.status),
    account_version: Number(row.account_version),
    author_label: String(row.author_label || "") || null,
    anonymized_at: row.anonymized_at == null ? null : Number(row.anonymized_at),
  }
}

async function readDiscordUserAccountId(db, discordId) {
  const row = await db
    .prepare(`SELECT account_id FROM users WHERE discord_id = ? LIMIT 1`)
    .bind(discordId)
    .first()
  return normalizeBrinedewAccountId(row?.account_id)
}

async function bindDiscordUserAccountId(db, discordId, accountId) {
  await db
    .prepare(
      `UPDATE users
       SET account_id = ?
       WHERE discord_id = ?
         AND account_id IS NULL`,
    )
    .bind(accountId, discordId)
    .run()

  const cachedAccountId = await readDiscordUserAccountId(db, discordId)
  if (cachedAccountId && cachedAccountId !== accountId) {
    throw new BrinedewAccountIdentityError(
      "PROVIDER_IDENTITY_COLLISION",
      "Discord profile is linked to a different Brinedew account",
    )
  }
}

async function touchProviderIdentity(db, provider, providerSubject, now) {
  await db
    .prepare(
      `UPDATE brinedew_account_identities
       SET last_seen_at = CASE
         WHEN last_seen_at < ? THEN ?
         ELSE last_seen_at
       END
       WHERE provider = ?
         AND provider_subject = ?
         AND unlinked_at IS NULL`,
    )
    .bind(now, now, provider, providerSubject)
    .run()
}

function identityResult(identity, accountId) {
  return {
    account_id: accountId,
    status: normalizeAccountStatus(identity.status),
    account_version: Number(identity.account_version),
    author_label: String(identity.author_label || "") || null,
  }
}

async function readAccountEventForCommand(db, accountId, commandId) {
  return db
    .prepare(
      `SELECT event_type, from_status, to_status, account_version, author_label,
              final_leave_policy
       FROM brinedew_account_lifecycle_events
       WHERE account_id = ? AND command_id = ?
       LIMIT 1`,
    )
    .bind(accountId, commandId)
    .first()
}

/**
 * Resolve one active external identity to its permanent Brinedew account.
 * Concurrent first logins may propose different random account IDs; the
 * provider-subject primary key selects one winner and both audit events select
 * that winner from the current projection inside the same D1 transaction.
 */
export async function resolveBrinedewAccountIdentity(
  db,
  {
    provider: rawProvider,
    providerSubject: rawProviderSubject,
    now = Date.now(),
    accountIdFactory = createBrinedewAccountId,
  } = {},
) {
  requireDb(db)
  const provider = normalizeProvider(rawProvider)
  const providerSubject = normalizeProviderSubject(rawProviderSubject)
  const observedAt = normalizeTimestamp(now)

  let identity = await readProviderIdentity(db, provider, providerSubject)
  if (identity?.account_id) {
    const accountId = normalizeBrinedewAccountId(identity.account_id)
    if (!accountId) throw new Error("Stored Brinedew account identity is invalid")
    if (provider === "discord") await bindDiscordUserAccountId(db, providerSubject, accountId)
    await touchProviderIdentity(db, provider, providerSubject, observedAt)
    return identityResult(identity, accountId)
  }

  const fingerprint = await brinedewProviderSubjectFingerprint(provider, providerSubject)
  const cachedAccountId =
    provider === "discord" ? await readDiscordUserAccountId(db, providerSubject) : ""
  if (cachedAccountId) {
    const cachedAccount = await readBrinedewAccount(db, cachedAccountId)
    if (cachedAccount && cachedAccount.status !== "active") return cachedAccount
  }
  const proposedAccountId = normalizeBrinedewAccountId(
    cachedAccountId || (await accountIdFactory()),
  )
  if (!proposedAccountId) throw new Error("Account ID factory returned an invalid ID")

  const insertAccountSql = cachedAccountId
    ? `INSERT OR IGNORE INTO brinedew_accounts (
         account_id, status, created_at, updated_at, account_version
       ) VALUES (?, 'active', ?, ?, 1)`
    : `INSERT INTO brinedew_accounts (
         account_id, status, created_at, updated_at, account_version
       ) VALUES (?, 'active', ?, ?, 1)`

  await db.batch([
    db.prepare(insertAccountSql).bind(proposedAccountId, observedAt, observedAt),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_identities (
           provider, provider_subject, account_id, created_at, last_seen_at,
           link_version, unlinked_at
         )
         SELECT ?, ?, account_id, ?, ?, 1, NULL
         FROM brinedew_accounts
         WHERE account_id = ? AND status = 'active'`,
      )
      .bind(provider, providerSubject, observedAt, observedAt, proposedAccountId),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_lifecycle_events (
           event_id, command_id, account_id, event_type, from_status,
           to_status, account_version, author_label, reason_code,
           actor_account_id, occurred_at
         )
         SELECT ?, ?, identity.account_id, 'account_created', NULL,
                account.status, account.account_version, account.author_label,
                'first_provider_login', NULL, ?
         FROM brinedew_account_identities identity
         INNER JOIN brinedew_accounts account ON account.account_id = identity.account_id
         WHERE identity.provider = ?
           AND identity.provider_subject = ?
           AND identity.unlinked_at IS NULL
           AND account.account_version = 1`,
      )
      .bind(
        newEventId("account_event"),
        `resolve-account:${provider}:${fingerprint}`,
        observedAt,
        provider,
        providerSubject,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_identity_events (
           event_id, command_id, account_id, provider,
           provider_subject_fingerprint, event_type, link_version,
           actor_account_id, occurred_at
         )
         SELECT ?, ?, identity.account_id, identity.provider, ?,
                'identity_linked', identity.link_version, NULL, ?
         FROM brinedew_account_identities identity
         WHERE identity.provider = ?
           AND identity.provider_subject = ?
           AND identity.unlinked_at IS NULL`,
      )
      .bind(
        newEventId("identity_event"),
        `resolve-identity:${provider}:${fingerprint}`,
        fingerprint,
        observedAt,
        provider,
        providerSubject,
      ),
    db
      .prepare(
        `DELETE FROM brinedew_accounts
         WHERE account_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM brinedew_account_identities identity
             WHERE identity.account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM users WHERE account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM brinedew_account_lifecycle_events event
             WHERE event.account_id = ?
           )`,
      )
      .bind(proposedAccountId, proposedAccountId, proposedAccountId, proposedAccountId),
  ])

  identity = await readProviderIdentity(db, provider, providerSubject)
  const resolvedAccountId = normalizeBrinedewAccountId(identity?.account_id)
  if (!resolvedAccountId) throw new Error("Brinedew account identity resolution did not persist")
  if (provider === "discord") await bindDiscordUserAccountId(db, providerSubject, resolvedAccountId)
  await touchProviderIdentity(db, provider, providerSubject, observedAt)
  return identityResult(identity, resolvedAccountId)
}

export async function setBrinedewAccountStatus(
  db,
  {
    accountId: accountIdValue,
    status: statusValue,
    commandId: commandIdValue,
    reasonCode = "",
    finalLeavePolicy = null,
    actorAccountId: actorAccountIdValue = null,
    now = Date.now(),
  } = {},
) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  const status = normalizeAccountStatus(statusValue)
  const commandId = normalizeCommandId(commandIdValue)
  const actorAccountId = actorAccountIdValue
    ? normalizeBrinedewAccountId(actorAccountIdValue)
    : null
  if (!accountId || (actorAccountIdValue && !actorAccountId)) {
    throw new TypeError("Invalid Brinedew account ID")
  }
  if (status === "erased") {
    throw new TypeError("Use eraseBrinedewAccount for the terminal erased transition")
  }
  const transitionAt = normalizeTimestamp(now)
  const reason = normalizeReasonCode(reasonCode)
  const leavePolicy = normalizeFinalLeavePolicy(finalLeavePolicy, {
    required: status === "erasure_pending",
  })
  const replay = await readAccountEventForCommand(db, accountId, commandId)
  if (replay) {
    if (
      replay.event_type !== "status_changed" ||
      replay.to_status !== status ||
      (replay.final_leave_policy || null) !== leavePolicy
    ) {
      throw new BrinedewAccountIdentityError(
        "ACCOUNT_COMMAND_REUSED",
        "The account command ID was already used for a different lifecycle transition",
      )
    }
    return {
      ...(await readBrinedewAccount(db, accountId)),
      final_leave_policy: replay.final_leave_policy || null,
      replay: true,
    }
  }

  const current = await readBrinedewAccount(db, accountId)
  if (!current) {
    throw new BrinedewAccountIdentityError("ACCOUNT_NOT_FOUND", "Brinedew account not found", 404)
  }
  if (current.status === "erased") {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_ERASED",
      "An erased Brinedew account cannot change status",
      409,
    )
  }
  if (current.status === status) return { ...current, replay: false }
  const nextVersion = current.account_version + 1
  await db.batch([
    db
      .prepare(
        `UPDATE brinedew_accounts
         SET status = ?, account_version = ?, updated_at = ?
         WHERE account_id = ? AND status = ? AND account_version = ?`,
      )
      .bind(status, nextVersion, transitionAt, accountId, current.status, current.account_version),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_lifecycle_events (
            event_id, command_id, account_id, event_type, from_status,
            to_status, account_version, author_label, final_leave_policy,
            reason_code, actor_account_id, occurred_at
          )
          SELECT ?, ?, account_id, 'status_changed', ?, status,
                 account_version, author_label, ?, ?, ?, ?
         FROM brinedew_accounts
         WHERE account_id = ? AND status = ? AND account_version = ?
           AND NOT EXISTS (
             SELECT 1 FROM brinedew_account_lifecycle_events event
             WHERE event.account_id = brinedew_accounts.account_id
               AND event.account_version = brinedew_accounts.account_version
           )`,
      )
      .bind(
        newEventId("account_event"),
        commandId,
        current.status,
        leavePolicy,
        reason,
        actorAccountId,
        transitionAt,
        accountId,
        status,
        nextVersion,
      ),
  ])
  const event = await readAccountEventForCommand(db, accountId, commandId)
  if (!event) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_STATUS_CONFLICT",
      "The Brinedew account status changed concurrently",
    )
  }
  return {
    ...(await readBrinedewAccount(db, accountId)),
    final_leave_policy: event.final_leave_policy || null,
    replay: false,
  }
}

// The two guards that keep account and identity history append-only. Erasure rewrites the one
// thing in that history that names a person: the provider-subject fingerprint, an unsalted
// SHA-256 of a 17 to 19 digit Discord id, which also sits inside the command ids of the first
// login's two events. Nothing reads any of it. So the erasing batch takes these two guards off,
// rewrites those values to an opaque marker and puts back exactly the guard text it found, all in
// one D1 batch (one transaction, so no other statement runs in the gap and a failed rewrite rolls
// the guards back with it). The migration that created them stays the one definition.
const APPEND_ONLY_UPDATE_GUARDS = Object.freeze([
  "trg_brinedew_identity_events_append_only_update",
  "trg_brinedew_account_events_append_only_update",
])

async function readAppendOnlyUpdateGuards(db) {
  const rows = await allRows(
    db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'trigger' AND name IN (${APPEND_ONLY_UPDATE_GUARDS.map(() => "?").join(", ")})`,
      )
      .bind(...APPEND_ONLY_UPDATE_GUARDS),
  )
  return rows.filter((row) => APPEND_ONLY_UPDATE_GUARDS.includes(row.name) && row.sql)
}

/**
 * Completes an erasure whose data has already been removed (see
 * workers/iconoplasm/account-erasure/erase-account-data.js). In one transaction it marks the
 * account erased, queues the caretaker assignments' end through the account projection outbox,
 * scrubs the provider-subject fingerprint from event history, deletes the provider link and
 * deletes the `users` row, which is the last place the raw Discord id lives.
 *
 * A returning person with the same Discord id gets a brand-new account: the erased account keeps
 * its opaque id and anonymous label (retained authorship), and nothing links it to the person
 * any more. Every row keyed by the Discord id (`stats` first of all, which has a foreign key to
 * `users`) must already be gone, or the foreign key aborts the whole batch.
 */
export async function eraseBrinedewAccount(
  db,
  {
    accountId: accountIdValue,
    commandId: commandIdValue,
    reasonCode = "",
    actorAccountId: actorAccountIdValue = null,
    now = Date.now(),
  } = {},
) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  const commandId = normalizeCommandId(commandIdValue)
  const actorAccountId = actorAccountIdValue
    ? normalizeBrinedewAccountId(actorAccountIdValue)
    : null
  if (!accountId || (actorAccountIdValue && !actorAccountId)) {
    throw new TypeError("Invalid Brinedew account ID")
  }
  const erasedAt = normalizeTimestamp(now)
  const reason = normalizeReasonCode(reasonCode)
  const authorLabel = await brinedewFormerAuthorLabel(accountId)
  const replay = await readAccountEventForCommand(db, accountId, commandId)
  if (replay) {
    if (replay.event_type !== "erasure_completed" || replay.to_status !== "erased") {
      throw new BrinedewAccountIdentityError(
        "ACCOUNT_COMMAND_REUSED",
        "The account command ID was already used for a different lifecycle transition",
      )
    }
    return { ...(await readBrinedewAccount(db, accountId)), replay: true }
  }

  const current = await readBrinedewAccount(db, accountId)
  if (!current) {
    throw new BrinedewAccountIdentityError("ACCOUNT_NOT_FOUND", "Brinedew account not found", 404)
  }
  if (current.status === "erased") {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_ERASED",
      "This Brinedew account was already erased by a different command",
    )
  }
  if (current.status !== "erasure_pending") {
    throw new BrinedewAccountIdentityError(
      "ERASURE_NOT_PENDING",
      "Account erasure must be requested before it is completed",
    )
  }
  const activeIdentities = await allRows(
    db
      .prepare(
        `SELECT provider, provider_subject, link_version
         FROM brinedew_account_identities
         WHERE account_id = ? AND unlinked_at IS NULL
         ORDER BY provider ASC, provider_subject ASC`,
      )
      .bind(accountId),
  )
  const guards = await readAppendOnlyUpdateGuards(db)
  const nextVersion = current.account_version + 1
  // True only once this command's own completion event is in the batch, so a lost race scrubs
  // and deletes nothing.
  const completed = `EXISTS (
    SELECT 1 FROM brinedew_account_lifecycle_events completion
    WHERE completion.account_id = ?
      AND completion.command_id = ?
      AND completion.event_type = 'erasure_completed'
  )`
  const statements = [
    db
      .prepare(
        `UPDATE brinedew_accounts
         SET status = 'erased', account_version = ?, author_label = ?,
             anonymized_at = ?, updated_at = ?
         WHERE account_id = ? AND status = 'erasure_pending' AND account_version = ?`,
      )
      .bind(nextVersion, authorLabel, erasedAt, erasedAt, accountId, current.account_version),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_lifecycle_events (
           event_id, command_id, account_id, event_type, from_status,
           to_status, account_version, author_label, reason_code,
           actor_account_id, occurred_at
         )
         SELECT ?, ?, account_id, 'erasure_completed', 'erasure_pending',
                status, account_version, author_label, ?, ?, ?
         FROM brinedew_accounts
         WHERE account_id = ? AND status = 'erased' AND account_version = ?
           AND author_label = ?
           AND NOT EXISTS (
             SELECT 1 FROM brinedew_account_lifecycle_events event
             WHERE event.account_id = brinedew_accounts.account_id
               AND event.account_version = brinedew_accounts.account_version
           )`,
      )
      .bind(
        newEventId("account_event"),
        commandId,
        reason,
        actorAccountId,
        erasedAt,
        accountId,
        nextVersion,
        authorLabel,
      ),
  ]
  for (const identity of activeIdentities) {
    const provider = normalizeProvider(identity.provider)
    const providerSubject = normalizeProviderSubject(identity.provider_subject)
    // The unlink event is written already scrubbed: no fingerprint of the subject is ever
    // computed for an erasure.
    const eventId = newEventId("identity_event")
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO brinedew_account_identity_events (
             event_id, command_id, account_id, provider,
             provider_subject_fingerprint, event_type, link_version,
             actor_account_id, occurred_at
           )
           SELECT ?, ?, identity.account_id, identity.provider, ?,
                  'identity_erasure_unlinked', identity.link_version + 1, ?, ?
           FROM brinedew_account_identities identity
           WHERE identity.provider = ? AND identity.provider_subject = ?
             AND identity.account_id = ? AND identity.link_version = ?
             AND identity.unlinked_at IS NULL
             AND ${completed}`,
        )
        .bind(
          eventId,
          commandId,
          `${ERASED_MARKER}${eventId}`,
          actorAccountId,
          erasedAt,
          provider,
          providerSubject,
          accountId,
          Number(identity.link_version),
          accountId,
          commandId,
        ),
    )
  }
  for (const guard of guards) {
    statements.push(db.prepare(`DROP TRIGGER IF EXISTS ${guard.name}`))
  }
  statements.push(
    db
      .prepare(
        `UPDATE brinedew_account_identity_events
         SET provider_subject_fingerprint = '${ERASED_MARKER}' || event_id,
             command_id = CASE
               WHEN command_id LIKE 'resolve-identity:%' THEN '${ERASED_MARKER}' || event_id
               ELSE command_id
             END
         WHERE account_id = ?
           AND provider_subject_fingerprint NOT LIKE '${ERASED_MARKER}%'
           AND ${completed}`,
      )
      .bind(accountId, accountId, commandId),
    db
      .prepare(
        `UPDATE brinedew_account_lifecycle_events
         SET command_id = '${ERASED_MARKER}' || event_id
         WHERE account_id = ?
           AND command_id LIKE 'resolve-account:%'
           AND ${completed}`,
      )
      .bind(accountId, accountId, commandId),
  )
  for (const guard of guards) statements.push(db.prepare(guard.sql))
  statements.push(
    db
      .prepare(`DELETE FROM users WHERE account_id = ? AND ${completed}`)
      .bind(accountId, accountId, commandId),
    db
      .prepare(`DELETE FROM brinedew_account_identities WHERE account_id = ? AND ${completed}`)
      .bind(accountId, accountId, commandId),
  )
  await db.batch(statements)

  const event = await readAccountEventForCommand(db, accountId, commandId)
  if (!event) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_STATUS_CONFLICT",
      "The Brinedew account changed while erasure was being completed",
    )
  }
  return { ...(await readBrinedewAccount(db, accountId)), replay: false }
}

/**
 * Moves an account to `erasure_pending` (once; a repeat or a resume is a no-op) with the
 * `retain` caretaker policy: authored history stays under the anonymous label, and per-text
 * withdrawal is the author's own action. A pending account cannot keep a session: the next
 * request any of its sessions makes finds the account inactive and ends the session, so nothing
 * new is written under its Discord id while the data is removed.
 */
export async function requestBrinedewAccountErasure(
  db,
  {
    accountId: accountIdValue,
    commandId: commandIdValue,
    reasonCode = "erasure_request",
    actorAccountId = null,
    now = Date.now(),
  } = {},
) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const commandId = normalizeCommandId(commandIdValue)
  const current = await readBrinedewAccount(db, accountId)
  if (!current) {
    throw new BrinedewAccountIdentityError("ACCOUNT_NOT_FOUND", "Brinedew account not found", 404)
  }
  if (current.status !== "erased" && current.status !== "erasure_pending") {
    await setBrinedewAccountStatus(db, {
      accountId,
      status: "erasure_pending",
      commandId: `${commandId}.request`,
      reasonCode,
      finalLeavePolicy: "retain",
      actorAccountId,
      now,
    })
  }
  return readBrinedewAccount(db, accountId)
}

/**
 * Every Discord id one account is reachable by: the provider link and the `users` projection.
 * Both are deleted when the erasure completes, so the data removal reads this first.
 */
export async function readBrinedewAccountDiscordSubjects(db, accountIdValue) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const rows = await allRows(
    db
      .prepare(
        `SELECT provider_subject AS subject FROM brinedew_account_identities
          WHERE account_id = ? AND provider = 'discord'
         UNION
         SELECT discord_id AS subject FROM users WHERE account_id = ?`,
      )
      .bind(accountId, accountId),
  )
  return rows.map((row) => String(row.subject || "")).filter(Boolean)
}

export async function hydrateBrinedewSessionAccountIdentity(db, session, options = {}) {
  requireDb(db)
  const current = session && typeof session === "object" ? session : {}
  const discordId = normalizeProviderSubject(current.user_id)
  let accountId = normalizeBrinedewAccountId(current.account_id)
  let account

  if (!accountId) {
    const identity = await resolveBrinedewAccountIdentity(db, {
      provider: "discord",
      providerSubject: discordId,
      ...options,
    })
    accountId = identity.account_id
    account = identity
  } else {
    account = await readBrinedewAccount(db, accountId)
  }

  const providerIdentity = await readProviderIdentity(db, "discord", discordId)
  const status = account?.status || "missing"
  const active = status === "active" && providerIdentity?.account_id === accountId
  const resolvedSession = {
    ...current,
    account_id: accountId,
    account_status: status,
  }
  return {
    session: resolvedSession,
    changed:
      current.account_id !== accountId || String(current.account_status || "") !== String(status),
    active,
  }
}
