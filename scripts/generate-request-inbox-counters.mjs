import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { requestDeliveryReadinessMigration } from "./generate-request-delivery-readiness.mjs"

const target = new URL("../migrations-iconoplasm/0096_request_inbox_counters.sql", import.meta.url)
const validMembers = (where = "1") => `SELECT n.id, n.requester_user_id,
    COALESCE(NULLIF(n.fulfillment_publication_id,''),'legacy-request:' || n.request_id) || char(31) || n.gene_symbol,
    n.created_at, CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END
  FROM icono_request_notifications n
  CROSS JOIN icono_generation_requests gr ON gr.id=n.request_id
    AND gr.requester_user_id=n.requester_user_id AND gr.gene_symbol=n.gene_symbol
    AND gr.fulfilled_asset_sha256=n.fulfilled_asset_sha256 AND gr.status='fulfilled'
  CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=n.gene_symbol
    AND pa.asset_sha256=n.fulfilled_asset_sha256
  WHERE n.discord_status='sent' AND (${where})`

function refresh(where) {
  return `DELETE FROM icono_request_inbox_members WHERE notification_id IN
    (SELECT n.id FROM icono_request_notifications n WHERE ${where});
  INSERT INTO icono_request_inbox_members ${validMembers(where)};`
}

export function requestInboxCounterMigration() {
  const schema = `-- Exact receipt membership preserves the request and asset identity contract.
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
  INSERT INTO icono_request_inbox_members ${validMembers("n.id=NEW.id")};
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
  INSERT INTO icono_request_inbox_members ${validMembers("n.id=NEW.id")};
END;
CREATE TRIGGER icono_request_inbox_notification_read AFTER UPDATE OF read_at ON icono_request_notifications
WHEN (OLD.read_at IS NULL) <> (NEW.read_at IS NULL)
BEGIN
  UPDATE icono_request_inbox_members SET unread=CASE WHEN NEW.read_at IS NULL THEN 1 ELSE 0 END
    WHERE notification_id=NEW.id;
END;
`
  const sources = [
    {
      table: "icono_generation_requests",
      fields: ["id", "requester_user_id", "gene_symbol", "fulfilled_asset_sha256", "status"],
      condition: (p) => `n.request_id=${p}.id`,
    },
    {
      table: "icono_portrait_assets",
      fields: ["gene_symbol", "asset_sha256"],
      condition: (p) =>
        `n.gene_symbol=${p}.gene_symbol AND n.fulfilled_asset_sha256=${p}.asset_sha256`,
    },
  ]
  const triggers = sources.flatMap(({ table, fields, condition }) => [
    `CREATE TRIGGER ${table}_inbox_insert AFTER INSERT ON ${table}\nBEGIN\n  ${refresh(condition("NEW"))}\nEND;`,
    `CREATE TRIGGER ${table}_inbox_delete AFTER DELETE ON ${table}\nBEGIN\n  ${refresh(condition("OLD"))}\nEND;`,
    `CREATE TRIGGER ${table}_inbox_update AFTER UPDATE OF ${fields.join(",")} ON ${table}\nWHEN ${fields.map((f) => `OLD.${f} IS NOT NEW.${f}`).join(" OR ")}\nBEGIN\n  ${refresh(`(${condition("OLD")}) OR (${condition("NEW")})`)}\nEND;`,
  ])
  return (
    schema +
    triggers.join("\n") +
    `\n-- One-time admitted seed; no request-time repair.\nINSERT INTO icono_request_inbox_members ${validMembers()};\n` +
    requestDeliveryReadinessMigration()
  )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = requestInboxCounterMigration()
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== sql)
      throw new Error("Inbox counter migration is stale")
  } else writeFileSync(target, sql, "utf8")
}
