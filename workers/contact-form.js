import { checkAnonymousRateLimit, RATE_LIMIT_OUTCOME } from "./anonymous-rate-limit.js"

/**
 * Contact form endpoint for the brinedew.bio About page.
 *
 * Anonymous submission from a visitor -> Cloudflare Email Sending -> contact@brinedew.bio
 * -> Email Routing rule -> brinedew@proton.me inbox.
 *
 * Input validation and email composition remain feature-local. Anonymous abuse
 * control reuses the stateful Worker's native public rate-limit boundary.
 *
 * It is wired into the same wrangler.toml as the rest of the stateful worker
 * (the one allowed internal stateful worker) and is only reachable through the
 * public edge worker, which itself only runs on the brinedew.bio host routes.
 */

const CONTACT_BODY_MAX = 5000
const CONTACT_EMAIL_MAX = 254
const CONTACT_RATE_LIMIT_POLICY = Object.freeze({
  id: "contact",
  binding: "PUBLIC_RATE_LIMIT_5",
  limit: 5,
  period: 60,
})

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

function buildContactEmail({ body }) {
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
  return { subject, text: body }
}

export async function handleContactSubmission(request, env, ctx, corsHeaders) {
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, { Allow: "POST", ...corsHeaders })
  }

  const rateLimit = await checkAnonymousRateLimit(
    request,
    env?.[CONTACT_RATE_LIMIT_POLICY.binding],
    CONTACT_RATE_LIMIT_POLICY,
    "contact",
  )
  const responseHeaders = {
    ...Object.fromEntries(rateLimit.headers),
    ...corsHeaders,
  }
  if (rateLimit.outcome === RATE_LIMIT_OUTCOME.UNAVAILABLE) {
    console.error("[contact-form] rate limit unavailable", {
      binding: CONTACT_RATE_LIMIT_POLICY.binding,
      error:
        rateLimit.error instanceof Error ? rateLimit.error.message : String(rateLimit.error || ""),
    })
    return jsonError("Contact form protection is temporarily unavailable.", 503, responseHeaders)
  }
  if (rateLimit.outcome === RATE_LIMIT_OUTCOME.LIMITED) {
    return jsonError("Too many submissions. Try again in a minute.", 429, {
      ...responseHeaders,
    })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return jsonError("Invalid JSON", 400, responseHeaders)
  }

  // Honeypot: silently accept and drop. If the hidden field is filled, it's a bot
  // and we don't want to give it a feedback signal.
  const honeypot = sanitizeText(payload?.website || "", 255) || ""
  if (honeypot) {
    return jsonOk({ queued: false, ignored: true }, responseHeaders)
  }

  const fromEmail = sanitizeText(payload?.email || "", CONTACT_EMAIL_MAX)
  const body = sanitizeText(payload?.message || payload?.body || "", CONTACT_BODY_MAX)

  if (!fromEmail || !isValidEmail(fromEmail)) {
    return jsonError("Enter a valid email address.", 422, responseHeaders)
  }
  if (!body || body.length < 3) {
    return jsonError("Write a message of at least 3 characters.", 422, responseHeaders)
  }

  // We do NOT include the visitor's address in the `from` field of the email we
  // send to brinedew@proton.me. Instead we always send from the verified sender
  // (noreply@brinedew.bio) and put the visitor's address in the body. The
  // generated `Reply-To` header in the email would normally be set client-side,
  // but Cloudflare Email Sending's `env.CONTACT_EMAIL.send(...)` API does not
  // currently expose a reply-to parameter, so the body carries the address.
  const emailBody = `From: ${fromEmail}\n\n${body}`
  const { subject: emailSubject, text: emailText } = buildContactEmail({
    body: emailBody,
  })

  if (!env.CONTACT_EMAIL || typeof env.CONTACT_EMAIL.send !== "function") {
    return jsonError("Contact email is not configured on the server.", 503, responseHeaders)
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
    return jsonError("Failed to send the message. Please try again later.", 502, responseHeaders)
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
    responseHeaders,
  )
}
