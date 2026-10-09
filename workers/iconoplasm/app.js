// The Worker's router (B-1063). Hono answers the routes it knows; everything
// else falls through to the legacy handler, route by route until it is empty.
// New routes are written here with Hono, Zod and Drizzle, never added to the
// legacy if-chain.
import { zValidator } from "@hono/zod-validator"
import { inArray, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { Hono } from "hono"
import { bearerAuth } from "hono/bearer-auth"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"

import { d1DailyRowReadLimitResponse } from "../lib/cloudflare-availability.js"
import { geneCatalog, portraitAssets, publishEvents } from "./db/schema.js"

// A card rebuild spends up to four of the 50 subrequests Cloudflare's free plan
// allows one request (the canonical text's body, the card's PUT and its
// read-back), so one request rebuilds at most eight genes.
export const MAX_GENES_PER_REQUEST = 8
export const REGISTER_MAX_PORTRAITS = 100

const sha256 = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/)
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/)

const portraitSchema = z.object({
  symbol: symbolSchema,
  asset_sha256: sha256,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive().nullish(),
  vision_id: optionalText(255),
  emulsion_id: optionalText(64),
  workflow_id: optionalText(32),
  workflow_label: optionalText(255),
  workflow_path: optionalText(512),
  prompt_version: optionalText(16),
  variant_slot: optionalText(32),
  candidate_image_id: z.number().int().nonnegative().nullish(),
  sample_label: optionalText(64),
  sample_number: z.number().int().nonnegative().default(0),
  sample_text_hash: sha256.nullish(),
  is_stale: z.boolean().default(false),
})

const registerSchema = z
  .object({
    created_by: z.string().trim().min(1).max(255),
    portraits: z.array(portraitSchema).min(1).max(REGISTER_MAX_PORTRAITS),
  })
  .refine((body) => new Set(body.portraits.map((p) => p.symbol)).size <= MAX_GENES_PER_REQUEST, {
    message: `At most ${MAX_GENES_PER_REQUEST} genes per registration`,
  })

function portraitKey(assetSha256, rendition) {
  return `portraits/v1/${assetSha256.slice(0, 2)}/${assetSha256}/${rendition}.webp`
}

// The factory's columns. On a re-registration they change only when the
// factory's values differ, so an unchanged portrait rewrites no row, index or
// trigger-maintained projection. Status and auto-pick stay the site's.
const FACTORY_COLUMNS = {
  width: "width",
  height: "height",
  bytes: "bytes",
  visionId: "vision_id",
  emulsionId: "emulsion_id",
  workflowId: "workflow_id",
  workflowLabel: "workflow_label",
  workflowPath: "workflow_path",
  promptVersion: "prompt_version",
  variantSlot: "variant_slot",
  candidateImageId: "candidate_image_id",
  sampleLabel: "sample_label",
  sampleNumber: "sample_number",
  sampleTextHash: "sample_text_hash",
  isStale: "is_stale",
}
const FACTORY_UPDATE = {
  ...Object.fromEntries(
    Object.entries(FACTORY_COLUMNS).map(([key, column]) => [key, sql.raw(`excluded.${column}`)]),
  ),
  isLegacy: 0,
}
const FACTORY_CHANGED = sql.raw(
  [
    ...Object.values(FACTORY_COLUMNS).map(
      (column) => `icono_portrait_assets.${column} IS NOT excluded.${column}`,
    ),
    "icono_portrait_assets.is_legacy IS NOT 0",
  ].join(" OR "),
)

function portraitRow(portrait, createdBy) {
  return {
    geneSymbol: portrait.symbol,
    assetSha256: portrait.asset_sha256,
    keyFull: portraitKey(portrait.asset_sha256, "full"),
    keyMedium: portraitKey(portrait.asset_sha256, "medium"),
    keyThumb: portraitKey(portrait.asset_sha256, "thumb"),
    width: portrait.width,
    height: portrait.height,
    bytes: portrait.bytes ?? null,
    visionId: portrait.vision_id ?? null,
    emulsionId: portrait.emulsion_id ?? null,
    workflowId: portrait.workflow_id ?? null,
    workflowLabel: portrait.workflow_label ?? null,
    workflowPath: portrait.workflow_path ?? null,
    promptVersion: portrait.prompt_version ?? null,
    variantSlot: portrait.variant_slot ?? null,
    candidateImageId: portrait.candidate_image_id ?? null,
    sampleLabel: portrait.sample_label ?? null,
    sampleNumber: portrait.sample_number,
    sampleTextHash: portrait.sample_text_hash ?? null,
    isStale: portrait.is_stale ? 1 : 0,
    createdBy,
  }
}

function executionContext(c) {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

// The factory's credential, as a standard bearer token. Attached to each
// factory route, never to a path prefix: the legacy admin routes behind the
// fall-through keep their own checks (admin sessions, the old header).
async function factoryAuth(c, next) {
  const token = String(c.env?.ICONOPLASM_ADMIN_TOKEN || "").trim()
  if (!token) return c.json({ error: "Admin token is not configured" }, 503)
  return bearerAuth({ token })(c, next)
}

// A data_maintenance release pauses every D1 writer.
async function outsideMaintenance(c, next) {
  if (c.env?.ICONOPLASM_SCHEMA_TRANSITION === "1")
    return c.json({ error: "The site is in a database maintenance window" }, 503)
  return next()
}

export function createIconoplasmApp({ legacy, publishGene, refreshSummaries }) {
  const app = new Hono()
  // Hono's own HTTP answers (a refused bearer token) stay responses. Any other
  // thrown error leaves the app as it is: the Worker's error reporting
  // (withErrorReporting, B-832) sends it to Sentry with its stack, as it did
  // before Hono stood in front. Cloudflare's own daily D1 read limit is not a bug
  // either: it answers 503 with the reset time, which the factory turns into a
  // deferral it sleeps through (Iconoplasm drain/deferred_retry.py).
  app.onError((error) => {
    if (error instanceof HTTPException) return error.getResponse()
    const wall = d1DailyRowReadLimitResponse(error)
    if (wall) return wall
    throw error
  })

  /**
   * The factory registers portraits it has already uploaded to the CDN
   * (portraits/v1/<sha>/{full,medium,thumb}.webp), then each touched gene's
   * card is rebuilt. Two D1 reads (which genes the catalogue carries, which
   * portraits exist), one D1 batch for the rows and a `candidate_added` event
   * per new portrait (the catalogue builder follows those), then one card
   * build per gene, then the genes' admin and picker summaries. A portrait of
   * a gene the catalogue doesn't carry is refused, not stored: it would have
   * no card to land on. Re-sending the same body changes no row and rebuilds
   * the cards and summaries again, so the factory retries a failed gene by
   * sending its portraits again.
   */
  app.post(
    "/api/iconoplasm/admin/portraits/register",
    factoryAuth,
    outsideMaintenance,
    zValidator("json", registerSchema),
    async (c) => {
      const { created_by: createdBy, portraits: sent } = c.req.valid("json")
      const db = drizzle(c.env.ICONOPLASM_DB)
      const sentSymbols = [...new Set(sent.map((portrait) => portrait.symbol))]
      const listed = new Set(
        (
          await db
            .select({ symbol: geneCatalog.geneSymbol })
            .from(geneCatalog)
            .where(inArray(geneCatalog.geneSymbol, sentSymbols))
        ).map((row) => row.symbol),
      )
      const portraits = sent.filter((portrait) => listed.has(portrait.symbol))
      const symbols = sentSymbols.filter((symbol) => listed.has(symbol))
      const genes = sentSymbols
        .filter((symbol) => !listed.has(symbol))
        .map((symbol) => ({ symbol, ok: false, error: "The catalogue doesn't carry this gene" }))
      if (!portraits.length) return c.json({ ok: false, registered: 0, added: 0, genes })
      const existing = await db
        .select({ symbol: portraitAssets.geneSymbol, sha: portraitAssets.assetSha256 })
        .from(portraitAssets)
        .where(inArray(portraitAssets.geneSymbol, symbols))
      const known = new Set(existing.map((row) => `${row.symbol}|${row.sha}`))
      const added = portraits.filter(
        (portrait) => !known.has(`${portrait.symbol}|${portrait.asset_sha256}`),
      )
      const statements = portraits.map((portrait) =>
        db
          .insert(portraitAssets)
          .values(portraitRow(portrait, createdBy))
          .onConflictDoUpdate({
            target: [portraitAssets.geneSymbol, portraitAssets.assetSha256],
            set: FACTORY_UPDATE,
            setWhere: FACTORY_CHANGED,
          }),
      )
      for (const portrait of added)
        statements.push(
          db.insert(publishEvents).values({
            geneSymbol: portrait.symbol,
            toAssetSha256: portrait.asset_sha256,
            action: "candidate_added",
            actor: createdBy,
            reason: "factory_registration",
          }),
        )
      await db.batch(statements)

      for (const symbol of symbols) {
        try {
          const receipt = await publishGene(c.env, symbol)
          genes.push({
            symbol,
            ok: !receipt?.withdrawn,
            winner_asset_sha256: receipt?.winner_asset_sha256 ?? null,
            ...(receipt?.withdrawn ? { error: "The catalogue doesn't carry this gene" } : {}),
          })
        } catch (error) {
          genes.push({ symbol, ok: false, error: String(error?.message || error).slice(0, 300) })
        }
      }
      await refreshSummaries(c.env, {
        symbols,
        visionIds: [...new Set(portraits.map((portrait) => portrait.vision_id).filter(Boolean))],
      })
      return c.json({
        ok: genes.every((gene) => gene.ok),
        registered: portraits.length,
        added: added.length,
        genes,
      })
    },
  )

  /**
   * Rebuilds named genes' cards from what D1 holds now: the bulk sweep
   * (scripts/republish-iconoplasm-gene-objects.mjs) and the catalogue publisher in
   * GitHub Actions call it for genes whose cards must change. Same path and answer
   * as the legacy handler it replaces; a gene that fails is reported and the rest
   * still rebuild.
   */
  app.post(
    "/api/iconoplasm/admin/publication/republish",
    factoryAuth,
    outsideMaintenance,
    zValidator(
      "json",
      z.object({ symbols: z.array(symbolSchema).min(1).max(MAX_GENES_PER_REQUEST) }),
    ),
    async (c) => {
      const symbols = [...new Set(c.req.valid("json").symbols)]
      const results = []
      for (const symbol of symbols) {
        try {
          results.push({ ok: true, ...(await publishGene(c.env, symbol)) })
        } catch (error) {
          results.push({ ok: false, symbol, error: String(error?.message || error).slice(0, 300) })
        }
      }
      const failed = results.filter((result) => !result.ok).length
      c.header("Cache-Control", "no-store")
      return c.json({ ok: true, published: results.length - failed, failed, results })
    },
  )

  app.all("*", (c) => legacy(c.req.raw, c.env, executionContext(c)))
  return app
}
