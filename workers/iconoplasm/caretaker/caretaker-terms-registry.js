import { authorityError } from "./manifestation-authority-contract.js"

// B-864: the one checked-in record of which caretaker terms a new claim
// accepts. A terms change is a normal push, not a D1 migration:
//   1. add the plain-text copy as quartz/static/iconoplasm/caretaker-terms-<date>.txt
//      (its "Version:" line names the id);
//   2. point CURRENT_CARETAKER_TERMS at it; the hash must be that file's
//      SHA-256 (workers/iconoplasm-static-first-routing.test.js checks it);
//   3. update content/apps/iconoplasm/caretaker-terms.md.
// Versions seeded by migrations 0004 and 0008-0011 stay in D1 as history;
// assignments keep the version and hash they accepted.
export const CURRENT_CARETAKER_TERMS = Object.freeze({
  terms_version_id: "terms_2026_09_25_v4",
  terms_sha256: "bbaab1561315c613282cc07a1b554f769f52c03862a443f87436b420991a308d",
  document_url: "https://iconoplasm.brinedew.bio/caretaker-terms",
  display_label: "Caretaker terms - 25 September 2026 (v4)",
  effective_at: "2026-09-25T00:00:00.000Z",
})

const ACTIVE_TERMS_SQL = `SELECT terms_version_id, terms_sha256, document_url, display_label, effective_at
   FROM icono_caretaker_terms_versions
  WHERE retired_at IS NULL AND effective_at <= ?
  ORDER BY effective_at DESC, terms_version_id DESC
  LIMIT 1`

function sameText(row, terms) {
  return (
    row.terms_sha256 === terms.terms_sha256 &&
    row.document_url === terms.document_url &&
    row.display_label === terms.display_label &&
    row.effective_at === terms.effective_at
  )
}

function conflict() {
  return authorityError("TERMS_VERSION_CONFLICT", "Caretaker terms version already differs", 409)
}

// The newest active terms a claim may accept at `nowIso`. This sits on the
// signed-in gene page's claim offer (a hot GET), so the steady state is the
// same single indexed SELECT as before. Only when the registry's version is
// due and D1 does not yet name it does this insert it once and re-read.
export async function readActiveCaretakerTerms(db, nowIso, terms = CURRENT_CARETAKER_TERMS) {
  const read = () => db.prepare(ACTIVE_TERMS_SQL).bind(nowIso).first()
  let row = await read()
  if (row?.terms_version_id === terms.terms_version_id) {
    if (!sameText(row, terms)) throw conflict()
    return row
  }
  if (terms.effective_at > nowIso) return row
  await db
    .prepare(
      `INSERT OR IGNORE INTO icono_caretaker_terms_versions (
         terms_version_id, terms_sha256, document_url, display_label,
         effective_at, created_by_actor_kind, created_by_account_id
       ) VALUES (?, ?, ?, ?, ?, 'service', NULL)`,
    )
    .bind(
      terms.terms_version_id,
      terms.terms_sha256,
      terms.document_url,
      terms.display_label,
      terms.effective_at,
    )
    .run()
  row = await read()
  if (row?.terms_version_id === terms.terms_version_id && !sameText(row, terms)) throw conflict()
  return row
}
