const ACCOUNT_ID_PATTERN = /^acct_[0-9a-f]{32}$/
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/
const ACCOUNT_STATUSES = new Set(["active", "disabled", "erasure_pending", "erased"])

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
         identity.unlinked_at,
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

async function readIdentityEventForCommand(db, accountId, commandId) {
  return db
    .prepare(
      `SELECT provider, provider_subject_fingerprint, event_type, link_version
       FROM brinedew_account_identity_events
       WHERE account_id = ? AND command_id = ?
       LIMIT 1`,
    )
    .bind(accountId, commandId)
    .first()
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

function assertIdentityCommandReplay(event, { provider, fingerprint, eventTypes }) {
  if (
    event &&
    (event.provider !== provider ||
      event.provider_subject_fingerprint !== fingerprint ||
      !eventTypes.includes(event.event_type))
  ) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_COMMAND_REUSED",
      "The account command ID was already used for a different identity transition",
    )
  }
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
    if (identity.unlinked_at != null) {
      throw new BrinedewAccountIdentityError(
        "PROVIDER_IDENTITY_UNLINKED",
        "This provider identity must be explicitly relinked before it can sign in",
        403,
      )
    }
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
  if (identity.unlinked_at != null) {
    throw new BrinedewAccountIdentityError(
      "PROVIDER_IDENTITY_UNLINKED",
      "This provider identity must be explicitly relinked before it can sign in",
      403,
    )
  }
  if (provider === "discord") await bindDiscordUserAccountId(db, providerSubject, resolvedAccountId)
  await touchProviderIdentity(db, provider, providerSubject, observedAt)
  return identityResult(identity, resolvedAccountId)
}

export async function linkBrinedewProviderIdentity(
  db,
  {
    accountId: accountIdValue,
    provider: providerValue,
    providerSubject: providerSubjectValue,
    commandId: commandIdValue,
    actorAccountId: actorAccountIdValue = null,
    now = Date.now(),
  } = {},
) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  const provider = normalizeProvider(providerValue)
  const providerSubject = normalizeProviderSubject(providerSubjectValue)
  const commandId = normalizeCommandId(commandIdValue)
  const actorAccountId = actorAccountIdValue
    ? normalizeBrinedewAccountId(actorAccountIdValue)
    : null
  if (!accountId || (actorAccountIdValue && !actorAccountId)) {
    throw new TypeError("Invalid Brinedew account ID")
  }
  const linkedAt = normalizeTimestamp(now)
  const fingerprint = await brinedewProviderSubjectFingerprint(provider, providerSubject)
  const replay = await readIdentityEventForCommand(db, accountId, commandId)
  assertIdentityCommandReplay(replay, {
    provider,
    fingerprint,
    eventTypes: ["identity_linked", "identity_relinked"],
  })
  if (replay) {
    return { account_id: accountId, link_version: Number(replay.link_version), replay: true }
  }

  const account = await readBrinedewAccount(db, accountId)
  if (!account || account.status !== "active") {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_NOT_ACTIVE",
      "Only an active Brinedew account can link a provider identity",
      403,
    )
  }
  const current = await readProviderIdentity(db, provider, providerSubject)
  if (current?.account_id && current.account_id !== accountId) {
    throw new BrinedewAccountIdentityError(
      "PROVIDER_IDENTITY_COLLISION",
      "That provider identity already belongs to another Brinedew account",
    )
  }
  if (current?.account_id && current.unlinked_at == null) {
    await touchProviderIdentity(db, provider, providerSubject, linkedAt)
    return { account_id: accountId, link_version: Number(current.link_version), replay: false }
  }

  const previousVersion = Number(current?.link_version || 0)
  const nextVersion = previousVersion + 1
  const eventType = current ? "identity_relinked" : "identity_linked"
  const statements = []
  if (current) {
    statements.push(
      db
        .prepare(
          `UPDATE brinedew_account_identities
           SET unlinked_at = NULL, link_version = ?, last_seen_at = ?
           WHERE provider = ? AND provider_subject = ?
             AND account_id = ? AND link_version = ? AND unlinked_at IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM brinedew_accounts account
               WHERE account.account_id = ? AND account.status = 'active'
             )`,
        )
        .bind(
          nextVersion,
          linkedAt,
          provider,
          providerSubject,
          accountId,
          previousVersion,
          accountId,
        ),
    )
  } else {
    statements.push(
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
        .bind(provider, providerSubject, linkedAt, linkedAt, accountId),
    )
  }
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_identity_events (
           event_id, command_id, account_id, provider,
           provider_subject_fingerprint, event_type, link_version,
           actor_account_id, occurred_at
         )
         SELECT ?, ?, account_id, provider, ?, ?, link_version, ?, ?
         FROM brinedew_account_identities
         WHERE provider = ? AND provider_subject = ?
           AND account_id = ? AND link_version = ? AND unlinked_at IS NULL`,
      )
      .bind(
        newEventId("identity_event"),
        commandId,
        fingerprint,
        eventType,
        actorAccountId,
        linkedAt,
        provider,
        providerSubject,
        accountId,
        nextVersion,
      ),
  )
  await db.batch(statements)

  const linked = await readProviderIdentity(db, provider, providerSubject)
  if (!linked?.account_id || linked.account_id !== accountId || linked.unlinked_at != null) {
    if (linked?.account_id && linked.account_id !== accountId) {
      throw new BrinedewAccountIdentityError(
        "PROVIDER_IDENTITY_COLLISION",
        "That provider identity already belongs to another Brinedew account",
      )
    }
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_LINK_CONFLICT",
      "The provider identity changed while it was being linked",
    )
  }
  const event = await readIdentityEventForCommand(db, accountId, commandId)
  if (!event) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_LINK_CONFLICT",
      "The provider identity link was not committed with its audit event",
    )
  }
  if (provider === "discord") await bindDiscordUserAccountId(db, providerSubject, accountId)
  return { account_id: accountId, link_version: Number(linked.link_version), replay: false }
}

export async function unlinkBrinedewProviderIdentity(
  db,
  {
    accountId: accountIdValue,
    provider: providerValue,
    providerSubject: providerSubjectValue,
    commandId: commandIdValue,
    actorAccountId: actorAccountIdValue = null,
    now = Date.now(),
  } = {},
) {
  requireDb(db)
  const accountId = normalizeBrinedewAccountId(accountIdValue)
  const provider = normalizeProvider(providerValue)
  const providerSubject = normalizeProviderSubject(providerSubjectValue)
  const commandId = normalizeCommandId(commandIdValue)
  const actorAccountId = actorAccountIdValue
    ? normalizeBrinedewAccountId(actorAccountIdValue)
    : null
  if (!accountId || (actorAccountIdValue && !actorAccountId)) {
    throw new TypeError("Invalid Brinedew account ID")
  }
  const unlinkedAt = normalizeTimestamp(now)
  const fingerprint = await brinedewProviderSubjectFingerprint(provider, providerSubject)
  const replay = await readIdentityEventForCommand(db, accountId, commandId)
  assertIdentityCommandReplay(replay, {
    provider,
    fingerprint,
    eventTypes: ["identity_unlinked"],
  })
  if (replay) {
    return { account_id: accountId, link_version: Number(replay.link_version), replay: true }
  }

  const current = await readProviderIdentity(db, provider, providerSubject)
  if (!current?.account_id || current.account_id !== accountId) {
    throw new BrinedewAccountIdentityError(
      "PROVIDER_IDENTITY_NOT_OWNED",
      "That provider identity is not linked to this Brinedew account",
      404,
    )
  }
  if (current.unlinked_at != null) {
    return { account_id: accountId, link_version: Number(current.link_version), replay: false }
  }
  const nextVersion = Number(current.link_version) + 1
  await db.batch([
    db
      .prepare(
        `UPDATE brinedew_account_identities
         SET unlinked_at = ?, link_version = ?
         WHERE provider = ? AND provider_subject = ?
           AND account_id = ? AND link_version = ? AND unlinked_at IS NULL`,
      )
      .bind(
        unlinkedAt,
        nextVersion,
        provider,
        providerSubject,
        accountId,
        Number(current.link_version),
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO brinedew_account_identity_events (
           event_id, command_id, account_id, provider,
           provider_subject_fingerprint, event_type, link_version,
           actor_account_id, occurred_at
         )
         SELECT ?, ?, account_id, provider, ?, 'identity_unlinked',
                link_version, ?, ?
         FROM brinedew_account_identities
         WHERE provider = ? AND provider_subject = ?
           AND account_id = ? AND link_version = ? AND unlinked_at = ?`,
      )
      .bind(
        newEventId("identity_event"),
        commandId,
        fingerprint,
        actorAccountId,
        unlinkedAt,
        provider,
        providerSubject,
        accountId,
        nextVersion,
        unlinkedAt,
      ),
  ])
  const event = await readIdentityEventForCommand(db, accountId, commandId)
  if (!event) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_LINK_CONFLICT",
      "The provider identity changed while it was being unlinked",
    )
  }
  return { account_id: accountId, link_version: nextVersion, replay: false }
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

export function disableBrinedewAccount(db, options = {}) {
  return setBrinedewAccountStatus(db, { ...options, status: "disabled" })
}

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
  const nextVersion = current.account_version + 1
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
    const fingerprint = await brinedewProviderSubjectFingerprint(provider, providerSubject)
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
             AND EXISTS (
               SELECT 1 FROM brinedew_account_lifecycle_events event
               WHERE event.account_id = identity.account_id
                 AND event.command_id = ?
                 AND event.event_type = 'erasure_completed'
             )`,
        )
        .bind(
          newEventId("identity_event"),
          commandId,
          fingerprint,
          actorAccountId,
          erasedAt,
          provider,
          providerSubject,
          accountId,
          Number(identity.link_version),
          commandId,
        ),
    )
  }
  statements.push(
    db
      .prepare(
        `UPDATE users
         SET username = ?, email = NULL, avatar_url = NULL, tier = 'registered',
             premium_until = NULL, leaderboard_opt_in = 0, updated_at = ?
         WHERE account_id = ?
           AND EXISTS (
             SELECT 1 FROM brinedew_account_lifecycle_events event
             WHERE event.account_id = users.account_id
               AND event.command_id = ?
               AND event.event_type = 'erasure_completed'
           )`,
      )
      .bind(authorLabel, erasedAt, accountId, commandId),
    db
      .prepare(
        `DELETE FROM brinedew_account_identities
         WHERE account_id = ?
           AND EXISTS (
             SELECT 1 FROM brinedew_account_lifecycle_events event
             WHERE event.account_id = brinedew_account_identities.account_id
               AND event.command_id = ?
               AND event.event_type = 'erasure_completed'
           )`,
      )
      .bind(accountId, commandId),
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
  const linkActive =
    providerIdentity?.account_id === accountId && providerIdentity.unlinked_at == null
  const status = account?.status || "missing"
  const active = status === "active" && linkActive
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
    denial_code:
      status === "active" && !linkActive ? "PROVIDER_IDENTITY_UNLINKED" : "ACCOUNT_NOT_ACTIVE",
  }
}
