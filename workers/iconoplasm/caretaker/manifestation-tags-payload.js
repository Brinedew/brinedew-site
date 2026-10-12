import { authorityError } from "./manifestation-authority-contract.js"

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
