// B-864: the one checked-in record of which caretaker terms a new claim
// accepts. A terms change is a normal push, not a D1 migration:
//   1. add the plain-text copy as quartz/static/iconoplasm/caretaker-terms-<date>.txt
//      (its "Version:" line names the id);
//   2. point CURRENT_CARETAKER_TERMS at it; the hash must be that file's
//      SHA-256 (workers/iconoplasm-static-first-routing.test.js checks it);
//   3. update content/apps/iconoplasm/caretaker-terms.md; its frontmatter `date`
//      is the Effective date the page shows and must equal effective_at
//      (scripts/iconoplasm-page-dates.test.js checks it).
// Each caretaker role keeps the version and hash it accepted.
export const CURRENT_CARETAKER_TERMS = Object.freeze({
  terms_version_id: "terms_2026_09_25_v4",
  terms_sha256: "bbaab1561315c613282cc07a1b554f769f52c03862a443f87436b420991a308d",
  document_url: "https://iconoplasm.brinedew.bio/caretaker-terms",
  display_label: "Caretaker terms - 25 September 2026 (v4)",
  effective_at: "2026-09-25T00:00:00.000Z",
})
