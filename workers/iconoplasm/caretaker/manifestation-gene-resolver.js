import { authorityError } from "./manifestation-authority-contract.js"
import { first, readGeneAliases, requireDatabase } from "./manifestation-authority-repository.js"

export function normalizeGeneLocator(raw) {
  const value = String(raw || "").trim()
  if (!value || value.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw authorityError("INVALID_GENE_LOCATOR", "Gene identity or alias is invalid")
  }
  return value
}

export async function resolveGene(db, rawLocator) {
  requireDatabase(db)
  const locator = normalizeGeneLocator(rawLocator)
  const gene = await first(
    db,
    `SELECT DISTINCT gene.gene_id, gene.canonical_symbol, gene.status,
            gene.merged_into_gene_id, merged.canonical_symbol AS merged_into_symbol,
            gene.identity_version,
            gene.created_at, gene.updated_at
       FROM icono_gene_identities gene
       LEFT JOIN icono_gene_aliases alias ON alias.gene_id = gene.gene_id
       LEFT JOIN icono_gene_identities merged ON merged.gene_id = gene.merged_into_gene_id
      WHERE gene.gene_id = ? OR gene.canonical_symbol = ? COLLATE NOCASE
         OR alias.alias_symbol = ? COLLATE NOCASE
      LIMIT 1`,
    locator,
    locator,
    locator,
  )
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  return gene
}
