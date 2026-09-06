// Part of the still-unreleased 0096 counter migration. Delivery readiness is
// derived from notification membership; notification rows retain authority.
const table = "icono_request_delivery_ready_groups"
const index = "idx_icono_request_notifications_fulfillment_publication"
const keys = ["requester_user_id", "fulfillment_publication_id", "gene_symbol"]
const keyMatch = (prefix, other = "") =>
  keys.map((k) => `${other}${k}=${prefix}.${k}`).join(" AND ")
const eligibleTest = (p) => `${p}.discord_status IN ('pending','retry')`
const eligibleAll = (p) =>
  `${p}.discord_status IN ('pending','retry','suppressed_not_test_recipient')`
const leader = (p) => `SELECT id FROM icono_request_notifications INDEXED BY ${index}
    WHERE ${keyMatch(p)} ORDER BY id LIMIT 1`
const members = (
  p,
) => `SELECT id,discord_status FROM icono_request_notifications INDEXED BY ${index}
    WHERE ${keyMatch(p)} ORDER BY id LIMIT 501`
const count = (p) => `(SELECT COUNT(*) FROM (${members(p)}))`
const eligibleCount = (p, predicate) =>
  `(SELECT COALESCE(SUM(${predicate("m")}),0) FROM (${members(p)}) m)`
const cleanup = (p) =>
  `DELETE FROM ${table} WHERE ${keyMatch(p)} AND (member_count=0 OR eligible_all=0);`

function remove() {
  return `UPDATE ${table} SET member_count=member_count-1,
    eligible_test=eligible_test-(${eligibleTest("OLD")}),
    eligible_all=eligible_all-(${eligibleAll("OLD")}) WHERE ${keyMatch("OLD")};
  UPDATE ${table} SET (leader_id,expected_count,due_at,created_at) =
    (SELECT id,fulfillment_group_size,COALESCE(NULLIF(discord_next_attempt_at,''),created_at),created_at
      FROM icono_request_notifications NOT INDEXED WHERE id=(${leader("OLD")}))
    WHERE ${keyMatch("OLD")} AND leader_id=OLD.id AND member_count>0;
  DELETE FROM ${table} WHERE ${keyMatch("OLD")} AND member_count=0;`
}

function add() {
  return `UPDATE ${table} SET member_count=member_count+1,
    eligible_test=eligible_test+(${eligibleTest("NEW")}),
    eligible_all=eligible_all+(${eligibleAll("NEW")}),
    overflowed=(overflowed OR member_count+1>500),
    leader_id=MIN(leader_id,NEW.id),
    expected_count=CASE WHEN NEW.id<=leader_id THEN NEW.fulfillment_group_size ELSE expected_count END,
    due_at=CASE WHEN NEW.id<=leader_id THEN COALESCE(NULLIF(NEW.discord_next_attempt_at,''),NEW.created_at) ELSE due_at END,
    created_at=CASE WHEN NEW.id<=leader_id THEN NEW.created_at ELSE created_at END
    WHERE ${keyMatch("NEW")};
  -- Only a newly eligible group needs reconstruction. Each scalar visits at
  -- most 501 members. Existing groups update their exact counters above.
  INSERT INTO ${table} (${keys.join(",")},leader_id,expected_count,due_at,created_at,
    member_count,eligible_test,eligible_all,overflowed)
  SELECT ${keys.map((k) => `NEW.${k}`).join(",")},n.id,n.fulfillment_group_size,
    COALESCE(NULLIF(n.discord_next_attempt_at,''),n.created_at),n.created_at,
    ${count("NEW")},${eligibleCount("NEW", eligibleTest)},${eligibleCount("NEW", eligibleAll)},${count("NEW")}>500
  FROM icono_request_notifications n NOT INDEXED
  WHERE n.id=(${leader("NEW")}) AND NEW.fulfillment_publication_id<>''
    AND (${eligibleAll("NEW")})
    AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${keyMatch("NEW")});`
}

export function requestDeliveryReadinessMigration() {
  const fields = [
    ...keys,
    "id",
    "discord_status",
    "discord_next_attempt_at",
    "created_at",
    "fulfillment_group_size",
  ]
  return `-- Materialized, indexed delivery readiness replaces recurring scans of
-- every pending receipt. Empty and terminal groups leave this derived queue.
CREATE TABLE ${table} (
  requester_user_id TEXT NOT NULL, fulfillment_publication_id TEXT NOT NULL, gene_symbol TEXT NOT NULL,
  leader_id INTEGER NOT NULL, expected_count INTEGER NOT NULL,
  due_at TEXT NOT NULL, created_at TEXT NOT NULL,
  member_count INTEGER NOT NULL CHECK(member_count>=0),
  eligible_test INTEGER NOT NULL CHECK(eligible_test>=0),
  eligible_all INTEGER NOT NULL CHECK(eligible_all>=0),
  overflowed INTEGER NOT NULL CHECK(overflowed IN (0,1)),
  ready_mode INTEGER GENERATED ALWAYS AS (CASE
    WHEN overflowed=0 AND member_count BETWEEN 1 AND 500 AND member_count=expected_count
    THEN CASE WHEN eligible_test=member_count THEN 2 WHEN eligible_all=member_count THEN 1 ELSE 0 END
    ELSE 0 END) STORED,
  PRIMARY KEY(requester_user_id,fulfillment_publication_id,gene_symbol)
) WITHOUT ROWID;
CREATE INDEX idx_icono_request_delivery_ready_due ON ${table}
  (ready_mode,due_at,created_at,leader_id);
-- Remove discord_status from this index's middle so capped member/leader
-- lookups really stop after their ID range, including malformed large groups.
DROP INDEX ${index};
CREATE INDEX ${index} ON icono_request_notifications
  (requester_user_id,fulfillment_publication_id,gene_symbol,id);
-- Those three indexes served the retired global status/batch selectors. The
-- exact request, user inbox and publication member indexes remain in place.
DROP INDEX idx_icono_request_notifications_delivery;
DROP INDEX idx_icono_request_notifications_delivery_due;
DROP INDEX idx_icono_request_notifications_delivery_batch;
CREATE TRIGGER icono_request_delivery_ready_insert AFTER INSERT ON icono_request_notifications
WHEN NEW.fulfillment_publication_id<>''
BEGIN
  ${add()}
  ${cleanup("NEW")}
END;
CREATE TRIGGER icono_request_delivery_ready_delete AFTER DELETE ON icono_request_notifications
WHEN OLD.fulfillment_publication_id<>''
BEGIN
  ${remove()}
  ${cleanup("OLD")}
END;
CREATE TRIGGER icono_request_delivery_ready_update AFTER UPDATE OF ${fields.join(",")} ON icono_request_notifications
WHEN ${fields.map((f) => `OLD.${f} IS NOT NEW.${f}`).join(" OR ")}
BEGIN
  ${remove()}
  ${add()}
  ${cleanup("OLD")}
  ${cleanup("NEW")}
END;
-- The existing admitted notification-cardinality guard covers this whole seed.
-- A retained delivery group has an eligible (not sent) member, so its two row
-- writes cannot overlap that member's four inbox-membership seed writes.
INSERT INTO ${table} (${keys.join(",")},leader_id,expected_count,due_at,created_at,
  member_count,eligible_test,eligible_all,overflowed)
SELECT ${keys.map((k) => `g.${k}`).join(",")},g.leader_id,n.fulfillment_group_size,
  COALESCE(NULLIF(n.discord_next_attempt_at,''),n.created_at),n.created_at,g.member_count,g.eligible_test,g.eligible_all,g.member_count>500
FROM (SELECT ${keys.join(",")},MIN(id) AS leader_id,COUNT(*) AS member_count,
  SUM(discord_status IN ('pending','retry')) AS eligible_test,
  SUM(discord_status IN ('pending','retry','suppressed_not_test_recipient')) AS eligible_all
  FROM icono_request_notifications INDEXED BY ${index}
  WHERE fulfillment_publication_id<>'' GROUP BY ${keys.join(",")}
  HAVING SUM(discord_status IN ('pending','retry','suppressed_not_test_recipient'))>0) g
CROSS JOIN icono_request_notifications n ON n.id=g.leader_id;
`
}
