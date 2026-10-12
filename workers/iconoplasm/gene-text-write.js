// B-1065: the factory saves a gene's text and its Tags as one plain row
// (icono_gene_texts, main migration 0125). It replaces the old system-revision
// path: two encrypted Bunny uploads, an event log, a replica and an outbox, for
// what is one overwrite of one row.
//
// A gene is named by its symbol. A symbol new to the site gets the gene ID
// derived from it (catalogueGeneId), the ID generation requests record, so the
// workstation never needs to know one. Saving the same text and Tags again
// changes nothing, so a retry after a lost answer costs one read.
import { canonicalManifestationFieldsJson } from "./caretaker/manifestation-tags-payload.js"
import { geneSymbol } from "../lib/iconoplasm-gene-text.js"
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

// B-1031: a gene new to the site has no ID until its first text arrives. Its
// ID is derived from its symbol, so the workstation and the site agree on it
// without a round trip, and no caller can register an arbitrary ID.
export async function catalogueGeneId(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  return `gene_${(await sha256Hex(`iconoplasm-gene:${normalized}`)).slice(0, 48)}`
}

export async function writeFactoryGeneText(env, { symbol: rawSymbol, text, tags, fields }) {
  const db = env?.ICONOPLASM_DB
  if (!db) throw new GeneTextError("TEXT_DB_MISSING", "ICONOPLASM_DB is not bound", 503)
  const symbol = geneSymbol(rawSymbol)
  const input = normalizeInput({ text, tags, fields })
  const textSha256 = await sha256Hex(input.prose.bytes)
  const current = await db
    .prepare(
      `SELECT gene_id, text_id, version, text_sha256, tags, fields_json
         FROM icono_gene_texts WHERE gene_symbol = ?`,
    )
    .bind(symbol)
    .first()
  const geneId = current?.gene_id || (await catalogueGeneId(symbol))
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
         (gene_symbol, gene_id, text_id, version, text, text_sha256, tags, fields_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (gene_symbol) DO UPDATE SET
         text_id = excluded.text_id, version = excluded.version, text = excluded.text,
         text_sha256 = excluded.text_sha256, tags = excluded.tags,
         fields_json = excluded.fields_json, updated_at = CURRENT_TIMESTAMP
       WHERE icono_gene_texts.version = ?`,
    )
    .bind(
      symbol,
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
    ...(current ? {} : { registered: true }),
  }
}

export const GENE_TEXT_PAGE_SIZE = 200

// B-1065: the workstation reads the site's texts back in pages ordered by gene
// symbol (`next_after` is opaque to it). `chosen: "factory"` lists every gene's
// factory text (the workstation's first run fills prompts.db from it);
// `chosen: "caretaker"` lists only the genes whose caretaker choice replaces it,
// with the chosen version's text, so the workstation draws those portraits from
// what the caretaker picked.
export async function listGeneTexts(env, { chosen = "factory", after = null } = {}) {
  const db = env?.ICONOPLASM_DB
  if (!db) throw new GeneTextError("TEXT_DB_MISSING", "ICONOPLASM_DB is not bound", 503)
  const sql =
    chosen === "caretaker"
      ? `SELECT g.gene_id, g.gene_symbol AS symbol, v.version_id, v.version,
                v.text, v.text_sha256, v.tags, v.fields_json, v.created_at AS updated_at
           FROM icono_gene_texts g
           JOIN icono_caretaker_text_versions v
             ON v.version_id = g.chosen_caretaker_version_id AND v.withdrawn_at IS NULL
          WHERE g.chosen_caretaker_version_id IS NOT NULL AND g.gene_symbol > ?
          ORDER BY g.gene_symbol LIMIT ?`
      : `SELECT g.gene_id, g.gene_symbol AS symbol, g.text_id, g.version,
                g.text, g.text_sha256, g.tags, g.fields_json, g.updated_at
           FROM icono_gene_texts g
          WHERE g.gene_symbol > ?
          ORDER BY g.gene_symbol LIMIT ?`
  const { results = [] } = await db
    .prepare(sql)
    .bind(after || "", GENE_TEXT_PAGE_SIZE + 1)
    .all()
  const page = results.slice(0, GENE_TEXT_PAGE_SIZE).map((row) => ({
    ...row,
    version: Number(row.version),
    fields: row.fields_json ? JSON.parse(row.fields_json) : null,
    fields_json: undefined,
  }))
  return {
    ok: true,
    chosen,
    texts: page,
    next_after: results.length > GENE_TEXT_PAGE_SIZE ? page.at(-1).symbol : null,
  }
}
