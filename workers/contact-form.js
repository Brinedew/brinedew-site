/**
 * Contact form endpoint for the brinedew.bio About page.
 *
 * Anonymous submission from a visitor -> Cloudflare Email Sending -> contact@brinedew.bio
 * -> Email Routing rule -> brinedew@proton.me inbox.
 *
 * This is intentionally a self-contained module: Turnstile verification, per-IP rate
 * limiting, input sanitization, and email composition all live here so the contact
 * feature has zero coupling to the Iconoplasm or GeneGuessr domains that share this
 * stateful worker.
 *
 * It is wired into the same wrangler.toml as the rest of the stateful worker
 * (the one allowed internal stateful worker) and is only reachable through the
 * public edge worker, which itself only runs on the brinedew.bio host routes.
 */

const CONTACT_BODY_MAX = 5000
const CONTACT_EMAIL_MAX = 254
const RATE_LIMIT_PER_MIN = 5
const RATE_WINDOW_MS = 60_000

// Per-isolate Map keyed by `${routeKey}:${ip}`. Mirrors the pattern the artist-blacklist
// endpoint uses; this is fine because the contact form is low-traffic and the per-isolate
// state is naturally bounded by the number of unique visitors in a minute.
const rlBuckets = new Map()

function rateLimit(request, routeKey, maxPerMin) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown"
  const key = `${routeKey}:${ip}`
  const now = Date.now()
  const item = rlBuckets.get(key)
  if (!item || now - item.start > RATE_WINDOW_MS) {
    const fresh = { start: now, count: 1 }
    rlBuckets.set(key, fresh)
    return {
      retryAfterSeconds: null,
      headers: {
        "X-RateLimit-Limit": String(maxPerMin),
        "X-RateLimit-Period": String(Math.floor(RATE_WINDOW_MS / 1000)),
        "X-RateLimit-Remaining": String(Math.max(0, maxPerMin - fresh.count)),
        "X-RateLimit-Reset": String(Math.ceil(RATE_WINDOW_MS / 1000)),
      },
    }
  }
  item.count += 1
  const resetSeconds = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - item.start)) / 1000))
  if (item.count > maxPerMin) {
    return {
      retryAfterSeconds: resetSeconds,
      headers: {
        "X-RateLimit-Limit": String(maxPerMin),
        "X-RateLimit-Period": String(Math.floor(RATE_WINDOW_MS / 1000)),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(resetSeconds),
      },
    }
  }
  return {
    retryAfterSeconds: null,
    headers: {
      "X-RateLimit-Limit": String(maxPerMin),
      "X-RateLimit-Period": String(Math.floor(RATE_WINDOW_MS / 1000)),
      "X-RateLimit-Remaining": String(Math.max(0, maxPerMin - item.count)),
      "X-RateLimit-Reset": String(resetSeconds),
    },
  }
}

// Mirror the artist-blacklist sanitizer. Empty input becomes null so the
// caller can distinguish "missing" from "present and short".
function sanitizeText(raw, maxLen) {
  const v = String(raw || "").trim()
  if (!v) return null
  return v.slice(0, maxLen)
}

function jsonError(message, status, extraHeaders = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  })
}

function jsonOk(extra = {}, extraHeaders = {}) {
  return new Response(JSON.stringify({ ok: true, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  })
}

function isValidEmail(value) {
  // Pragmatic check: local@domain.tld with reasonable length and no whitespace.
  // Not RFC-strict, but Cloudflare's Email Sending will reject malformed addresses
  // server-side anyway.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= CONTACT_EMAIL_MAX
}

function buildContactEmail({ fromEmail, body, meta }) {
  const submittedAt = new Date()
  // "Contact form at brinedew.bio - 26 Jun 2026, 04:57 UTC"
  const formatted =
    submittedAt.toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " UTC"
  const subject = `Contact form at brinedew.bio - ${formatted}`
  const lines = [
    `From: ${fromEmail}`,
    "",
    body,
    "",
    "---",
    `Reply to: ${fromEmail}`,
    `Submitted: ${submittedAt.toISOString()}`,
    `Origin: ${meta?.origin || "(unknown)"}`,
    `User agent: ${meta?.userAgent || "(unknown)"}`,
    `CF-Connecting-IP: ${meta?.ip || "(unknown)"}`,
  ]
  return { subject, text: lines.join("\n") }
}

export async function handleContactSubmission(request, env, ctx, corsHeaders) {
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, { Allow: "POST", ...corsHeaders })
  }

  const rl = rateLimit(request, "contact", RATE_LIMIT_PER_MIN)
  if (rl.retryAfterSeconds !== null) {
    return jsonError("Too many submissions. Try again in a minute.", 429, {
      ...rl.headers,
      ...corsHeaders,
    })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return jsonError("Invalid JSON", 400, { ...rl.headers, ...corsHeaders })
  }

  // Honeypot: silently accept and drop. If the hidden field is filled, it's a bot
  // and we don't want to give it a feedback signal.
  const honeypot = sanitizeText(payload?.website || "", 255) || ""
  if (honeypot) {
    return jsonOk({ queued: false, ignored: true }, { ...rl.headers, ...corsHeaders })
  }

  const fromEmail = sanitizeText(payload?.email || "", CONTACT_EMAIL_MAX)
  const body = sanitizeText(payload?.message || payload?.body || "", CONTACT_BODY_MAX)

  if (!fromEmail || !isValidEmail(fromEmail)) {
    return jsonError("Enter a valid email address.", 422, { ...rl.headers, ...corsHeaders })
  }
  if (!body || body.length < 3) {
    return jsonError("Write a message of at least 3 characters.", 422, {
      ...rl.headers,
      ...corsHeaders,
    })
  }

  // We do NOT include the visitor's address in the `from` field of the email we
  // send to brinedew@proton.me. Instead we always send from the verified sender
  // (noreply@brinedew.bio) and put the visitor's address in the body. The
  // generated `Reply-To` header in the email would normally be set client-side,
  // but Cloudflare Email Sending's `env.CONTACT_EMAIL.send(...)` API does not
  // currently expose a reply-to parameter, so the body carries the address.
  const { subject: emailSubject, text: emailText } = buildContactEmail({
    fromEmail,
    body,
    meta: {
      origin: request.headers.get("Origin") || "(none)",
      userAgent: request.headers.get("User-Agent") || "(none)",
      ip: request.headers.get("CF-Connecting-IP") || "(none)",
    },
  })

  if (!env.CONTACT_EMAIL || typeof env.CONTACT_EMAIL.send !== "function") {
    return jsonError("Contact email is not configured on the server.", 503, {
      ...rl.headers,
      ...corsHeaders,
    })
  }

  let sendResult
  try {
    sendResult = await env.CONTACT_EMAIL.send({
      to: "brinedew@proton.me",
      from: "noreply@brinedew.bio",
      subject: emailSubject,
      text: emailText,
    })
  } catch (error) {
    return jsonError("Failed to send the message. Please try again later.", 502, {
      ...rl.headers,
      ...corsHeaders,
    })
  }

  // Mirror the message to KV so we have a durable record. The KV namespace
  // is the same one the rest of the worker uses; we prefix our keys so
  // contact entries never collide with anything else.
  if (env.KV) {
    const messageId = "contact-inbox:" + new Date().toISOString() + ":" + crypto.randomUUID()
    const record = {
      id: messageId,
      received_at: new Date().toISOString(),
      from_email: fromEmail,
      subject: emailSubject,
      body,
      origin: request.headers.get("Origin") || null,
      user_agent: request.headers.get("User-Agent") || null,
      ip: request.headers.get("CF-Connecting-IP") || null,
      cloudflare_send_message_id: sendResult?.messageId || null,
    }
    const write = env.KV.put(messageId, JSON.stringify(record), {
      // Keep contact records for 365 days. They are not the primary delivery
      // mechanism (Email Routing is), only a backup / audit log.
      expirationTtl: 60 * 60 * 24 * 365,
    })
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(write)
    } else {
      await write
    }
  }

  return jsonOk(
    {
      queued: true,
      messageId: sendResult?.messageId || null,
    },
    { ...rl.headers, ...corsHeaders },
  )
}
