import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import { normalizeManifestationTags } from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import { authorityError, normalizeSha256 } from "./manifestation-authority-contract.js"

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder("utf-8", { fatal: true })
const MAX_DEPTH = 16
const MAX_NODES = 4096

function compareCodePoints(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0))
  const b = Array.from(right, (character) => character.codePointAt(0))
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

function validateFields(value, state, depth = 0) {
  state.nodes += 1
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    throw authorityError("INVALID_TAG_FIELDS", "Structured Tags fields exceed nesting limits")
  }
  if (value == null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    throw authorityError(
      "NUMERIC_TAG_FIELD_FORBIDDEN",
      "Structured Tags fields cannot contain numbers",
    )
  }
  if (Array.isArray(value)) return value.map((entry) => validateFields(entry, state, depth + 1))
  if (typeof value !== "object") {
    throw authorityError(
      "INVALID_TAG_FIELDS",
      "Structured Tags fields contain an unsupported value",
    )
  }
  const normalized = Object.create(null)
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    if (/\u0000/u.test(key))
      throw authorityError("INVALID_TAG_FIELDS", "Structured Tags field key is invalid")
    normalized[key] = validateFields(value[key], state, depth + 1)
  }
  return normalized
}

function asciiJsonString(value) {
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

export function canonicalManifestationFieldsJson(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw authorityError("INVALID_TAG_FIELDS", "Structured Tags fields must be a JSON object")
  }
  return asciiJsonString(validateFields(raw, { nodes: 0 }))
}

export async function prepareManifestationTagsPayload(input = {}) {
  const normalized = normalizeManifestationTags(input.tagsText)
  const fieldsJson = canonicalManifestationFieldsJson(input.fieldsJson)
  const fieldsBytes = ENCODER.encode(fieldsJson)
  const tagsSha256 = await sha256Hex(normalized.bytes)
  const fieldsSha256 = await sha256Hex(fieldsBytes)
  if (normalizeSha256(input.tagsSha256, "tags_sha256") !== tagsSha256) {
    throw authorityError("TAGS_HASH_MISMATCH", "Tags text SHA-256 does not match", 409)
  }
  if (normalizeSha256(input.fieldsSha256, "fields_sha256") !== fieldsSha256) {
    throw authorityError(
      "TAG_FIELDS_HASH_MISMATCH",
      "Structured Tags fields SHA-256 does not match",
      409,
    )
  }
  const outputPlain = `${normalized.tags}\n${fieldsJson}`
  const outputBytes = ENCODER.encode(outputPlain)
  if (outputBytes.byteLength > 32 * 1024) {
    throw authorityError("TAGS_OUTPUT_TOO_LARGE", "Combined Tags output exceeds 32 KiB")
  }
  return Object.freeze({
    output_plain: outputPlain,
    output_plain_sha256: await sha256Hex(outputBytes),
    output_plain_bytes: outputBytes.byteLength,
    tags_text: normalized.tags,
    tags_sha256: tagsSha256,
    tags_bytes: normalized.bytes.byteLength,
    fields_json: JSON.parse(fieldsJson),
    fields_canonical_json: fieldsJson,
    fields_sha256: fieldsSha256,
    fields_bytes: fieldsBytes.byteLength,
  })
}

export async function splitManifestationTagsPayload(outputPlain, descriptor = {}) {
  const bytes = ENCODER.encode(String(outputPlain || ""))
  const tagsBytes = Number(descriptor.tagsBytes)
  const fieldsBytes = Number(descriptor.fieldsBytes)
  if (
    !Number.isSafeInteger(tagsBytes) ||
    tagsBytes < 1 ||
    !Number.isSafeInteger(fieldsBytes) ||
    fieldsBytes < 2 ||
    bytes.byteLength !== tagsBytes + 1 + fieldsBytes ||
    bytes[tagsBytes] !== 0x0a
  ) {
    throw authorityError("TAGS_OUTPUT_INVALID", "Combined Tags output framing is invalid", 503)
  }
  const tagsText = DECODER.decode(bytes.slice(0, tagsBytes))
  const fieldsCanonical = DECODER.decode(bytes.slice(tagsBytes + 1))
  let fieldsJson
  try {
    fieldsJson = JSON.parse(fieldsCanonical)
  } catch {
    throw authorityError("TAGS_OUTPUT_INVALID", "Structured Tags fields are invalid", 503)
  }
  if (canonicalManifestationFieldsJson(fieldsJson) !== fieldsCanonical) {
    throw authorityError("TAGS_OUTPUT_INVALID", "Structured Tags fields are not canonical", 503)
  }
  const tagsSha256 = await sha256Hex(bytes.slice(0, tagsBytes))
  const fieldsSha256 = await sha256Hex(bytes.slice(tagsBytes + 1))
  if (
    tagsSha256 !== normalizeSha256(descriptor.tagsSha256, "tags_sha256") ||
    fieldsSha256 !== normalizeSha256(descriptor.fieldsSha256, "fields_sha256")
  ) {
    throw authorityError("TAGS_OUTPUT_INVALID", "Structured Tags hashes failed verification", 503)
  }
  return Object.freeze({
    tags_text: tagsText,
    tags_sha256: tagsSha256,
    fields_json: fieldsJson,
    fields_sha256: fieldsSha256,
  })
}
