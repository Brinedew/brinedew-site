import { CardPublicationRepository, createCardPublication } from "./iconoplasm-card-publication.js"
import {
  applyGeneCommit,
  buildGeneDeltaProjection,
  completeCoalesce,
  completeSegmentWrite,
  emptyGeneDeltaState,
  geneDeltaProjectionHash,
  mergeSegmentEntries,
  pendingSegmentBody,
  planGeneDeltaCoalesce,
} from "./iconoplasm-card-gene-delta.js"
import { createPublishedCardObjectStore } from "./iconoplasm-published-card-objects.js"

const PUBLIC_CARD_HEAD_PROJECTION_KEY = "iconoplasm:gallery-version"
const PUBLIC_GENE_DELTA_PROJECTION_KEY = "iconoplasm:gene-delta"

/**
 * B-762 reader view projection. Change-driven only: the caller passes the last
 * advertised canonical JSON, so an idle coordinator performs zero KV writes
 * and a repeat commit performs none either.
 */
export async function projectGeneDelta(env, projection, previousJson = null) {
  const json = geneDeltaProjectionHash(projection)
  if (json === previousJson) return { written: false, deferred: false, json }
  if (!env?.KV) return { written: false, deferred: true, json }
  await env.KV.put(PUBLIC_GENE_DELTA_PROJECTION_KEY, json)
  return { written: true, deferred: false, json }
}

function publicCardHeadProjection(head) {
  if (!head?.current?.version) return null
  return {
    current: head.current.version,
    previous: head.previous?.version || null,
    published_at: head.current.published_at,
    schema: head.current.manifest.schema,
    storage: head.current.manifest.storage,
    manifest_key: head.current.key,
    status: "active",
  }
}

export async function projectPublicCardHead(env, head) {
  const projection = publicCardHeadProjection(head)
  if (!projection || !env?.KV) return projection
  let current = null
  try {
    const raw = await env.KV.get(PUBLIC_CARD_HEAD_PROJECTION_KEY)
    current = raw ? JSON.parse(raw) : null
  } catch {
    current = null
  }
  if (JSON.stringify(current) === JSON.stringify(projection)) {
    return projection
  }
  await env.KV.put(PUBLIC_CARD_HEAD_PROJECTION_KEY, JSON.stringify(projection))
  return projection
}

export function cardPublicationStub(env) {
  const binding = env.ICONOPLASM_CARD_PUBLICATION
  return binding ? binding.get(binding.idFromName("canonical-cards-v2")) : null
}

export async function callCardPublication(env, path, { method = "GET" } = {}) {
  const stub = cardPublicationStub(env)
  if (!stub) throw new Error("Card publication coordinator is not configured")
  const response = await stub.fetch(`https://card-publication.internal${path}`, { method })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Card publication HTTP ${response.status}`)
  return value
}

export function createCardPublicationCoordinatorClass(sourceForEnv) {
  return class IconoplasmCardPublicationCoordinator {
    constructor(state, env) {
      this.state = state
      this.env = env
      this.serial = Promise.resolve()
      this.deltaSerial = Promise.resolve()
      state.blockConcurrencyWhile(async () => {
        this.repo = new CardPublicationRepository(state.storage)
        this.objectStore = createPublishedCardObjectStore(env)
        this.publisher = createCardPublication({
          repository: this.repo,
          objects: this.objectStore,
          source: sourceForEnv(env),
        })
        this.geneDelta = this.repo.get("gene_delta") || emptyGeneDeltaState()
        this.projectedHeadVersion = null
        try {
          const projection = await projectPublicCardHead(env, this.repo.get("head"))
          this.projectedHeadVersion = projection?.current || null
        } catch (error) {
          // A projection outage must not take the canonical head offline. The
          // next alarm retries before doing more publication work.
          this.projectionDeferred = String(error.message || error).slice(0, 500)
        }
        if (
          (this.geneDelta.projection_pending || this.geneDelta.coalesce) &&
          !this.repo.get("job") &&
          !this.repo.get("requested") &&
          !this.repo.get("effects")
        ) {
          try {
            await this.arm(1000, { control: true })
          } catch (error) {
            // A pending reader projection must never take reads offline; the
            // durable state retries on a later wake or restart.
            this.deltaDeferred = String(error.message || error).slice(0, 500)
          }
        }
        if (this.repo.get("job") || this.repo.get("requested") || this.repo.get("effects")) {
          const retryAt = Number(this.repo.get("failure")?.retry_at || 0)
          try {
            await this.arm(1000, {
              control: retryAt > 0,
              at: retryAt > Date.now() ? retryAt : null,
            })
          } catch (error) {
            // A crash after a phase used its last work allocation must not make
            // blockConcurrencyWhile fail and take the old readable head offline.
            try {
              await this.scheduleRetry(error)
            } catch (recoveryError) {
              // Even account-wide storage-write exhaustion must not prevent
              // read-only head access. Durable job state remains; the existing
              // scheduled publication wake retries once writes are available.
              this.recoveryDeferred = String(recoveryError.message || recoveryError).slice(0, 500)
            }
          }
        }
      })
    }
    exclusive(callback) {
      const next = this.serial.then(callback)
      this.serial = next.catch(() => {})
      return next
    }
    async arm(delay, { control = false, at = null } = {}) {
      const now = Date.now()
      const due = Math.max(at ?? now + delay, Number(this.repo.get("failure")?.retry_at || 0))
      const existing = await this.state.storage.getAlarm()
      // Cloudflare can retain a past-due alarm after the account-wide daily
      // write allowance blocked its invocation. That timestamp no longer owns
      // future execution: explicitly replace it after the UTC reset. Keeping
      // it made every later wake look "already scheduled" and stranded an
      // otherwise durable publication job indefinitely.
      if (!existing || existing <= now || existing > due) {
        // setAlarm is a billed SQLite row write, not free scheduling. Reserve
        // that row and the reservation itself; merely checking an existing
        // earlier alarm does not write. Keep quota-day recovery durable.
        this.repo.reserveWrites(2, { control })
        await this.state.storage.setAlarm(due)
      }
    }
    async scheduleRetry(error) {
      const attempts = Number(this.repo.get("failure")?.attempts || 0) + 1
      const retryAt =
        Number(error.retryAt) ||
        Date.now() + Math.min(900000, 30000 * 2 ** Math.min(attempts - 1, 5))
      this.repo.reserveWrites(2, { control: true })
      this.repo.put("failure", {
        attempts,
        message: String(error.message || error).slice(0, 500),
        at: new Date().toISOString(),
        retry_at: retryAt,
      })
      await this.arm(0, { control: true, at: retryAt })
    }
    deltaExclusive(callback) {
      const next = this.deltaSerial.then(callback)
      this.deltaSerial = next.catch(() => {})
      return next
    }

    persistGeneDelta() {
      this.repo.put("gene_delta", this.geneDelta)
    }

    /**
     * B-762 reader view: one owner for the shared per-gene projection. The
     * vote authority hands over verified receipts; this step folds the pending
     * batch into one immutable directory segment, compacts at most one oldest
     * pair when the bounded chain is exceeded, and advertises (KV write) only
     * when the canonical view bytes change. Idle wakes write nothing.
     */
    async projectGeneDeltaStep() {
      return this.deltaExclusive(async () => {
        let state = this.geneDelta
        let coalesce = state.coalesce || planGeneDeltaCoalesce(state)
        if (!state.projection_pending && !coalesce) return { skipped: true }
        if (coalesce) {
          const bodies = new Map()
          for (const segment of state.segments) {
            const object = await this.objectStore.read(segment.key)
            bodies.set(
              segment.seq,
              object?.value || { schema_version: 1, seq: segment.seq, entries: {} },
            )
          }
          const merged = mergeSegmentEntries(bodies, coalesce.mergeSeqs)
          const written = await this.objectStore.write("indexes", merged)
          state = completeCoalesce(state, {
            mergeSeqs: coalesce.mergeSeqs,
            key: written.key,
            hash: written.hash,
          })
          state = { ...state, projection_pending: true }
          this.geneDelta = state
          this.persistGeneDelta()
          return {
            ok: true,
            coalesced: true,
            segments: state.segments.length,
            more: state.segments.length > GENE_DELTA_CHAIN_LIMIT,
          }
        }
        if (state.projection_pending && Object.keys(state.pending).length) {
          const seq = (Number(state.seq) || 0) + 1
          const written = await this.objectStore.write("indexes", pendingSegmentBody(state, seq))
          state = completeSegmentWrite(state, { seq, key: written.key, hash: written.hash })
        }
        const baseVersion = this.repo.get("head")?.current?.version || null
        const projection = buildGeneDeltaProjection({
          baseVersion,
          state,
          committedAt: new Date().toISOString(),
        })
        const advertised = await projectGeneDelta(
          this.env,
          projection,
          state.projected_json || null,
        )
        state = {
          ...state,
          projection_pending: false,
          projected_json: advertised.written ? advertised.json : state.projected_json || null,
        }
        if (planGeneDeltaCoalesce(state)) state = { ...state, projection_pending: true }
        this.geneDelta = state
        this.persistGeneDelta()
        return {
          ok: true,
          segments: state.segments.length,
          entry_count: projection.entry_count,
          advertised: advertised.written,
        }
      })
    }

    async alarm() {
      return this.exclusive(async () => {
        try {
          const existingHead = this.repo.get("head")
          if (existingHead?.current?.version !== this.projectedHeadVersion) {
            const projection = await projectPublicCardHead(this.env, existingHead)
            this.projectedHeadVersion = projection?.current || null
            this.projectionDeferred = null
          }
          const result = await this.publisher.step()
          await this.projectGeneDeltaStep()
          if (result.committed) {
            const projection = await projectPublicCardHead(this.env, this.repo.get("head"))
            this.projectedHeadVersion = projection?.current || null
          }
          if (this.repo.get("failure")) {
            this.repo.reserveWrites(2)
            this.repo.remove("failure")
          }
          if (result.more) await this.arm(1000)
        } catch (error) {
          // At-least-once alarms must not exhaust platform retries and abandon
          // durable work. Retry only an existing job, with bounded backoff.
          // A quiet publication has no recurring alarm and does no row writes.
          await this.scheduleRetry(error)
        }
      })
    }
    async fetch(request) {
      const path = new URL(request.url).pathname
      const reply = (body, status = 200) =>
        Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
      // Readers are deliberately outside the mutation queue. Slow Bunny PUTs
      // cannot lower the priority of existing published card reads.
      if (request.method === "GET" && path === "/head") {
        const head = this.repo.get("head")
        return reply(
          head
            ? {
                current: head.current.version,
                previous: head.previous?.version || null,
                published_at: head.current.published_at,
                schema: head.current.manifest.schema,
                storage: head.current.manifest.storage,
                manifest_key: head.current.key,
              }
            : { current: null, migration_pending: true },
        )
      }
      if (request.method === "GET" && path === "/status") {
        const { head, job, requested, effects } = this.publisher.status()
        return reply({
          current: head?.current.version || null,
          previous: head?.previous?.version || null,
          watermark: head?.watermark || null,
          published_at: head?.current.published_at || null,
          card_count: head?.current.manifest.card_count || 0,
          requested: Boolean(requested),
          job: job
            ? {
                bootstrap: job.bootstrap,
                group: job.group,
                groups: job.groups.length,
                offset: job.offset,
                started_at: job.started_at,
              }
            : null,
          effects: effects ? { offset: effects.offset, total: effects.symbols.length } : null,
          write_allocation: this.repo.get("write_allocation"),
          failure: this.repo.get("failure"),
          recovery_deferred: this.recoveryDeferred || null,
          projection_deferred: this.projectionDeferred || null,
        })
      }
      if (request.method === "GET" && path === "/gene-delta-status") {
        return reply({
          ok: true,
          base: this.repo.get("head")?.current?.version || null,
          seq: this.geneDelta.seq,
          segments: this.geneDelta.segments.length,
          pending: Object.keys(this.geneDelta.pending).length,
          projection_pending: this.geneDelta.projection_pending,
          advertised: Boolean(this.geneDelta.projected_json),
        })
      }
      if (request.method !== "POST") return reply({ error: "Not found" }, 404)
      // Revision-checked per-gene handover from the vote authority. This is a
      // short local state update; the immutable directory write and KV
      // advertisement happen on the change-driven alarm step.
      if (path === "/commit-gene-version") {
        const payload = await request.json().catch(() => ({}))
        return await this.deltaExclusive(async () => {
          try {
            const outcome = applyGeneCommit(this.geneDelta, payload)
            if (!outcome.accepted) {
              return reply({ ok: true, accepted: false, replayed: true, seq: this.geneDelta.seq })
            }
            this.geneDelta = outcome.state
            this.persistGeneDelta()
            await this.arm(1000, { control: true })
            return reply({
              ok: true,
              accepted: true,
              replayed: false,
              seq: this.geneDelta.seq,
              version: outcome.entry.version,
            })
          } catch (error) {
            const conflict =
              error?.code === "STALE_GENE_COMMIT" || error?.code === "GENE_COMMIT_CONFLICT"
            return reply(
              {
                ok: false,
                code: String(error?.code || "GENE_COMMIT_REJECTED"),
                error: String(error.message || error),
              },
              conflict ? 409 : 400,
            )
          }
        })
      }
      // Per-gene materialization must never sit behind another gene's external
      // object I/O. It touches no shared publication head/job state, and
      // content-addressed immutable writes are safe to run concurrently, so it
      // deliberately bypasses the global publication queue.
      if (path === "/materialize-symbol") {
        if (String(this.env?.ICONOPLASM_SCHEMA_TRANSITION || "") === "1") {
          return reply(
            {
              ok: false,
              code: "SCHEMA_TRANSITION",
              retry_after_ms: 300000,
              error: "Card materialization is deferred during the schema transition",
            },
            503,
          )
        }
        try {
          const payload = await request.json().catch(() => ({}))
          const result = await this.publisher.materializeSymbol(payload?.symbol, {
            portraitAssetSha256: payload?.portrait_asset_sha256 || null,
            withdraw: payload?.withdraw === true,
          })
          // Per-gene publication completes when its immutable objects are
          // written and verified. The global head, watermark and job are
          // deliberately untouched, so one gene never waits for others.
          return reply({ ok: true, ...result })
        } catch (error) {
          return reply(
            {
              ok: false,
              code: String(error?.code || "MATERIALIZATION_FAILED"),
              error: String(error.message || error),
            },
            503,
          )
        }
      }
      try {
        return await this.exclusive(async () => {
          if (path === "/bootstrap") await this.publisher.bootstrap()
          else if (path === "/wake") {
            if (!this.repo.get("head") && !this.repo.get("job"))
              return reply({ accepted: false, migration_pending: true }, 200)
            this.publisher.wake()
          } else return reply({ error: "Not found" }, 404)
          // Coalesce nearby votes for 10s; one person's vote never synchronously
          // pays to build the public catalog. Target 1-2min, not a strict SLA.
          await this.arm(path === "/bootstrap" ? 1000 : 10000)
          return reply({ accepted: true }, 202)
        })
      } catch (error) {
        return reply({ error: String(error.message || error) }, 503)
      }
    }
  }
}
