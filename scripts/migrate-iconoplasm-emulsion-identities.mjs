import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const mapFlag = process.argv.indexOf("--map")
const mapPath = resolve(
  mapFlag >= 0 ? process.argv[mapFlag + 1] : "../Iconoplasm/artifacts/emulsion-identity-cutover/website-asset-emulsion-map.json",
)
const artifactDir = resolve("artifacts/b-699-emulsion-identity-cutover")
const sqlDir = resolve(artifactDir, "sql")
const configPath = resolve("wrangler.toml")
const rows = JSON.parse(readFileSync(mapPath, "utf8"))

if (!Array.isArray(rows) || rows.length === 0) throw new Error("The asset identity map is empty")
const seen = new Set()
for (const row of rows) {
  const gene = String(row?.gene_symbol || "").trim().toUpperCase()
  const asset = String(row?.asset_sha256 || "").trim().toLowerCase()
  const oldId = String(row?.old_vision_id || "").trim()
  const newId = String(row?.canonical_vision_id || "").trim()
  if (!/^[A-Z0-9-]{1,32}$/.test(gene) || !/^[a-f0-9]{64}$/.test(asset)) {
    throw new Error(`Invalid asset key: ${gene}/${asset}`)
  }
  if (!/^anima-v1-[1-9][0-9]*$/.test(oldId) || !/^anima-v1-[1-9][0-9]*$/.test(newId)) {
    throw new Error(`Invalid emulsion mapping: ${oldId} -> ${newId}`)
  }
  if (oldId === newId) throw new Error(`Unchanged row is not allowed in the transfer map: ${gene}/${asset}`)
  const key = `${gene}|${asset}`
  if (seen.has(key)) throw new Error(`Duplicate asset key: ${key}`)
  seen.add(key)
  Object.assign(row, { gene_symbol: gene, asset_sha256: asset, old_vision_id: oldId, canonical_vision_id: newId })
  if (Object.keys(row).some((keyName) => /artist|name|tag/i.test(keyName))) {
    throw new Error("Private artist identity fields are forbidden in the Website migration map")
  }
}

mkdirSync(sqlDir, { recursive: true })
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const files = []
const setupPath = resolve(sqlDir, "000-setup.sql")
writeFileSync(
  setupPath,
  `CREATE TABLE IF NOT EXISTS icono_emulsion_identity_cutover_b699 (
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  old_vision_id TEXT NOT NULL,
  canonical_vision_id TEXT NOT NULL,
  PRIMARY KEY (gene_symbol, asset_sha256)
) WITHOUT ROWID;
DELETE FROM icono_emulsion_identity_cutover_b699;
`,
)
files.push(setupPath)

const fileChunkSize = 4000
const statementChunkSize = 200
for (let fileStart = 0; fileStart < rows.length; fileStart += fileChunkSize) {
  const fileRows = rows.slice(fileStart, fileStart + fileChunkSize)
  const statements = []
  for (let start = 0; start < fileRows.length; start += statementChunkSize) {
    const values = fileRows
      .slice(start, start + statementChunkSize)
      .map(
        (row) =>
          `(${quote(row.gene_symbol)},${quote(row.asset_sha256)},${quote(row.old_vision_id)},${quote(row.canonical_vision_id)})`,
      )
      .join(",\n")
    statements.push(
      `INSERT INTO icono_emulsion_identity_cutover_b699 (gene_symbol, asset_sha256, old_vision_id, canonical_vision_id) VALUES\n${values};`,
    )
  }
  const filePath = resolve(sqlDir, `${String(files.length).padStart(3, "0")}-map.sql`)
  writeFileSync(filePath, `${statements.join("\n")}\n`)
  files.push(filePath)
}

const applyPath = resolve(sqlDir, "900-apply.sql")
writeFileSync(
  applyPath,
  `UPDATE icono_portrait_assets AS asset
SET vision_id = (SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=asset.gene_symbol AND map.asset_sha256=asset.asset_sha256),
    emulsion_id = 'A1-' || substr((SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=asset.gene_symbol AND map.asset_sha256=asset.asset_sha256), 10),
    artist_tag = NULL,
    artist_name = NULL
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=asset.gene_symbol AND map.asset_sha256=asset.asset_sha256);

UPDATE icono_image_votes AS vote SET vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=vote.gene_symbol AND map.asset_sha256=vote.asset_sha256)
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=vote.gene_symbol AND map.asset_sha256=vote.asset_sha256);
UPDATE icono_vote_asset_summary AS summary SET vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=summary.gene_symbol AND map.asset_sha256=summary.asset_sha256)
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=summary.gene_symbol AND map.asset_sha256=summary.asset_sha256);
UPDATE icono_vote_events AS event SET vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=event.gene_symbol AND map.asset_sha256=event.asset_sha256)
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=event.gene_symbol AND map.asset_sha256=event.asset_sha256);
UPDATE icono_local_removal_requests AS request SET vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.gene_symbol AND map.asset_sha256=request.asset_sha256)
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.gene_symbol AND map.asset_sha256=request.asset_sha256);
UPDATE icono_image_edit_jobs AS job SET source_vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=job.source_gene_symbol AND map.asset_sha256=job.source_asset_sha256)
WHERE EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=job.source_gene_symbol AND map.asset_sha256=job.source_asset_sha256);

UPDATE icono_generation_requests AS request
SET requested_vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.requested_reference_gene_symbol AND map.asset_sha256=request.requested_reference_asset_sha256)
WHERE request.request_mode='specific' AND EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.requested_reference_gene_symbol AND map.asset_sha256=request.requested_reference_asset_sha256);
UPDATE icono_generation_requests AS request
SET fulfilled_vision_id=(SELECT map.canonical_vision_id FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.gene_symbol AND map.asset_sha256=request.fulfilled_asset_sha256)
WHERE COALESCE(request.fulfilled_asset_sha256,'')<>'' AND EXISTS (SELECT 1 FROM icono_emulsion_identity_cutover_b699 map WHERE map.gene_symbol=request.gene_symbol AND map.asset_sha256=request.fulfilled_asset_sha256);
UPDATE icono_request_notifications AS notification
SET requested_vision_id=(SELECT request.requested_vision_id FROM icono_generation_requests request WHERE request.id=notification.request_id),
    requested_emulsion_label='A1-' || substr((SELECT request.requested_vision_id FROM icono_generation_requests request WHERE request.id=notification.request_id),10),
    fulfilled_vision_id=(SELECT request.fulfilled_vision_id FROM icono_generation_requests request WHERE request.id=notification.request_id)
WHERE EXISTS (SELECT 1 FROM icono_generation_requests request WHERE request.id=notification.request_id AND (request.requested_vision_id<>notification.requested_vision_id OR request.fulfilled_vision_id<>notification.fulfilled_vision_id));

INSERT OR IGNORE INTO icono_user_emulsion_favorites(user_id,emulsion_family_id,created_at)
SELECT user_id,'A1-30593',created_at FROM icono_user_emulsion_favorites WHERE emulsion_family_id='A1-13796';
INSERT OR IGNORE INTO icono_user_emulsion_favorites(user_id,emulsion_family_id,created_at)
SELECT user_id,'A1-21329',created_at FROM icono_user_emulsion_favorites WHERE emulsion_family_id='A1-18';
INSERT OR IGNORE INTO icono_user_emulsion_favorites(user_id,emulsion_family_id,created_at)
SELECT user_id,'A1-34047',created_at FROM icono_user_emulsion_favorites WHERE emulsion_family_id='A1-18957';
DELETE FROM icono_user_emulsion_favorites WHERE emulsion_family_id IN ('A1-13796','A1-18','A1-18957');

DELETE FROM icono_admin_gene_rollup;
DELETE FROM icono_admin_vision_rollup;
DELETE FROM icono_generation_request_vision_option_rollup;
DELETE FROM icono_user_emulsion_option_rollup;
DELETE FROM icono_admin_read_model_bootstrap;
`,
)
files.push(applyPath)

const validatePath = resolve(sqlDir, "990-validate.sql")
writeFileSync(
  validatePath,
  `SELECT 'map_rows' AS check_name, COUNT(*) AS value FROM icono_emulsion_identity_cutover_b699
UNION ALL SELECT 'mapped_assets',COUNT(*) FROM icono_portrait_assets asset JOIN icono_emulsion_identity_cutover_b699 map USING(gene_symbol,asset_sha256)
UNION ALL SELECT 'asset_mismatches',COUNT(*) FROM icono_portrait_assets asset JOIN icono_emulsion_identity_cutover_b699 map USING(gene_symbol,asset_sha256) WHERE asset.vision_id<>map.canonical_vision_id OR asset.emulsion_id<>'A1-'||substr(map.canonical_vision_id,10)
UNION ALL SELECT 'vote_mismatches',COUNT(*) FROM icono_image_votes vote JOIN icono_emulsion_identity_cutover_b699 map USING(gene_symbol,asset_sha256) WHERE vote.vision_id<>map.canonical_vision_id
UNION ALL SELECT 'summary_mismatches',COUNT(*) FROM icono_vote_asset_summary summary JOIN icono_emulsion_identity_cutover_b699 map USING(gene_symbol,asset_sha256) WHERE summary.vision_id<>map.canonical_vision_id
UNION ALL SELECT 'event_mismatches',COUNT(*) FROM icono_vote_events event JOIN icono_emulsion_identity_cutover_b699 map USING(gene_symbol,asset_sha256) WHERE event.vision_id<>map.canonical_vision_id
UNION ALL SELECT 'old_favorites',COUNT(*) FROM icono_user_emulsion_favorites WHERE emulsion_family_id IN ('A1-13796','A1-18','A1-18957');
`,
)

const cleanupPath = resolve(sqlDir, "999-cleanup.sql")
writeFileSync(cleanupPath, "DROP TABLE icono_emulsion_identity_cutover_b699;\n")

const runWrangler = (filePath) => {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  return execFileSync(
    executable,
    ["exec", "wrangler", "d1", "execute", "iconoplasm", "--remote", "--config", configPath, "--file", filePath, "--json", "--yes"],
    { cwd: resolve("."), encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  )
}

const report = { apply, map_path: mapPath, map_rows: rows.length, sql_files: files.length + 2 }
if (apply) {
  const outputs = []
  for (const filePath of files) outputs.push({ file: filePath, result: JSON.parse(runWrangler(filePath)) })
  const validation = JSON.parse(runWrangler(validatePath))
  const values = Object.fromEntries((validation?.[0]?.results || []).map((row) => [row.check_name, Number(row.value)]))
  if (values.map_rows !== rows.length || values.asset_mismatches || values.vote_mismatches || values.summary_mismatches || values.event_mismatches || values.old_favorites) {
    throw new Error(`D1 validation failed: ${JSON.stringify(values)}`)
  }
  outputs.push({ file: validatePath, result: validation })
  outputs.push({ file: cleanupPath, result: JSON.parse(runWrangler(cleanupPath)) })
  writeFileSync(resolve(artifactDir, "apply-results.json"), `${JSON.stringify(outputs, null, 2)}\n`)
  report.validation = values
}
writeFileSync(resolve(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
