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
    // The three locator indexes protect the account-wide D1 read allowance.
    // An OR across the alias join scans the entire identity catalogue even
    // with LIMIT 1. Resolve the bounded ID set first, then read its metadata.
    `WITH matched_genes AS (
       SELECT gene_id FROM icono_gene_identities WHERE gene_id = ?
       UNION
       SELECT gene_id FROM icono_gene_identities WHERE canonical_symbol = ? COLLATE NOCASE
       UNION
       SELECT gene_id FROM icono_gene_aliases WHERE alias_symbol = ? COLLATE NOCASE
     )
     SELECT gene.gene_id, gene.canonical_symbol, gene.status,
            gene.merged_into_gene_id, merged.canonical_symbol AS merged_into_symbol,
            gene.identity_version,
            gene.created_at, gene.updated_at
       FROM matched_genes match
       JOIN icono_gene_identities gene ON gene.gene_id = match.gene_id
       LEFT JOIN icono_gene_identities merged ON merged.gene_id = gene.merged_into_gene_id
      LIMIT 1`,
    locator,
    locator,
    locator,
  )
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  return gene
}
