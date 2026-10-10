// B-1065: the factory saves a gene's text and its Tags as one plain row
// (icono_gene_texts, migration 0024). It replaces the old system-revision path:
// two encrypted Bunny uploads, an event log, a replica and an outbox, for what is
// one overwrite of one row.
//
// A gene is named by its symbol. A symbol new to the catalogue gets the identity
// derived from it (catalogueGeneId), so the workstation never needs to know a
// gene ID. Saving the same text and Tags again changes nothing, so a retry after
// a lost answer costs one read.
import { canonicalManifestationFieldsJson } from "./caretaker/manifestation-tags-payload.js"
import { registerGeneIdentity } from "./caretaker/caretaker-assignment-commands.js"
import { normalizeManifestationProse } from "../lib/iconoplasm-manifestation-prose.js"
import { normalizeManifestationTags } from "../lib/iconoplasm-manifestation-tags.js"
import { sha256Hex } from "../lib/iconoplasm-sha256.js"

export class GeneTextError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = "GeneTextError"
    this.code = code
    this.status = status
  }
}

function invalid(code, error) {
  return new GeneTextError(code, String(error?.message || error))
}

function normalizeInput({ text, tags, fields }) {
  let prose
  try {
    prose = normalizeManifestationProse(text)
  } catch (error) {
    throw invalid("TEXT_INVALID", error)
  }
  let normalizedTags = null
  if (tags != null) {
    try {
      normalizedTags = normalizeManifestationTags(tags).tags
    } catch (error) {
      throw invalid("TAGS_INVALID", error)
    }
  }
  let fieldsJson = null
  if (fields != null) {
    try {
      fieldsJson = canonicalManifestationFieldsJson(fields)
    } catch (error) {
      throw invalid("FIELDS_INVALID", error)
    }
  }
  return { prose, tags: normalizedTags, fieldsJson }
}

// B-1031: a gene new to the catalogue has no identity until its first text
// arrives. Its ID is derived from its symbol, so the workstation and the site
// agree on it without a round trip, and no caller can register an arbitrary ID.
export async function catalogueGeneId(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  return `gene_${(await sha256Hex(`iconoplasm-gene:${normalized}`)).slice(0, 48)}`
}

async function geneIdFor(db, symbol) {
  const known = await db
    .prepare("SELECT gene_id FROM icono_gene_identities WHERE canonical_symbol = ? COLLATE NOCASE")
    .bind(symbol)
    .first()
  if (known) return { geneId: known.gene_id, registered: false }
  const geneId = await catalogueGeneId(symbol)
  await registerGeneIdentity(db, { geneId, canonicalSymbol: symbol })
  return { geneId, registered: true }
}

export async function writeFactoryGeneText(env, { symbol, text, tags, fields }) {
  const db = env?.ICONOPLASM_AUTHORING_DB
  if (!db)
    throw new GeneTextError("AUTHORING_DB_MISSING", "ICONOPLASM_AUTHORING_DB is not bound", 503)
  const input = normalizeInput({ text, tags, fields })
  const textSha256 = await sha256Hex(input.prose.bytes)
  const { geneId, registered } = await geneIdFor(db, symbol)
  const current = await db
    .prepare(
      `SELECT text_id, version, text_sha256, tags, fields_json
         FROM icono_gene_texts WHERE gene_id = ?`,
    )
    .bind(geneId)
    .first()
  if (
    current &&
    current.text_sha256 === textSha256 &&
    current.tags === input.tags &&
    current.fields_json === input.fieldsJson
  ) {
    return {
      symbol,
      gene_id: geneId,
      text_id: current.text_id,
      version: Number(current.version),
      text_sha256: textSha256,
      changed: false,
    }
  }
  const textId = `text_${crypto.randomUUID().replaceAll("-", "")}`
  const version = Number(current?.version || 0) + 1
  // The version check makes two racing saves of one gene end with one winner,
  // not a lost update numbered like the winner.
  const result = await db
    .prepare(
      `INSERT INTO icono_gene_texts
         (gene_id, text_id, version, text, text_sha256, tags, fields_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (gene_id) DO UPDATE SET
         text_id = excluded.text_id, version = excluded.version, text = excluded.text,
         text_sha256 = excluded.text_sha256, tags = excluded.tags,
         fields_json = excluded.fields_json, updated_at = CURRENT_TIMESTAMP
       WHERE icono_gene_texts.version = ?`,
    )
    .bind(
      geneId,
      textId,
      version,
      input.prose.prose,
      textSha256,
      input.tags,
      input.fieldsJson,
      version - 1,
    )
    .run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw new GeneTextError(
      "TEXT_VERSION_CONFLICT",
      "Another save of this gene's text landed first; send it again",
      409,
    )
  }
  return {
    symbol,
    gene_id: geneId,
    text_id: textId,
    version,
    text_sha256: textSha256,
    changed: true,
    ...(registered ? { registered: true } : {}),
  }
}
