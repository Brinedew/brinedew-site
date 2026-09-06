const READY_GROUPS = "icono_request_delivery_ready_groups"
const READY_INDEX = "idx_icono_request_delivery_ready_due"

// Each ready-mode range stops at its own limit before joining notification
// payloads. Due time is the scheduling priority; a retry cannot starve older due
// work. Scoped workstation calls inspect at most their 50 exact request IDs.
export async function readReadyDeliveryLeaders(db, { requestIds, allRequesters, limit }) {
  if (
    !Array.isArray(requestIds) ||
    requestIds.length > 50 ||
    limit !== 1 ||
    requestIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new RangeError("Delivery selection requires at most 50 exact request IDs and one group")
  if (requestIds.length) {
    const result = await db
      .prepare(
        `WITH scoped AS MATERIALIZED (
        SELECT requester_user_id,fulfillment_publication_id,gene_symbol
        FROM icono_request_notifications
        WHERE request_id IN (SELECT value FROM json_each(?))
      ) SELECT n.* FROM scoped
      CROSS JOIN ${READY_GROUPS} g
        ON g.requester_user_id=scoped.requester_user_id
        AND g.fulfillment_publication_id=scoped.fulfillment_publication_id
        AND g.gene_symbol=scoped.gene_symbol
      CROSS JOIN icono_request_notifications n ON n.id=g.leader_id
      WHERE g.ready_mode>=? AND g.due_at<=CURRENT_TIMESTAMP
      ORDER BY g.due_at,g.created_at,g.leader_id LIMIT ?`,
      )
      .bind(JSON.stringify(requestIds), allRequesters ? 1 : 2, limit)
      .all()
    return result.results || []
  }
  const pages = await Promise.all(
    (allRequesters ? [1, 2] : [2]).map(async (mode) => {
      const result = await db
        .prepare(
          `SELECT n.* FROM (
        SELECT leader_id,due_at,created_at FROM ${READY_GROUPS} INDEXED BY ${READY_INDEX}
        WHERE ready_mode=? AND due_at<=CURRENT_TIMESTAMP
        ORDER BY due_at,created_at,leader_id LIMIT ?
      ) g CROSS JOIN icono_request_notifications n ON n.id=g.leader_id
      ORDER BY g.due_at,g.created_at,g.leader_id`,
        )
        .bind(mode, limit)
        .all()
      return result.results || []
    }),
  )
  return pages
    .flat()
    .sort(
      (a, b) =>
        String(a.discord_next_attempt_at || a.created_at).localeCompare(
          String(b.discord_next_attempt_at || b.created_at),
        ) ||
        String(a.created_at).localeCompare(String(b.created_at)) ||
        Number(a.id) - Number(b.id),
    )
    .slice(0, limit)
}

export async function claimReadyDeliveryGroup(db, { notificationIds, leader, allRequesters }) {
  if (
    !Array.isArray(notificationIds) ||
    !notificationIds.length ||
    notificationIds.length > 500 ||
    new Set(notificationIds).size !== notificationIds.length ||
    notificationIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new RangeError("Delivery claim requires 1 to 500 unique notification IDs")
  const result = await db
    .prepare(
      `WITH candidates AS MATERIALIZED (SELECT value AS id FROM json_each(?)),
    eligible AS MATERIALIZED (
      SELECT id FROM icono_request_notifications NOT INDEXED
      WHERE id IN (SELECT id FROM candidates)
        AND discord_status IN (SELECT value FROM json_each(?))
        AND requester_user_id=? AND fulfillment_publication_id=? AND gene_symbol=?
    ), permitted AS MATERIALIZED (
      SELECT 1 WHERE (SELECT COUNT(*) FROM eligible)=?
      AND EXISTS (SELECT 1 FROM ${READY_GROUPS}
        WHERE requester_user_id=? AND fulfillment_publication_id=? AND gene_symbol=?
          AND leader_id=? AND ready_mode>=? AND due_at<=CURRENT_TIMESTAMP AND member_count=?)
    ) UPDATE icono_request_notifications NOT INDEXED
      SET discord_status='sending',discord_attempt_count=discord_attempt_count+1,
          discord_last_attempt_at=CURRENT_TIMESTAMP,discord_error=''
      WHERE id IN (SELECT id FROM eligible) AND EXISTS (SELECT 1 FROM permitted)
      RETURNING id`,
    )
    .bind(
      JSON.stringify(notificationIds),
      JSON.stringify(
        allRequesters
          ? ["pending", "retry", "suppressed_not_test_recipient"]
          : ["pending", "retry"],
      ),
      leader.requester_user_id,
      leader.fulfillment_publication_id,
      leader.gene_symbol,
      notificationIds.length,
      leader.requester_user_id,
      leader.fulfillment_publication_id,
      leader.gene_symbol,
      leader.id,
      allRequesters ? 1 : 2,
      notificationIds.length,
    )
    .all()
  return result.results.length === notificationIds.length
}
