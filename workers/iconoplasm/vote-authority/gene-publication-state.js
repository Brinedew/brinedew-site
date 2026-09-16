/**
 * B-762 preparatory component. Not imported by a production entrypoint yet.
 *
 * One row in the EXISTING gene coordinator owns desired selection, published
 * immutable reference, retry time and attempt fencing. This is a storage helper,
 * not a Durable Object class or a second vote/canon authority.
 *
 * The host supplies its existing SQLite DO storage and a synchronous mutation
 * which authenticates/validates elsewhere and computes the authoritative winner.
 * Vote changes, publication intent and the wakeup commit in one storage transaction.
 * Never do network I/O in that mutation. Upload immutable bytes outside it, then
 * commit the pointer only for the exact still-current selection and attempt.
 */
const TABLE = "iconoplasm_gene_publication_state_v2"
const SHA256 = /^[a-f0-9]{64}$/
const MAX_REFERENCE_BYTES = 2048
const TEXT_ENCODER = new TextEncoder()

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} is invalid`)
  return value
}

function reference(value, name) {
  if (
    typeof value !== "string" ||
    !value ||
    new TextEncoder().encode(value).byteLength > MAX_REFERENCE_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError(`${name} is invalid`)
  return value
}

/**
 * A caller may supply an explicit selectionKey or only the canonical
 * selectionRef. The reference is the full public-card-affecting identity
 * (every revision that can change the rendered card), so hashing it yields the
 * same identity the host would otherwise precompute asynchronously. This keeps
 * commitSelection's mutation synchronous while the digest happens inside the
 * same storage transaction.
 */
async function selection(value) {
  if (!value || typeof value !== "object") throw new TypeError("selection identity is required")
  const selectionRef = reference(value.selectionRef, "selectionRef")
  if (value.selectionKey === undefined) {
    return { selectionKey: await sha256Hex(selectionRef), selectionRef }
  }
  if (!SHA256.test(value.selectionKey)) throw new TypeError("selectionKey is invalid")
  return { selectionKey: value.selectionKey, selectionRef }
}

// A Storage object key, never an arbitrary fetch URL or traversal path.
function storageKey(value, name) {
  const key = reference(value, name)
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes(":") ||
    key.includes("?") ||
    key.includes("#") ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new TypeError(`${name} must be a relative immutable Storage key`)
  return key
}

function projectionReceipt(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is invalid`)
  const key = storageKey(value.key, `${name}.key`)
  if (!SHA256.test(String(value.hash || ""))) throw new TypeError(`${name}.hash is invalid`)
  return { key, hash: value.hash }
}

function artifact(value, expectedSelectionKey) {
  if (!value || value.selectionKey !== expectedSelectionKey || !SHA256.test(value.contentSha256))
    throw new TypeError("artifact must identify the exact selected immutable content")
  const objectKey = storageKey(value.objectKey, "objectKey")
  const verified = {
    selectionKey: expectedSelectionKey,
    contentSha256: value.contentSha256,
    objectKey,
  }
  if (value.projections !== undefined) {
    if (
      !value.projections ||
      typeof value.projections !== "object" ||
      Array.isArray(value.projections)
    )
      throw new TypeError("projections is invalid")
    verified.projections = {
      gene: projectionReceipt(value.projections.gene, "projections.gene"),
      portrait: projectionReceipt(value.projections.portrait, "projections.portrait"),
    }
  }
  return verified
}

export class IconoplasmGenePublicationState {
  constructor(storage, { clock = Date.now, attemptTimeoutMs = 60000 } = {}) {
    if (!storage?.sql?.exec || typeof storage.transaction !== "function")
      throw new TypeError("SQLite Durable Object storage is required")
    this.storage = storage
    this.clock = clock
    this.attemptTimeoutMs = integer(attemptTimeoutMs, "attemptTimeoutMs", 1000)
  }

  install() {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      desired_version INTEGER NOT NULL CHECK (desired_version >= 1),
      selection_key TEXT NOT NULL,
      selection_ref TEXT NOT NULL,
      published_version INTEGER NOT NULL DEFAULT 0,
      published_artifact_json TEXT,
      attempt_id INTEGER NOT NULL DEFAULT 0,
      attempt_open INTEGER NOT NULL DEFAULT 0 CHECK (attempt_open IN (0, 1)),
      failures INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0,
      CHECK (published_version >= 0 AND published_version <= desired_version)
    )`)
  }

  read() {
    const row = this.storage.sql.exec(`SELECT * FROM ${TABLE} WHERE singleton = 1`).toArray()[0]
    if (!row) return null
    return {
      desiredVersion: row.desired_version,
      selectionKey: row.selection_key,
      selectionRef: row.selection_ref,
      publishedVersion: row.published_version,
      publishedArtifact: row.published_artifact_json
        ? JSON.parse(row.published_artifact_json)
        : null,
      attemptId: row.attempt_id,
      attemptOpen: row.attempt_open === 1,
      failures: row.failures,
      retryAt: row.retry_at,
      pending: row.desired_version !== row.published_version,
    }
  }

  async ensureWakeup(at) {
    integer(at, "alarm time", 1)
    const existing = await this.storage.getAlarm()
    // This DO already owns other work. Never erase its alarm, or postpone an
    // earlier caretaker wake. The host must multiplex all of its alarm duties.
    if (existing === null || existing > at) await this.storage.setAlarm(at)
  }

  /**
   * mutate() must be synchronous, use this SAME storage, and return the complete
   * current selection identity (including every public-card-affecting revision).
   * The existing vote reducer retains per-user/per-candidate votes and caretaker
   * semantics. A content-neutral vote returns the same selection identity.
   */
  async commitSelection(mutate) {
    if (typeof mutate !== "function" || mutate.constructor?.name === "AsyncFunction")
      throw new TypeError("synchronous mutation is required")
    return this.storage.transaction(async () => {
      const result = mutate()
      if (result && typeof result.then === "function")
        throw new TypeError("mutation must complete synchronously")
      const desired = await selection(result)
      const prior = this.read()
      if (prior?.selectionKey === desired.selectionKey) {
        if (prior.selectionRef !== desired.selectionRef)
          throw new Error("selection identity was rebound to different source material")
        // Exact duplicate/content-neutral votes spend no publication writes or
        // alarm writes. Previously committed work already has a durable wakeup.
        return { changed: false, state: prior }
      }
      const version = integer((prior?.desiredVersion || 0) + 1, "desiredVersion", 1)
      const now = integer(this.clock(), "clock", 1)
      this.storage.sql.exec(
        `INSERT INTO ${TABLE} (singleton, desired_version, selection_key, selection_ref, retry_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           desired_version = excluded.desired_version,
           selection_key = excluded.selection_key,
           selection_ref = excluded.selection_ref,
           failures = 0, attempt_open = 0, retry_at = excluded.retry_at`,
        version,
        desired.selectionKey,
        desired.selectionRef,
        now,
      )
      // In SQLite DOs, async storage.transaction includes both SQL and alarms.
      // A failed alarm write aborts the vote mutation and dirty-state update.
      await this.ensureWakeup(now)
      return { changed: true, state: this.read() }
    })
  }

  /** Explicit migration only: caller has already verified the old public bytes. */
  async seedPublished(desired, published, { guard } = {}) {
    // The caller proves the prior public bytes exist; the desired identity is
    // recomputed from live authority here, so the artifact is re-signed to the
    // authority's selectionKey instead of a caller-supplied one.
    const valid = await selection(desired)
    const verified = artifact(
      {
        selectionKey: valid.selectionKey,
        contentSha256: published?.contentSha256,
        objectKey: published?.objectKey,
      },
      valid.selectionKey,
    )
    return this.storage.transaction(async () => {
      // A synchronous handover fence: the caller revalidates its migration
      // boundary inside the same exclusive transaction that commits the seed,
      // so a concurrent accepted change aborts instead of certifying stale
      // state. Throwing here rolls the seed back.
      if (typeof guard === "function") guard()
      const prior = this.read()
      if (prior) {
        if (
          prior.pending ||
          prior.selectionKey !== valid.selectionKey ||
          prior.selectionRef !== valid.selectionRef ||
          JSON.stringify(prior.publishedArtifact) !== JSON.stringify(verified)
        )
          throw new Error("migration cannot overwrite existing publication state")
        return { changed: false }
      }
      this.storage.sql.exec(
        `INSERT INTO ${TABLE}
         (singleton, desired_version, selection_key, selection_ref, published_version, published_artifact_json)
         VALUES (1, 1, ?, ?, 1, ?)`,
        valid.selectionKey,
        valid.selectionRef,
        JSON.stringify(verified),
      )
      return { changed: true }
    })
  }

  async beginAttempt() {
    return this.storage.transaction(async () => {
      const current = this.read()
      if (!current?.pending) return null
      const now = integer(this.clock(), "clock", 1)
      if (current.retryAt > now) {
        await this.ensureWakeup(current.retryAt)
        return null
      }
      const attemptId = integer(current.attemptId + 1, "attemptId", 1)
      const retryAt = integer(now + this.attemptTimeoutMs, "retryAt", 1)
      this.storage.sql.exec(
        `UPDATE ${TABLE} SET attempt_id = ?, attempt_open = 1, retry_at = ? WHERE singleton = 1`,
        attemptId,
        retryAt,
      )
      // Persist a timeout wake BEFORE any network call, including on the last
      // platform alarm retry. A crash never leaves an unarmed pending record.
      await this.ensureWakeup(retryAt)
      return {
        desiredVersion: current.desiredVersion,
        selectionKey: current.selectionKey,
        selectionRef: current.selectionRef,
        attemptId,
      }
    })
  }

  matches(current, ticket) {
    return (
      current?.pending &&
      current.attemptOpen &&
      current.desiredVersion === ticket.desiredVersion &&
      current.attemptId === ticket.attemptId &&
      current.selectionKey === ticket.selectionKey &&
      current.selectionRef === ticket.selectionRef
    )
  }

  async completeAttempt(ticket, published) {
    const verified = artifact(published, ticket.selectionKey)
    return this.storage.transaction(async () => {
      const current = this.read()
      if (!this.matches(current, ticket)) return { applied: false }
      this.storage.sql.exec(
        `UPDATE ${TABLE} SET published_version = desired_version,
           published_artifact_json = ?, failures = 0, attempt_open = 0, retry_at = 0 WHERE singleton = 1`,
        JSON.stringify(verified),
      )
      // Do not delete the shared alarm. One already-armed timeout may make an
      // idle call; idle calls write nothing and never schedule another alarm.
      return { applied: true }
    })
  }

  async failAttempt(ticket, { retryAt } = {}) {
    if (retryAt !== undefined) integer(retryAt, "retryAt", 1)
    return this.storage.transaction(async () => {
      const current = this.read()
      if (!this.matches(current, ticket)) return { applied: false }
      const now = integer(this.clock(), "clock", 1)
      const failures = integer(current.failures + 1, "failures", 1)
      const delay = Math.min(3600000, 1000 * 2 ** Math.min(failures - 1, 12))
      const due = integer(Math.max(now + delay, retryAt || 0), "retryAt", 1)
      this.storage.sql.exec(
        `UPDATE ${TABLE} SET failures = ?, attempt_open = 0, retry_at = ? WHERE singleton = 1`,
        failures,
        due,
      )
      await this.ensureWakeup(due)
      return { applied: true, retryAt: due }
    })
  }

  /** Repair a missing local wake on construction, without reading another gene. */
  async recoverWakeup() {
    return this.storage.transaction(async () => {
      const current = this.read()
      if (!current?.pending) return false
      await this.ensureWakeup(Math.max(integer(this.clock(), "clock", 1), current.retryAt))
      return true
    })
  }
}
