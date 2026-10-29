// B-1188: the admin gallery shows the true card, and every view keeps its price
// flat as the site grows. The owner opens it to see the state of the site, so
// it must stay cheap when readers and portraits multiply, and it must show
// what readers see. This runs the real SQL on the fully migrated schema in
// Miniflare and counts rows from D1's own receipts, on a site of 2,000 genes
// and on one ten times larger (the genome's size).
//
// Ways this can fail, written before the code:
//  1. the name and recency views (both modes; name is the default) read more
//     rows on the larger site: they read a whole table or sorted one, as the
//     old rollup sorts did (up to 248,926 rows a click on 2026-10-29);
//  2. any view reads more than about four rows per gene in the catalogue plus
//     its page's own portraits: a filter or a search reached past the genome
//     into the portraits or the votes. The one view allowed past it is the
//     All candidates vote sort, at up to two rows a candidate (migration 0146
//     says why there is no score index);
//  3. the gallery shows a card other than the published one: the rollup copy
//     showed TP53's old card on 2026-10-29, while readers saw b85a9223;
//  4. the vote winner it shows is not the one the election would publish;
//  5. a filter lists a gene that does not meet it, or misses one that does;
//  6. a sort's first rows are not the gene with the best votes, the newest
//     portrait, or the broken and stale genes;
//  7. a page with one busy gene (72 portraits in a row, all of TP53) comes up
//     short or repeats the gene.
//  8. the admin home's counts or its list of genes that need the owner are not
//     the site's (0095 counted 610 genes with no candidate that each had one).
import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"

import { handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { readAdminGallery } from "./admin-gallery.js"
import { createOperationCostD1Meter } from "../test-helpers/d1-row-meter.js"

const MIGRATIONS = new URL("../../migrations-iconoplasm/", import.meta.url)
const require = createRequire(import.meta.url)
const LIMIT = 120
const TOKEN = "admin-token-0000000000000000000000000002"

const sha = (n) => n.toString(16).padStart(64, "0")
const symbol = (n) => `G${String(n).padStart(5, "0")}`
// TP53 has 72 portraits. Readers see A and the votes favour B.
const tp53 = (j) => sha(9_000_000 + j)
const A = tp53(3)
const B = tp53(40)
const NOT_STORED = "e".repeat(64)

// The site's shape for gene n of N: every 50th gene has no portrait; the rest
// have three, the first published. Every 500th (from 7) names a portrait that
// is not stored, every 700th (from 3) is pinned, every 400th (from 1) has a
// stale portrait, and every 10th is a "kinase". The first 150 genes hold the
// best votes, so the vote sort's first page is the same on both sites.
const hasPortraits = (n) => n % 50 !== 0
const isBroken = (n) => n % 500 === 7
const isPinned = (n) => n % 700 === 3
const isStale = (n) => n % 400 === 1

function productionSchema() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  return db
    .prepare(
      "SELECT sql, type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid",
    )
    .all()
}

async function seedSite(db, genes) {
  const ids = `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM ids WHERE n < ${genes}),
                    js(j) AS (VALUES(1), (2), (3))`
  const name = `printf('G%05d', n)`
  const tp53Ids = `WITH RECURSIVE js(j) AS (VALUES(1) UNION ALL SELECT j + 1 FROM js WHERE j < 72)`
  for (const sql of [
    // The counters' rows; migrations 0104 and 0147 make them from production's data.
    `INSERT INTO icono_admin_dashboard_summary (summary_key) VALUES ('default')`,
    `INSERT INTO icono_asset_summary_counts (summary_key) VALUES ('default')`,
    `${ids} INSERT INTO icono_gene_catalog (gene_symbol, full_name)
       SELECT ${name}, CASE WHEN n % 10 = 0 THEN 'protein kinase ' || n ELSE 'protein ' || n END
         FROM ids`,
    `INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')`,
    `${ids} INSERT INTO icono_portrait_assets
       (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, r2_key_medium, is_stale)
       SELECT ${name}, printf('%064x', n * 10 + j), 'f', 't', 'm', (n % 400 = 1 AND j = 2)
         FROM ids CROSS JOIN js WHERE n % 50 <> 0 ORDER BY n, j`,
    // TP53's portraits arrive last, all in a row: the newest on the site.
    `${tp53Ids} INSERT INTO icono_portrait_assets
       (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, r2_key_medium)
       SELECT 'TP53', printf('%064x', 9000000 + j), 'f', 't', 'm' FROM js ORDER BY j`,
    `${ids} INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, admin_override)
       SELECT ${name}, CASE WHEN n % 500 = 7 THEN '${NOT_STORED}' ELSE printf('%064x', n * 10 + 1) END,
              (n % 700 = 3)
         FROM ids WHERE n % 50 <> 0`,
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256) VALUES ('TP53', '${A}')`,
    `${ids} INSERT INTO icono_vote_asset_summary
       (gene_symbol, asset_sha256, candidate_ref, upvotes, score, vote_count)
       SELECT ${name}, printf('%064x', n * 10 + j), 'a:' || ${name}, s, s, s
         FROM (SELECT n, j, CASE WHEN j > 1 THEN 0 WHEN n <= 150 THEN 1000 - n ELSE n % 50 END AS s
                 FROM ids CROSS JOIN js WHERE n % 50 <> 0)`,
    `${tp53Ids} INSERT INTO icono_vote_asset_summary
       (gene_symbol, asset_sha256, candidate_ref, upvotes, score, vote_count)
       SELECT 'TP53', printf('%064x', 9000000 + j), 'a:TP53', s, s, s
         FROM (SELECT j, CASE WHEN j = 40 THEN 40 ELSE 0 END AS s FROM js)`,
  ])
    await db.prepare(sql).run()
}

async function priced(db, view) {
  const meter = createOperationCostD1Meter(db)
  const page = await readAdminGallery(
    meter.db,
    { page: 1, limit: LIMIT, filter: "all", sort: "name", query: "", mode: "live", ...view },
    { portraitUrl: (asset, rendition) => (asset ? `/p/${asset}/${rendition}` : null) },
  )
  return { page, reads: meter.finish().rows_read }
}

const range = (genes, keep) =>
  Array.from({ length: genes }, (_, i) => i + 1)
    .filter(keep)
    .map(symbol)

test(
  "every admin gallery view shows the true card at a price the genome bounds",
  {
    timeout: 600_000,
  },
  async (t) => {
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const definitions = productionSchema()
    const measured = {}
    for (const genes of [2000, 20000]) {
      const runtime = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          script: "export default {fetch(){return new Response('local')}}",
          compatibilityDate: "2026-08-01",
          d1Databases: ["DB"],
        }),
      )
      try {
        const db = await runtime.getD1Database("DB")
        for (const type of ["structure", "trigger"]) {
          const batch = definitions.filter((x) => (x.type === "trigger") === (type === "trigger"))
          for (let i = 0; i < batch.length; i += 20)
            await db.batch(batch.slice(i, i + 20).map((x) => db.prepare(x.sql)))
        }
        await seedSite(db, genes)
        const portraits = 3 * range(genes, hasPortraits).length + 72
        const views = {}
        const view = async (label, options) => {
          const result = await priced(db, options)
          views[label] = result.reads
          return result.page
        }

        // 3, 4: readers' card, the election's winner, and TP53's own counts.
        const tp = (await view("live search TP53", { query: "TP53" })).rows
        assert.deepEqual(
          tp.map((row) => [row.gene_symbol, row.live_sha, row.leader_sha, row.candidate_count]),
          [["TP53", A, B, 72]],
        )
        assert.equal(tp[0].has_mismatch, false)
        const tpAll = (await view("all search TP53", { mode: "all", query: "TP53" })).rows
        assert.equal(tpAll.length, 72)
        assert.deepEqual(
          tpAll.filter((row) => row.is_live).map((row) => row.asset_sha256),
          [A],
        )

        // 5: each filter lists exactly the genes that meet it.
        const listed = (page) => page.rows.map((row) => row.gene_symbol)
        const pinned = await view("live pinned", { filter: "pinned" })
        assert.deepEqual(listed(pinned), range(genes, isPinned))
        assert.ok(pinned.rows.every((row) => row.admin_override))
        const broken = await view("live mismatch", { filter: "mismatch" })
        assert.deepEqual(listed(broken), range(genes, isBroken))
        assert.ok(broken.rows.every((row) => row.has_mismatch && row.live_sha === NOT_STORED))
        const stale = await view("live stale", { filter: "stale" })
        assert.deepEqual(listed(stale), range(genes, isStale).slice(0, LIMIT))
        assert.ok(stale.rows.every((row) => row.has_stale && row.stale_count === 1))
        const staleAll = await view("all stale", { mode: "all", filter: "stale" })
        assert.deepEqual(
          staleAll.rows.map((row) => [row.gene_symbol, row.is_stale]),
          range(genes, isStale)
            .slice(0, LIMIT)
            .map((gene) => [gene, true]),
        )
        const missing = await view("live missing", { filter: "missing" })
        assert.equal(missing.total, genes / 50)
        assert.deepEqual(listed(missing), range(genes, (n) => !hasPortraits(n)).slice(0, LIMIT))
        assert.ok(missing.rows.every((row) => row.missing && row.live_sha === null))

        // 6, 7: each sort's first rows, and full pages past a busy gene.
        const byName = await view("live name", {})
        assert.equal(byName.total, genes + 1)
        assert.deepEqual(listed(byName), range(genes + 1, () => true).slice(0, LIMIT))
        const byVotes = await view("live votes", { sort: "votes" })
        assert.deepEqual(listed(byVotes).slice(0, 3), ["G00001", "G00002", "G00003"])
        assert.equal(new Set(listed(byVotes)).size, LIMIT)
        const byRecency = await view("live recency", { sort: "recency" })
        assert.deepEqual(listed(byRecency).slice(0, 2), ["TP53", symbol(genes - 1)])
        assert.equal(new Set(listed(byRecency)).size, LIMIT)
        const mismatchFirst = await view("live mismatch first", { sort: "mismatch" })
        const head = [...range(genes, isBroken), ...range(genes, isStale)].slice(0, LIMIT)
        assert.deepEqual(listed(mismatchFirst).slice(0, head.length), head)
        assert.equal(mismatchFirst.rows.length, LIMIT)
        const allByName = await view("all name", { mode: "all" })
        assert.equal(allByName.total, portraits)
        const allByVotes = await view("all votes", { mode: "all", sort: "votes" })
        assert.equal(allByVotes.rows[0].asset_sha256, sha(11))
        const allByRecency = await view("all recency", { mode: "all", sort: "recency" })
        assert.deepEqual(
          allByRecency.rows.slice(0, 72).map((row) => row.asset_sha256),
          Array.from({ length: 72 }, (_, i) => tp53(72 - i)),
        )
        await view("all mismatch first", { mode: "all", sort: "mismatch" })
        const kinases = await view("live search kinase", { query: "KINASE" })
        assert.equal(kinases.total, genes / 10)
        // The dearest view on production's copy (76,679 rows on 2026-10-29).
        await view("all mismatch first, search kinase", {
          mode: "all",
          sort: "mismatch",
          query: "KINASE",
        })
        for (const sort of ["votes", "recency", "mismatch"])
          await view(`live ${sort}, search kinase`, { sort, query: "KINASE" })

        // 8: the admin home counts the site as it is, and lists the broken
        // genes first, then the ones with no candidate.
        const homeMeter = createOperationCostD1Meter(db)
        const home = await (
          await handleApi(
            new Request(
              "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/overview?event_limit=0",
              { headers: { Authorization: `Bearer ${TOKEN}` } },
            ),
            { ICONOPLASM_DB: homeMeter.db, ICONOPLASM_ADMIN_TOKEN: TOKEN },
            {},
          )
        ).json()
        views["admin home"] = homeMeter.finish().rows_read
        const bare = range(genes, (n) => !hasPortraits(n))
        assert.deepEqual(
          [home.summary.genes, home.summary.drift, home.summary.missing],
          [genes + 1, range(genes, isBroken).length, bare.length],
        )
        assert.deepEqual(
          home.attention.map((item) => item.symbol),
          [...range(genes, isBroken), ...bare].slice(0, 12),
        )

        // 2: no view reads past the genome and its page's own portraits.
        measured[genes] = views
        t.diagnostic(JSON.stringify({ [genes]: views }))
        // A page's facts cost about 30 rows a gene: its portraits and their
        // votes, its card, its name and its caretaker.
        // The All candidates vote sort reads each candidate's summary, and D1
        // counts each voted one again as it sorts.
        for (const [label, reads] of Object.entries(views))
          assert.ok(
            reads <= (label === "all votes" ? 2 * portraits : 4 * genes) + 40 * LIMIT,
            `${genes} genes, ${label}: ${reads} rows`,
          )
      } finally {
        await runtime.dispose()
      }
    }
    // 1: ten times the site costs the name and recency views nothing more.
    for (const label of ["live name", "live recency", "all name", "all recency"])
      assert.ok(
        measured[20000][label] <= measured[2000][label] + 10,
        `${label}: ${measured[2000][label]} rows on 2,000 genes, ${measured[20000][label]} on 20,000`,
      )
  },
)
