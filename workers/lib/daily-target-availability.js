/**
 * Walk a deterministic daily-target sequence until a protein with a reachable
 * canonical structure is found.
 *
 * Source selection and availability are deliberately separate. The caller
 * first resolves the canonical metadata (which preserves the curated database
 * source), then verifies that exact source. An unavailable curated source
 * rejects the protein for the day; it must never silently change the structure
 * format/source after the browser has received a token.
 */
export async function selectAvailableDailyTarget({
  initialProtein,
  eligibleIds,
  startIndex = 0,
  loadProtein,
  resolveStructureMeta,
  isStructureAvailable,
  isIneligibleFallback = () => false,
  maxCandidates = 10,
}) {
  if (
    !initialProtein ||
    !Array.isArray(eligibleIds) ||
    eligibleIds.length === 0 ||
    typeof loadProtein !== "function" ||
    typeof resolveStructureMeta !== "function" ||
    typeof isStructureAvailable !== "function"
  ) {
    return { protein: null, structureMeta: null, rejected: [] }
  }

  const normalizedStart = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0
  const candidateLimit = Math.max(1, Math.min(Number(maxCandidates) || 1, eligibleIds.length))
  const rejected = []
  const seen = new Set()
  let protein = initialProtein
  let cursor = normalizedStart % eligibleIds.length
  let checkedCandidates = 0
  let scannedIds = 0

  while (protein && checkedCandidates < candidateLimit) {
    const proteinId = String(protein.uniprot || "")
      .trim()
      .toUpperCase()
    if (proteinId && !seen.has(proteinId)) {
      seen.add(proteinId)
      checkedCandidates += 1

      const structureMeta = await resolveStructureMeta(protein)
      const available = Boolean(
        structureMeta?.r2Key && (await isStructureAvailable(structureMeta, protein)),
      )
      if (available) {
        return { protein, structureMeta, rejected }
      }

      rejected.push({
        uniprot_id: proteinId,
        reason: structureMeta?.r2Key ? "structure_unreachable" : "no_structure_metadata",
      })
    }

    protein = null
    while (!protein && scannedIds < eligibleIds.length) {
      cursor = (cursor + 1) % eligibleIds.length
      scannedIds += 1
      const nextId = String(eligibleIds[cursor] || "")
        .trim()
        .toUpperCase()
      if (!nextId || seen.has(nextId)) continue

      const nextProtein = await loadProtein(nextId)
      if (!nextProtein || isIneligibleFallback(nextProtein)) continue
      protein = nextProtein
    }
  }

  return { protein: null, structureMeta: null, rejected }
}
