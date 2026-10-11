// B-1065: the text a gene uses now, from the plain tables of authoring migration
// 0024. The gene uses the caretaker version it chose when there is one and it is
// not withdrawn; otherwise the factory's text. One D1 read, no Bunny.
//
// The answer carries the text's Tags, which stay private (B-859): card builders
// take only what publicGeneText returns.
const GENE_TEXT_SQL = `
SELECT g.gene_id, g.canonical_symbol, g.status AS gene_status,
       t.text_id, t.version, t.text, t.text_sha256, t.tags, t.fields_json, t.readers_see,
       v.version_id AS ct_version_id, v.line_id AS ct_line_id, v.version AS ct_version,
       v.text AS ct_text, v.text_sha256 AS ct_text_sha256, v.tags AS ct_tags,
       v.fields_json AS ct_fields_json, v.readers_see AS ct_readers_see
  FROM icono_gene_identities g
  JOIN icono_gene_texts t ON t.gene_id = g.gene_id
  LEFT JOIN icono_caretaker_text_versions v
    ON v.version_id = t.chosen_caretaker_version_id
   AND v.gene_id = t.gene_id
   AND v.withdrawn_at IS NULL
 WHERE g.canonical_symbol = ? COLLATE NOCASE
 LIMIT 1`

export async function readGeneText(db, symbol) {
  if (!db?.prepare) throw new Error("ICONOPLASM_AUTHORING_DB binding missing")
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  if (!normalized) return null
  const row = await db.prepare(GENE_TEXT_SQL).bind(normalized).first()
  if (!row) return null
  if (row.ct_version_id) {
    return Object.freeze({
      gene_id: row.gene_id,
      symbol: row.canonical_symbol,
      gene_status: row.gene_status,
      origin: "caretaker",
      text_id: row.ct_version_id,
      line_id: row.ct_line_id,
      version: Number(row.ct_version),
      text: row.ct_text,
      text_sha256: row.ct_text_sha256,
      tags: row.ct_tags ?? null,
      fields_json: row.ct_fields_json ?? null,
      readers_see: Number(row.ct_readers_see) === 1,
    })
  }
  return Object.freeze({
    gene_id: row.gene_id,
    symbol: row.canonical_symbol,
    gene_status: row.gene_status,
    origin: "factory",
    text_id: row.text_id,
    line_id: null,
    version: Number(row.version),
    text: row.text,
    text_sha256: row.text_sha256,
    tags: row.tags ?? null,
    fields_json: row.fields_json ?? null,
    readers_see: Number(row.readers_see) === 1,
  })
}

// One text of a gene by its ID, for a generation request made from it: the
// gene's factory text while it is still the current one, or any caretaker
// version that was not withdrawn. The factory row keeps only its current text,
// so an older factory text is gone and the answer is null.
const GENE_TEXT_VERSION_SQL = `
SELECT g.gene_id, g.canonical_symbol, g.status AS gene_status, 'factory' AS origin,
       t.text_id, NULL AS line_id, t.version, t.text, t.text_sha256, t.tags,
       t.fields_json, t.readers_see
  FROM icono_gene_identities g
  JOIN icono_gene_texts t ON t.gene_id = g.gene_id
 WHERE g.gene_id = ? AND t.text_id = ?
UNION ALL
SELECT g.gene_id, g.canonical_symbol, g.status AS gene_status, 'caretaker' AS origin,
       v.version_id, v.line_id, v.version, v.text, v.text_sha256, v.tags,
       v.fields_json, v.readers_see
  FROM icono_gene_identities g
  JOIN icono_caretaker_text_versions v ON v.gene_id = g.gene_id
 WHERE g.gene_id = ? AND v.version_id = ? AND v.withdrawn_at IS NULL
 LIMIT 1`

export async function readGeneTextVersion(db, geneId, textId) {
  if (!db?.prepare) throw new Error("ICONOPLASM_AUTHORING_DB binding missing")
  const row = await db.prepare(GENE_TEXT_VERSION_SQL).bind(geneId, textId, geneId, textId).first()
  if (!row) return null
  return Object.freeze({
    gene_id: row.gene_id,
    symbol: row.canonical_symbol,
    gene_status: row.gene_status,
    origin: row.origin,
    text_id: row.text_id,
    line_id: row.line_id ?? null,
    version: Number(row.version),
    text: row.text,
    text_sha256: row.text_sha256,
    tags: row.tags ?? null,
    fields_json: row.fields_json ?? null,
    readers_see: Number(row.readers_see) === 1,
  })
}

// What a card may say about the text: an allowlist, so the Tags the caretaker
// panel promises to keep private can't reach a card (B-859). The text itself
// only when readers are meant to see it. The page compares
// `manifestation_revision_id` after a caretaker save to know the card caught up.
export function publicGeneText(geneText) {
  if (!geneText) return null
  const visible = geneText.readers_see === true
  return Object.freeze({
    gene_id: geneText.gene_id,
    manifestation_revision_id: geneText.text_id,
    body_sha256: geneText.text_sha256,
    public_page_visible: visible,
    prose: visible ? geneText.text : null,
  })
}
