function cleanUserId(raw) {
  return String(raw || "")
    .trim()
    .slice(0, 255)
}

export function normalizeFavoriteEmulsionFamilyId(raw) {
  var value = String(raw || "")
    .trim()
    .toUpperCase()
    .slice(0, 64)
  while (value.endsWith("-E")) value = value.slice(0, -2)
  return /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(value) ? value : ""
}

export async function listFavoriteEmulsionRows(db, userId) {
  var normalizedUserId = cleanUserId(userId)
  if (!db || !normalizedUserId) return []
  var response = await db
    .prepare(
      `SELECT emulsion_family_id, created_at
       FROM icono_user_emulsion_favorites
       WHERE user_id = ?
       ORDER BY created_at DESC, emulsion_family_id ASC`,
    )
    .bind(normalizedUserId)
    .all()
  return (Array.isArray(response?.results) ? response.results : [])
    .map(function (row) {
      var emulsionFamilyId = normalizeFavoriteEmulsionFamilyId(row?.emulsion_family_id || "")
      return emulsionFamilyId
        ? {
            emulsion_family_id: emulsionFamilyId,
            created_at: String(row?.created_at || ""),
          }
        : null
    })
    .filter(Boolean)
}

export async function addFavoriteEmulsion(db, { userId, emulsionFamilyId }) {
  var normalizedUserId = cleanUserId(userId)
  var normalizedEmulsionId = normalizeFavoriteEmulsionFamilyId(emulsionFamilyId)
  if (!db || !normalizedUserId || !normalizedEmulsionId) return false
  await db
    .prepare(
      `INSERT OR IGNORE INTO icono_user_emulsion_favorites (
         user_id,
         emulsion_family_id,
         created_at
       ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(normalizedUserId, normalizedEmulsionId)
    .run()
  return true
}

export async function removeFavoriteEmulsion(db, { userId, emulsionFamilyId }) {
  var normalizedUserId = cleanUserId(userId)
  var normalizedEmulsionId = normalizeFavoriteEmulsionFamilyId(emulsionFamilyId)
  if (!db || !normalizedUserId || !normalizedEmulsionId) return false
  await db
    .prepare(
      `DELETE FROM icono_user_emulsion_favorites
       WHERE user_id = ? AND emulsion_family_id = ?`,
    )
    .bind(normalizedUserId, normalizedEmulsionId)
    .run()
  return true
}
