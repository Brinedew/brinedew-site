import { authorityError } from "./manifestation-authority-contract.js"

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder("utf-8", { fatal: true })

function bytesToBase64Url(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlToBytes(raw) {
  const value = String(raw || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, "="))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function cursorKey(secret) {
  const value = String(secret || "")
  if (ENCODER.encode(value).byteLength < 32) {
    throw new Error("A distinct manifestation cursor HMAC secret of at least 32 bytes is required")
  }
  return crypto.subtle.importKey(
    "raw",
    ENCODER.encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

export async function encodeCursor(secret, payload) {
  const body = bytesToBase64Url(ENCODER.encode(JSON.stringify(payload)))
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await cursorKey(secret), ENCODER.encode(body)),
  )
  return `${body}.${bytesToBase64Url(signature)}`
}

export async function decodeCursor(secret, raw, expectedKind) {
  if (!raw) return null
  const encoded = String(raw)
  if (encoded.length > 2048) throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  const [body, signature, extra] = encoded.split(".")
  if (
    !body ||
    !signature ||
    extra ||
    body.length > 1500 ||
    !/^[A-Za-z0-9_-]+$/.test(body) ||
    signature.length !== 43 ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  }
  let verified = false
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      await cursorKey(secret),
      base64UrlToBytes(signature),
      ENCODER.encode(body),
    )
  } catch {
    verified = false
  }
  if (!verified) throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  let payload
  try {
    payload = JSON.parse(DECODER.decode(base64UrlToBytes(body)))
  } catch {
    throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  }
  if (payload?.kind !== expectedKind || payload?.version !== 1) {
    throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  }
  return payload
}
