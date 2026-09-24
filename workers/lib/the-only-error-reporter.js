// B-832: the one production error reporter for both Workers.
//
// A hand-rolled Sentry envelope instead of @sentry/cloudflare: the Free plan
// gives a Worker 10 ms of CPU and a 3 MB bundle, and the SDK would wrap every
// request. This costs nothing on the success path; only a thrown error or a
// 5xx sends one event, after the response, through ctx.waitUntil. The DSN's
// key is rate-limited in Sentry (300 events/hour) so a storm cannot exhaust
// the free quota. Nothing identifying leaves the Worker: no query string, no
// cookies, tokens or client IPs.

const DROPPED_HEADERS =
  /^(authorization|cookie|set-cookie|x-iconoplasm-|cf-connecting-ip|x-forwarded-for|x-real-ip|true-client-ip)/i
const KEPT_HEADERS = new Set(["user-agent", "referer", "origin", "content-type", "accept"])

function parseDsn(dsn) {
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\/+/, "")
    if (!url.username || !projectId) return null
    return { key: url.username, origin: `${url.protocol}//${url.host}`, projectId }
  } catch {
    return null
  }
}

// Per-gene and per-id paths group into one issue: any segment with a digit or
// an uppercase letter, or longer than 24 characters, becomes ":x".
export function routeFingerprint(pathname) {
  return String(pathname || "/")
    .split("/")
    .map((segment) => (/[0-9A-Z]/.test(segment) || segment.length > 24 ? ":x" : segment))
    .join("/")
}

function eventId() {
  return crypto.randomUUID().replaceAll("-", "")
}

function scrubbedHeaders(request) {
  const out = {}
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase()
    if (DROPPED_HEADERS.test(lower) || !KEPT_HEADERS.has(lower)) continue
    out[lower] = String(value).slice(0, 256)
  }
  return out
}

function buildEvent({ env, request, worker, error, status }) {
  const url = new URL(request.url)
  const route = routeFingerprint(url.pathname)
  const title = error
    ? String(error?.message || error).slice(0, 500)
    : `HTTP ${status} ${request.method} ${route}`
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    logger: worker,
    server_name: worker,
    release: env.SENTRY_RELEASE || undefined,
    environment: env.SENTRY_ENVIRONMENT || "production",
    transaction: `${request.method} ${route}`,
    fingerprint: error ? ["{{ default }}", route] : [worker, String(status), request.method, route],
    tags: { worker, status: String(status || 500), host: url.host },
    request: {
      method: request.method,
      url: `${url.origin}${url.pathname}`,
      headers: scrubbedHeaders(request),
    },
    ...(error
      ? {
          exception: {
            values: [
              {
                type: String(error?.name || "Error"),
                value: title,
                ...(error?.stack
                  ? {
                      stacktrace: {
                        frames: [
                          { filename: worker, function: String(error.stack).slice(0, 2000) },
                        ],
                      },
                    }
                  : {}),
              },
            ],
          },
        }
      : { message: { formatted: title } }),
  }
}

function send(env, ctx, details, fetcher) {
  const dsn = parseDsn(env?.SENTRY_DSN)
  if (!dsn || typeof ctx?.waitUntil !== "function") return
  try {
    const event = buildEvent({ env, ...details })
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n")
    ctx.waitUntil(
      Promise.resolve()
        .then(() =>
          fetcher(`${dsn.origin}/api/${dsn.projectId}/envelope/`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-sentry-envelope",
              "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=brinedew-worker/1`,
            },
            body,
          }),
        )
        .catch(() => {}),
    )
  } catch {
    // Reporting must never change what the reader receives.
  }
}

export async function withErrorReporting(env, ctx, request, worker, run, { fetcher = fetch } = {}) {
  let response
  try {
    response = await run()
  } catch (error) {
    send(env, ctx, { request, worker, error, status: 500 }, fetcher)
    throw error
  }
  if (response && response.status >= 500) {
    send(env, ctx, { request, worker, status: response.status }, fetcher)
  }
  return response
}
