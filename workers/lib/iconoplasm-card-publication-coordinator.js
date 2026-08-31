import { CardPublicationRepository, createCardPublication } from "./iconoplasm-card-publication.js"
import { createPublishedCardObjectStore } from "./iconoplasm-published-card-objects.js"

const PUBLIC_CARD_HEAD_PROJECTION_KEY = "iconoplasm:gallery-version"

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
      state.blockConcurrencyWhile(async () => {
        this.repo = new CardPublicationRepository(state.storage)
        this.publisher = createCardPublication({
          repository: this.repo,
          objects: createPublishedCardObjectStore(env),
          source: sourceForEnv(env),
        })
        this.projectedHeadVersion = null
        try {
          const projection = await projectPublicCardHead(env, this.repo.get("head"))
          this.projectedHeadVersion = projection?.current || null
        } catch (error) {
          // A projection outage must not take the canonical head offline. The
          // next alarm retries before doing more publication work.
          this.projectionDeferred = String(error.message || error).slice(0, 500)
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
      const due = Math.max(
        at ?? Date.now() + delay,
        Number(this.repo.get("failure")?.retry_at || 0),
      )
      const existing = await this.state.storage.getAlarm()
      if (!existing || existing > due) {
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
      if (request.method !== "POST") return reply({ error: "Not found" }, 404)
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
