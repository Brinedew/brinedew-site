import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// B-744: exact counts belong to the same D1 transaction as their source change.
// Neither reading the admin summary nor refreshing it may enumerate assets.
const table = "icono_asset_summary_counts"
const valid = (p) =>
  `COALESCE(${p}.asset_sha256,'')<>'' AND COALESCE(${p}.is_legacy,0)=0 AND lower(COALESCE(${p}.status,'draft'))<>'rejected'`
const auditable = (p) =>
  `COALESCE(${p}.is_legacy,0)=0 AND lower(COALESCE(${p}.status,'draft'))<>'rejected'`
const catalog = (p) =>
  `EXISTS(SELECT 1 FROM icono_gene_catalog gc WHERE gc.gene_symbol=${p}.gene_symbol)`
const assetFields = (p) => ({
  candidate_assets: "1",
  catalog_candidate_assets: catalog(p),
  auditable_assets: auditable(p),
  catalog_auditable_assets: `(${catalog(p)} AND ${auditable(p)})`,
  stale_assets: `COALESCE(${p}.is_stale,0)=1`,
  legacy_assets: `COALESCE(${p}.is_legacy,0)=1`,
})
const queueFields = (q) => ({
  audited_assets: `${q}.audit_state<>'unknown'`,
  verified_renderable_images: `${q}.audit_state IN ('renderable','regionally_divergent')`,
  storage_incomplete_assets: `${q}.audit_state='broken'`,
  storage_regionally_divergent_assets: `${q}.audit_state='regionally_divergent'`,
  broken_live_images: `${q}.is_current=1 AND ${q}.audit_state='broken'`,
  renderable_live_confirmed: `${q}.is_current=1 AND ${q}.audit_state IN ('renderable','regionally_divergent')`,
  storage_queue_backlog_assets: `${q}.audit_state='unknown'`,
})
export const ASSET_SUMMARY_FIELDS = [
  ...Object.keys(assetFields("pa")),
  "published_live_portraits",
  "catalog_published_live_portraits",
  ...Object.keys(queueFields("q")),
]
const aggregate = (fields) =>
  Object.entries(fields)
    .map(([name, expr]) => `COALESCE(SUM(CASE WHEN ${expr} THEN 1 ELSE 0 END),0) AS ${name}`)
    .join(",\n ")
const queueJoin = `FROM icono_storage_audit_queue q CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol=q.gene_symbol AND pa.asset_sha256=q.asset_sha256 WHERE ${valid("pa")}`
const stamp = (q) => `datetime(${q}.last_audited_at)`
const second = (q) =>
  `(CAST(strftime('%H',${stamp(q)}) AS INTEGER)*3600+CAST(strftime('%M',${stamp(q)}) AS INTEGER)*60+CAST(strftime('%S',${stamp(q)}) AS INTEGER))`

function delta(fields, sign, from = "", where = "1") {
  const keys = Object.keys(fields)
  return `UPDATE ${table} SET (${keys.join(",")})=(SELECT ${Object.entries(fields)
    .map(([k, v]) => `${k}${sign}COALESCE(SUM(CASE WHEN ${v} THEN 1 ELSE 0 END),0)`)
    .join(",")} ${from} WHERE ${where}) WHERE summary_key='default';`
}
function ageDelta(q, sign, from, where) {
  const result = []
  const eligible = `(${where}) AND ${q}.audit_state<>'unknown' AND ${stamp(q)} IS NOT NULL`
  for (const [name, fmt] of [
    ["years", "%Y"],
    ["months", "%Y-%m"],
  ]) {
    result.push(`INSERT INTO icono_audit_age_${name}(bucket,total) SELECT strftime('${fmt}',${stamp(q)}),${sign}1 ${from} WHERE ${eligible}
      ON CONFLICT(bucket) DO UPDATE SET total=total${sign}1;
      DELETE FROM icono_audit_age_${name} WHERE bucket=(SELECT strftime('${fmt}',${stamp(q)}) ${from} WHERE ${eligible}) AND total=0;`)
  }
  const key = `'$.'||${second(q)}`
  result.push(`INSERT INTO icono_audit_age_days(bucket,total,seconds_json) SELECT date(${stamp(q)}),${sign}1,json_object(CAST(${second(q)} AS TEXT),${sign}1) ${from} WHERE ${eligible}
    ON CONFLICT(bucket) DO UPDATE SET total=total${sign}1,seconds_json=json_set(seconds_json,${key},COALESCE(json_extract(seconds_json,${key}),0)${sign}1);
    DELETE FROM icono_audit_age_days WHERE bucket=(SELECT date(${stamp(q)}) ${from} WHERE ${eligible}) AND total=0;`)
  // ON CONFLICT expressions cannot refer to the SELECT's source aliases.
  result[result.length - 1] = result
    .at(-1)
    .replaceAll(key, `(SELECT ${key} ${from} WHERE ${eligible})`)
  return result.join("\n")
}
function queueDelta(q, sign, from, where) {
  return delta(queueFields(q), sign, from, where) + "\n" + ageDelta(q, sign, from, where)
}
function assetDelta(p, sign) {
  return (
    delta(assetFields(p), sign) +
    "\n" +
    queueDelta(
      "q",
      sign,
      `FROM icono_storage_audit_queue q`,
      `q.gene_symbol=${p}.gene_symbol AND q.asset_sha256=${p}.asset_sha256 AND ${valid(p)}`,
    )
  )
}

export function assetSummaryMigrationStatements() {
  const statements = [
    `CREATE TABLE ${table}(summary_key TEXT PRIMARY KEY CHECK(summary_key='default'),${ASSET_SUMMARY_FIELDS.map((k) => `${k} INTEGER NOT NULL DEFAULT 0 CHECK(${k}>=0)`).join(",")});`,
    `CREATE TABLE icono_audit_age_years(bucket TEXT PRIMARY KEY,total INTEGER NOT NULL);`,
    `CREATE TABLE icono_audit_age_months(bucket TEXT PRIMARY KEY,total INTEGER NOT NULL);`,
    `CREATE TABLE icono_audit_age_days(bucket TEXT PRIMARY KEY,total INTEGER NOT NULL,seconds_json TEXT NOT NULL CHECK(length(seconds_json)<1500000));`,
    `INSERT INTO ${table}(summary_key,${Object.keys(assetFields("pa")).join(",")}) SELECT 'default',${aggregate(assetFields("pa"))} FROM icono_portrait_assets pa;`,
    `UPDATE ${table} SET (published_live_portraits,catalog_published_live_portraits)=(SELECT COUNT(*),COALESCE(SUM(CASE WHEN ${catalog("ps")} THEN 1 ELSE 0 END),0) FROM icono_publish_state ps WHERE COALESCE(ps.current_asset_sha256,'')<>'') WHERE summary_key='default';`,
    `UPDATE ${table} SET (${Object.keys(queueFields("q")).join(",")})=(SELECT ${aggregate(queueFields("q"))} ${queueJoin}) WHERE summary_key='default';`,
  ]
  statements.push(
    `INSERT INTO icono_audit_age_days(bucket,total,seconds_json) SELECT bucket,SUM(n),json_group_object(CAST(second AS TEXT),n) FROM (SELECT date(${stamp("q")}) AS bucket,${second("q")} AS second,COUNT(*) AS n ${queueJoin} AND q.audit_state<>'unknown' AND ${stamp("q")} IS NOT NULL GROUP BY 1,2) GROUP BY bucket;`,
  )
  for (const [name, length] of [
    ["years", 4],
    ["months", 7],
  ])
    statements.push(
      `INSERT INTO icono_audit_age_${name}(bucket,total) SELECT substr(bucket,1,${length}),SUM(total) FROM icono_audit_age_days GROUP BY 1;`,
    )
  const triggers = (name, source, columns, body) => {
    for (const [action, parts] of [
      ["INSERT", [["NEW", "+"]]],
      ["DELETE", [["OLD", "-"]]],
      [
        `UPDATE OF ${columns}`,
        [
          ["OLD", "-"],
          ["NEW", "+"],
        ],
      ],
    ]) {
      const when = action.startsWith("UPDATE")
        ? `WHEN ${columns
            .split(",")
            .map((c) => `OLD.${c} IS NOT NEW.${c}`)
            .join(" OR ")}\n`
        : ""
      statements.push(
        `CREATE TRIGGER trg_icono_asset_summary_${name}_${action.split(" ")[0].toLowerCase()} AFTER ${action} ON ${source}\n${when}BEGIN\n${parts.map(([p, s]) => body(p, s)).join("\n")}\nEND;`,
      )
    }
  }
  triggers(
    "asset",
    "icono_portrait_assets",
    "gene_symbol,asset_sha256,is_legacy,is_stale,status",
    assetDelta,
  )
  triggers(
    "queue",
    "icono_storage_audit_queue",
    "gene_symbol,asset_sha256,audit_state,is_current,last_audited_at",
    (q, s) =>
      queueDelta(
        q,
        s,
        "",
        `EXISTS(SELECT 1 FROM icono_portrait_assets pa WHERE pa.gene_symbol=${q}.gene_symbol AND pa.asset_sha256=${q}.asset_sha256 AND ${valid("pa")})`,
      ),
  )
  triggers("publish", "icono_publish_state", "gene_symbol,current_asset_sha256", (p, s) =>
    delta(
      {
        published_live_portraits: `COALESCE(${p}.current_asset_sha256,'')<>''`,
        catalog_published_live_portraits: `COALESCE(${p}.current_asset_sha256,'')<>'' AND ${catalog(p)}`,
      },
      s,
    ),
  )
  triggers(
    "catalog",
    "icono_gene_catalog",
    "gene_symbol",
    (g, s) =>
      delta(
        { catalog_candidate_assets: "1", catalog_auditable_assets: auditable("pa") },
        s,
        "FROM icono_portrait_assets pa",
        `pa.gene_symbol=${g}.gene_symbol`,
      ) +
      "\n" +
      delta(
        { catalog_published_live_portraits: `COALESCE(ps.current_asset_sha256,'')<>''` },
        s,
        "FROM icono_publish_state ps",
        `ps.gene_symbol=${g}.gene_symbol`,
      ),
  )
  return statements
}

export function assetSummaryMigration() {
  return (
    "-- B-744: transactionally maintained admin asset and audit counts.\n-- One-time seed is executed only by the admitted migration adapter.\n\n" +
    assetSummaryMigrationStatements().join("\n\n") +
    "\n"
  )
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL("../migrations-iconoplasm/0104_asset_summary_counts.sql", import.meta.url)
  const source = assetSummaryMigration()
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== source)
      throw new Error("Asset summary migration is stale")
  } else writeFileSync(target, source, "utf8")
}
