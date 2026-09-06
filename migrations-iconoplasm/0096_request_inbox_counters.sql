-- Exact receipt membership preserves the request and asset identity contract.
-- Reads use one user counter and a bounded indexed page, never inbox history.
CREATE TABLE icono_request_inbox_summary (
  requester_user_id TEXT PRIMARY KEY,
  ready_count INTEGER NOT NULL CHECK(ready_count>=0),
  unread_count INTEGER NOT NULL CHECK(unread_count>=0),
  ready_group_count INTEGER NOT NULL CHECK(ready_group_count>=0),
  unread_group_count INTEGER NOT NULL CHECK(unread_group_count>=0)
) WITHOUT ROWID;
CREATE TABLE icono_request_inbox_groups (
  requester_user_id TEXT NOT NULL, group_key TEXT NOT NULL,
  ready_count INTEGER NOT NULL CHECK(ready_count>=0),
  unread_count INTEGER NOT NULL CHECK(unread_count>=0),
  PRIMARY KEY(requester_user_id,group_key)
) WITHOUT ROWID;
CREATE TABLE icono_request_inbox_members (
  notification_id INTEGER PRIMARY KEY, requester_user_id TEXT NOT NULL,
  group_key TEXT NOT NULL, created_at TEXT NOT NULL,
  unread INTEGER NOT NULL CHECK(unread IN (0,1))
);
CREATE INDEX idx_icono_request_inbox_page ON icono_request_inbox_members
  (requester_user_id,created_at DESC,notification_id DESC);
CREATE INDEX idx_icono_request_notifications_asset ON icono_request_notifications
  (gene_symbol,fulfilled_asset_sha256);
CREATE TRIGGER icono_request_inbox_group_insert AFTER INSERT ON icono_request_inbox_groups
BEGIN
  INSERT INTO icono_request_inbox_summary VALUES
    (NEW.requester_user_id,NEW.ready_count,NEW.unread_count,NEW.ready_count>0,NEW.unread_count>0)
  ON CONFLICT(requester_user_id) DO UPDATE SET
    ready_count=ready_count+excluded.ready_count, unread_count=unread_count+excluded.unread_count,
    ready_group_count=ready_group_count+excluded.ready_group_count,
    unread_group_count=unread_group_count+excluded.unread_group_count;
END;
CREATE TRIGGER icono_request_inbox_group_update AFTER UPDATE ON icono_request_inbox_groups
BEGIN
  UPDATE icono_request_inbox_summary SET
    ready_count=ready_count+NEW.ready_count-OLD.ready_count,
    unread_count=unread_count+NEW.unread_count-OLD.unread_count,
    ready_group_count=ready_group_count+(NEW.ready_count>0)-(OLD.ready_count>0),
    unread_group_count=unread_group_count+(NEW.unread_count>0)-(OLD.unread_count>0)
  WHERE requester_user_id=NEW.requester_user_id;
END;
CREATE TRIGGER icono_request_inbox_member_insert AFTER INSERT ON icono_request_inbox_members
BEGIN
  INSERT INTO icono_request_inbox_groups VALUES(NEW.requester_user_id,NEW.group_key,1,NEW.unread)
  ON CONFLICT(requester_user_id,group_key) DO UPDATE SET
    ready_count=ready_count+1,unread_count=unread_count+excluded.unread_count;
END;
CREATE TRIGGER icono_request_inbox_member_delete AFTER DELETE ON icono_request_inbox_members
BEGIN
  UPDATE icono_request_inbox_groups SET ready_count=ready_count-1,unread_count=unread_count-OLD.unread
    WHERE requester_user_id=OLD.requester_user_id AND group_key=OLD.group_key;
  DELETE FROM icono_request_inbox_groups
    WHERE requester_user_id=OLD.requester_user_id AND group_key=OLD.group_key AND ready_count=0;
END;
CREATE TRIGGER icono_request_inbox_member_read AFTER UPDATE OF unread ON icono_request_inbox_members
WHEN OLD.unread IS NOT NEW.unread
BEGIN
  UPDATE icono_request_inbox_groups SET unread_count=unread_count+NEW.unread-OLD.unread
    WHERE requester_user_id=NEW.requester_user_id AND group_key=NEW.group_key;
END;
CREATE TRIGGER icono_request_inbox_notification_insert AFTER INSERT ON icono_request_notifications
BEGIN
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.id=NEW.id);
END;
CREATE TRIGGER icono_request_inbox_notification_delete AFTER DELETE ON icono_request_notifications
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id=OLD.id;
END;
CREATE TRIGGER icono_request_inbox_notification_update
AFTER UPDATE OF id,request_id,requester_user_id,gene_symbol,fulfilled_asset_sha256,discord_status,fulfillment_publication_id,created_at ON icono_request_notifications
WHEN OLD.id IS NOT NEW.id OR OLD.request_id IS NOT NEW.request_id
  OR OLD.requester_user_id IS NOT NEW.requester_user_id OR OLD.gene_symbol IS NOT NEW.gene_symbol
  OR OLD.fulfilled_asset_sha256 IS NOT NEW.fulfilled_asset_sha256 OR OLD.discord_status IS NOT NEW.discord_status
  OR OLD.fulfillment_publication_id IS NOT NEW.fulfillment_publication_id
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id=OLD.id;
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.id=NEW.id);
END;
CREATE TRIGGER icono_request_inbox_notification_read AFTER UPDATE OF read_at ON icono_request_notifications
WHEN (OLD.read_at IS NULL) <> (NEW.read_at IS NULL)
BEGIN
  UPDATE icono_request_inbox_members SET unread=CASE WHEN NEW.read_at IS NULL THEN 1 ELSE 0 END
    WHERE notification_id=NEW.id;
END;
CREATE TRIGGER icono_generation_requests_inbox_insert AFTER INSERT ON icono_generation_requests
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE n.request_id=NEW.id);
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.request_id=NEW.id);
END;
CREATE TRIGGER icono_generation_requests_inbox_delete AFTER DELETE ON icono_generation_requests
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE n.request_id=OLD.id);
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.request_id=OLD.id);
END;
CREATE TRIGGER icono_generation_requests_inbox_update AFTER UPDATE OF id,requester_user_id,gene_symbol,fulfilled_asset_sha256,status ON icono_generation_requests
WHEN OLD.id IS NOT NEW.id OR OLD.requester_user_id IS NOT NEW.requester_user_id OR OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.fulfilled_asset_sha256 IS NOT NEW.fulfilled_asset_sha256 OR OLD.status IS NOT NEW.status
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE (n.request_id=OLD.id) OR (n.request_id=NEW.id));
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND ((n.request_id=OLD.id) OR (n.request_id=NEW.id));
END;
CREATE TRIGGER icono_portrait_assets_inbox_insert AFTER INSERT ON icono_portrait_assets
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE n.gene_symbol=NEW.gene_symbol AND n.fulfilled_asset_sha256=NEW.asset_sha256);
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.gene_symbol=NEW.gene_symbol AND n.fulfilled_asset_sha256=NEW.asset_sha256);
END;
CREATE TRIGGER icono_portrait_assets_inbox_delete AFTER DELETE ON icono_portrait_assets
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE n.gene_symbol=OLD.gene_symbol AND n.fulfilled_asset_sha256=OLD.asset_sha256);
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (n.gene_symbol=OLD.gene_symbol AND n.fulfilled_asset_sha256=OLD.asset_sha256);
END;
CREATE TRIGGER icono_portrait_assets_inbox_update AFTER UPDATE OF gene_symbol,asset_sha256 ON icono_portrait_assets
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.asset_sha256 IS NOT NEW.asset_sha256
BEGIN
  DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE (n.gene_symbol=OLD.gene_symbol AND n.fulfilled_asset_sha256=OLD.asset_sha256) OR (n.gene_symbol=NEW.gene_symbol AND n.fulfilled_asset_sha256=NEW.asset_sha256));
  INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND ((n.gene_symbol=OLD.gene_symbol AND n.fulfilled_asset_sha256=OLD.asset_sha256) OR (n.gene_symbol=NEW.gene_symbol AND n.fulfilled_asset_sha256=NEW.asset_sha256));
END;
-- One-time admitted seed; no request-time repair.
INSERT INTO icono_request_inbox_members SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (1);
-- Materialized, indexed delivery readiness replaces recurring scans of
-- every pending receipt. Empty and terminal groups leave this derived queue.
CREATE TABLE icono_request_delivery_ready_groups (
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
CREATE INDEX idx_icono_request_delivery_ready_due ON icono_request_delivery_ready_groups
  (ready_mode,due_at,created_at,leader_id);
-- Remove discord_status from this index's middle so capped member/leader
-- lookups really stop after their ID range, including malformed large groups.
DROP INDEX idx_icono_request_notifications_fulfillment_publication;
CREATE INDEX idx_icono_request_notifications_fulfillment_publication ON icono_request_notifications
  (requester_user_id,fulfillment_publication_id,gene_symbol,id);
-- Those three indexes served the retired global status/batch selectors. The
-- exact request, user inbox and publication member indexes remain in place.
DROP INDEX idx_icono_request_notifications_delivery;
DROP INDEX idx_icono_request_notifications_delivery_due;
DROP INDEX idx_icono_request_notifications_delivery_batch;
CREATE TRIGGER icono_request_delivery_ready_insert AFTER INSERT ON icono_request_notifications
WHEN NEW.fulfillment_publication_id<>''
BEGIN
  UPDATE icono_request_delivery_ready_groups SET member_count=member_count+1,
    eligible_test=eligible_test+(NEW.discord_status IN ('pending','retry')),
    eligible_all=eligible_all+(NEW.discord_status IN ('pending','retry','suppressed_not_test_recipient')),
    overflowed=(overflowed OR member_count+1>500),
    leader_id=MIN(leader_id,NEW.id),
    expected_count=CASE WHEN NEW.id<=leader_id THEN NEW.fulfillment_group_size ELSE expected_count END,
    due_at=CASE WHEN NEW.id<=leader_id THEN COALESCE(NULLIF(NEW.discord_next_attempt_at,''),NEW.created_at) ELSE due_at END,
    created_at=CASE WHEN NEW.id<=leader_id THEN NEW.created_at ELSE created_at END
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol;
  -- Only a newly eligible group needs reconstruction. Each scalar visits at
  -- most 501 members. Existing groups update their exact counters above.
  INSERT INTO icono_request_delivery_ready_groups (requester_user_id,fulfillment_publication_id,gene_symbol,leader_id,expected_count,due_at,created_at,
    member_count,eligible_test,eligible_all,overflowed)
  SELECT NEW.requester_user_id,NEW.fulfillment_publication_id,NEW.gene_symbol,n.id,n.fulfillment_group_size,
    COALESCE(NULLIF(n.discord_next_attempt_at,''),n.created_at),n.created_at,
    (SELECT COUNT(*) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501)),(SELECT COALESCE(SUM(m.discord_status IN ('pending','retry')),0) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501) m),(SELECT COALESCE(SUM(m.discord_status IN ('pending','retry','suppressed_not_test_recipient')),0) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501) m),(SELECT COUNT(*) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501))>500
  FROM icono_request_notifications n NOT INDEXED
  WHERE n.id=(SELECT id FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 1) AND NEW.fulfillment_publication_id<>''
    AND (NEW.discord_status IN ('pending','retry','suppressed_not_test_recipient'))
    AND NOT EXISTS (SELECT 1 FROM icono_request_delivery_ready_groups WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol);
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol AND (member_count=0 OR eligible_all=0);
END;
CREATE TRIGGER icono_request_delivery_ready_delete AFTER DELETE ON icono_request_notifications
WHEN OLD.fulfillment_publication_id<>''
BEGIN
  UPDATE icono_request_delivery_ready_groups SET member_count=member_count-1,
    eligible_test=eligible_test-(OLD.discord_status IN ('pending','retry')),
    eligible_all=eligible_all-(OLD.discord_status IN ('pending','retry','suppressed_not_test_recipient')) WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol;
  UPDATE icono_request_delivery_ready_groups SET (leader_id,expected_count,due_at,created_at) =
    (SELECT id,fulfillment_group_size,COALESCE(NULLIF(discord_next_attempt_at,''),created_at),created_at
      FROM icono_request_notifications NOT INDEXED WHERE id=(SELECT id FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol ORDER BY id LIMIT 1))
    WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND leader_id=OLD.id AND member_count>0;
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND member_count=0;
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND (member_count=0 OR eligible_all=0);
END;
CREATE TRIGGER icono_request_delivery_ready_update AFTER UPDATE OF requester_user_id,fulfillment_publication_id,gene_symbol,id,discord_status,discord_next_attempt_at,created_at,fulfillment_group_size ON icono_request_notifications
WHEN OLD.requester_user_id IS NOT NEW.requester_user_id OR OLD.fulfillment_publication_id IS NOT NEW.fulfillment_publication_id OR OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.id IS NOT NEW.id OR OLD.discord_status IS NOT NEW.discord_status OR OLD.discord_next_attempt_at IS NOT NEW.discord_next_attempt_at OR OLD.created_at IS NOT NEW.created_at OR OLD.fulfillment_group_size IS NOT NEW.fulfillment_group_size
BEGIN
  UPDATE icono_request_delivery_ready_groups SET member_count=member_count-1,
    eligible_test=eligible_test-(OLD.discord_status IN ('pending','retry')),
    eligible_all=eligible_all-(OLD.discord_status IN ('pending','retry','suppressed_not_test_recipient')) WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol;
  UPDATE icono_request_delivery_ready_groups SET (leader_id,expected_count,due_at,created_at) =
    (SELECT id,fulfillment_group_size,COALESCE(NULLIF(discord_next_attempt_at,''),created_at),created_at
      FROM icono_request_notifications NOT INDEXED WHERE id=(SELECT id FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol ORDER BY id LIMIT 1))
    WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND leader_id=OLD.id AND member_count>0;
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND member_count=0;
  UPDATE icono_request_delivery_ready_groups SET member_count=member_count+1,
    eligible_test=eligible_test+(NEW.discord_status IN ('pending','retry')),
    eligible_all=eligible_all+(NEW.discord_status IN ('pending','retry','suppressed_not_test_recipient')),
    overflowed=(overflowed OR member_count+1>500),
    leader_id=MIN(leader_id,NEW.id),
    expected_count=CASE WHEN NEW.id<=leader_id THEN NEW.fulfillment_group_size ELSE expected_count END,
    due_at=CASE WHEN NEW.id<=leader_id THEN COALESCE(NULLIF(NEW.discord_next_attempt_at,''),NEW.created_at) ELSE due_at END,
    created_at=CASE WHEN NEW.id<=leader_id THEN NEW.created_at ELSE created_at END
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol;
  -- Only a newly eligible group needs reconstruction. Each scalar visits at
  -- most 501 members. Existing groups update their exact counters above.
  INSERT INTO icono_request_delivery_ready_groups (requester_user_id,fulfillment_publication_id,gene_symbol,leader_id,expected_count,due_at,created_at,
    member_count,eligible_test,eligible_all,overflowed)
  SELECT NEW.requester_user_id,NEW.fulfillment_publication_id,NEW.gene_symbol,n.id,n.fulfillment_group_size,
    COALESCE(NULLIF(n.discord_next_attempt_at,''),n.created_at),n.created_at,
    (SELECT COUNT(*) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501)),(SELECT COALESCE(SUM(m.discord_status IN ('pending','retry')),0) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501) m),(SELECT COALESCE(SUM(m.discord_status IN ('pending','retry','suppressed_not_test_recipient')),0) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501) m),(SELECT COUNT(*) FROM (SELECT id,discord_status FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 501))>500
  FROM icono_request_notifications n NOT INDEXED
  WHERE n.id=(SELECT id FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol ORDER BY id LIMIT 1) AND NEW.fulfillment_publication_id<>''
    AND (NEW.discord_status IN ('pending','retry','suppressed_not_test_recipient'))
    AND NOT EXISTS (SELECT 1 FROM icono_request_delivery_ready_groups WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol);
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=OLD.requester_user_id AND fulfillment_publication_id=OLD.fulfillment_publication_id AND gene_symbol=OLD.gene_symbol AND (member_count=0 OR eligible_all=0);
  DELETE FROM icono_request_delivery_ready_groups WHERE requester_user_id=NEW.requester_user_id AND fulfillment_publication_id=NEW.fulfillment_publication_id AND gene_symbol=NEW.gene_symbol AND (member_count=0 OR eligible_all=0);
END;
-- The existing admitted notification-cardinality guard covers this whole seed.
-- A retained delivery group has an eligible (not sent) member, so its two row
-- writes cannot overlap that member's four inbox-membership seed writes.
INSERT INTO icono_request_delivery_ready_groups (requester_user_id,fulfillment_publication_id,gene_symbol,leader_id,expected_count,due_at,created_at,
  member_count,eligible_test,eligible_all,overflowed)
SELECT g.requester_user_id,g.fulfillment_publication_id,g.gene_symbol,g.leader_id,n.fulfillment_group_size,
  COALESCE(NULLIF(n.discord_next_attempt_at,''),n.created_at),n.created_at,g.member_count,g.eligible_test,g.eligible_all,g.member_count>500
FROM (SELECT requester_user_id,fulfillment_publication_id,gene_symbol,MIN(id) AS leader_id,COUNT(*) AS member_count,
  SUM(discord_status IN ('pending','retry')) AS eligible_test,
  SUM(discord_status IN ('pending','retry','suppressed_not_test_recipient')) AS eligible_all
  FROM icono_request_notifications INDEXED BY idx_icono_request_notifications_fulfillment_publication
  WHERE fulfillment_publication_id<>'' GROUP BY requester_user_id,fulfillment_publication_id,gene_symbol
  HAVING SUM(discord_status IN ('pending','retry','suppressed_not_test_recipient'))>0) g
CROSS JOIN icono_request_notifications n ON n.id=g.leader_id;
