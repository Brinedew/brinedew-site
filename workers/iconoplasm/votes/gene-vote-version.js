// B-898 Stage 2: one integer per gene (migration 0113) that every change to
// an election input advances: a vote, a caretaker supervote, an assignment
// change, an eligibility invalidation, and the start of every admin-triggered
// election. An election reads it in the same batch as its inputs and projects
// its winner only while it is unchanged, so an older election can never
// overwrite a newer one (the B-888 "two copies of one decision" bug).

// Advances the version. `whenSql` (optional) is a boolean SQL expression over
// numbered parameters starting at ?2; the bump happens only when it holds, so
// a conditional write batch can advance the version exactly when its guarded
// statement applied.
export function geneVoteVersionBumpStatement(db, symbol, { whenSql = "", whenArgs = [] } = {}) {
  return db
    .prepare(
      `INSERT INTO icono_gene_vote_version (gene_symbol, version, updated_at)
       SELECT ?1, 1, CURRENT_TIMESTAMP WHERE ${whenSql || "1"}
       ON CONFLICT(gene_symbol) DO UPDATE SET
         version = icono_gene_vote_version.version + 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(symbol, ...whenArgs)
}

// Scalar SQL for the current version; a gene never voted on reads as 0.
export const GENE_VOTE_VERSION_SQL =
  "(SELECT COALESCE(MAX(version), 0) FROM icono_gene_vote_version WHERE gene_symbol = ?1)"
