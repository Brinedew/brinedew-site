// Drizzle definitions of the D1 tables the Hono routes read and write
// (workers/iconoplasm/app.js). A table joins this file with its first Hono
// route (B-1063); the SQL files in migrations-iconoplasm/ stay the schema of
// record, and these definitions name only the columns the routes use.
import { sql } from "drizzle-orm"
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const geneCatalog = sqliteTable("icono_gene_catalog", {
  geneSymbol: text("gene_symbol").primaryKey(),
})

export const portraitAssets = sqliteTable(
  "icono_portrait_assets",
  {
    geneSymbol: text("gene_symbol").notNull(),
    assetSha256: text("asset_sha256").notNull(),
    keyFull: text("r2_key_full").notNull(),
    keyMedium: text("r2_key_medium"),
    keyThumb: text("r2_key_thumb").notNull(),
    mime: text("mime").notNull().default("image/webp"),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    status: text("status").notNull().default("draft"),
    autopickEligible: integer("autopick_eligible").notNull().default(1),
    isStale: integer("is_stale").notNull().default(0),
    isLegacy: integer("is_legacy").notNull().default(0),
    visionId: text("vision_id"),
    emulsionId: text("emulsion_id"),
    workflowId: text("workflow_id"),
    workflowLabel: text("workflow_label"),
    workflowPath: text("workflow_path"),
    promptVersion: text("prompt_version"),
    variantSlot: text("variant_slot"),
    candidateImageId: integer("candidate_image_id"),
    sampleLabel: text("sample_label"),
    sampleNumber: integer("sample_number").notNull().default(0),
    sampleTextHash: text("sample_text_hash"),
    createdBy: text("created_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.geneSymbol, table.assetSha256] })],
)

export const publishEvents = sqliteTable("icono_publish_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  geneSymbol: text("gene_symbol").notNull(),
  fromAssetSha256: text("from_asset_sha256"),
  toAssetSha256: text("to_asset_sha256"),
  action: text("action").notNull(),
  actor: text("actor"),
  reason: text("reason"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})
