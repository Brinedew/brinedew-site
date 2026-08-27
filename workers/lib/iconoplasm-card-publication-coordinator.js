import { CardPublicationRepository, createCardPublication } from "./iconoplasm-card-publication.js"
import { createPublishedCardObjectStore } from "./iconoplasm-published-card-objects.js"

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
        if (this.repo.get("job") || this.repo.get("requested") || this.repo.get("effects"))
          await this.arm(1000)
      })
    }
    exclusive(callback) {
      const next = this.serial.then(callback)
      this.serial = next.catch(() => {})
      return next
    }
    async arm(delay) {
      const due = Date.now() + delay
      const existing = await this.state.storage.getAlarm()
      if (!existing || existing > due) await this.state.storage.setAlarm(due)
    }
    async alarm() {
      return this.exclusive(async () => {
        try {
          const result = await this.publisher.step()
          if (this.repo.get("failure")) this.repo.remove("failure")
          if (result.more) await this.arm(1000)
        } catch (error) {
          const attempts = Number(this.repo.get("failure")?.attempts || 0) + 1
          this.repo.put("failure", {
            attempts,
            message: String(error.message || error).slice(0, 500),
            at: new Date().toISOString(),
          })
          // At-least-once alarms must not exhaust platform retries and abandon
          // durable work. Retry only an existing job, with bounded backoff.
          // A quiet publication has no recurring alarm and does no row writes.
          await this.arm(Math.min(900000, 30000 * 2 ** Math.min(attempts - 1, 5)))
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
