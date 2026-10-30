// B-733: the daily digest's day, read from the real migration schema with the
// cases the rules allow (docs/ICONOPLASM_DAILY_DIGEST.md, mistake 3): a
// caretaker hopping genes, a takeover by the newest of a tie (an update like
// any other), a vote flipped back, autosaved and hidden lore, a deleted
// comment, rows either side of midnight. Its cost must not grow with older
// history.
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { readDailyDigest } from "./daily-digest.js"
import { createOperationCostD1Meter } from "../test-helpers/d1-row-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

function schemaOf(folder) {
  const schema = new DatabaseSync(":memory:")
  const dir = new URL(`../../${folder}/`, import.meta.url)
  // By number: migrations/ mixes 001_ and 0027_ prefixes.
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
  for (const file of files) schema.exec(readFileSync(new URL(file, dir), "utf8"))
  return schema
}

async function copyTables(schema, db, tables) {
  for (const table of tables)
    for (const { sql } of schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC",
      )
      .all(table))
      await db.prepare(sql).run()
}

const sha = (c) => c.repeat(64)
const acct = (c) => `acct_${c.repeat(32)}`
const DAY = "2026-10-19"

async function seed(icono, accounts) {
  const run = (sql) => icono.prepare(sql).run()
  // Sparse ids, as in production (max id 333,018 over 23,513 rows).
  await run(`INSERT INTO icono_publish_events(id,gene_symbol,from_asset_sha256,to_asset_sha256,action,actor,created_at) VALUES
    (10,'GENEA','${sha("0")}','${sha("9")}','publish','vote_authority','2026-10-18 23:59:59'),
    (500,'GENEA','${sha("a")}','${sha("b")}','publish','vote_authority','2026-10-19 00:00:00'),
    (501,'GENEB','${sha("c")}','${sha("d")}','publish','vote_authority','2026-10-19 03:00:00'),
    (900,'GENEC','${sha("e")}','${sha("f")}','publish','vote_authority','2026-10-19 05:00:00'),
    (901,'GENEC','${sha("f")}','${sha("e")}','publish','vote_authority','2026-10-19 05:01:00'),
    (950,'GENED','${sha("1")}','${sha("2")}','publish','admin:owner','2026-10-19 08:00:00'),
    (951,'GENEB','','${sha("d")}','candidate_added','generator','2026-10-19 02:59:00'),
    (952,'GENEB','','${sha("3")}','candidate_added','generator','2026-10-19 02:59:30'),
    (953,'GENEE','','${sha("4")}','candidate_added','generator','2026-10-19 09:00:00'),
    (954,'GENEE','','${sha("5")}','candidate_added','generator','2026-10-19 09:00:01'),
    (955,'GENEE','','${sha("5")}','candidate_added','generator','2026-10-19 09:00:02'),
    (2000,'GENEF','${sha("6")}','${sha("7")}','publish','admin:owner','2026-10-20 00:00:00'),
    (2001,'GENEF','','${sha("8")}','candidate_added','generator','2026-10-20 00:00:01')`)
  await run(`INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,is_stale) VALUES
    ('GENEB','${sha("d")}','','','published',0), ('GENEB','${sha("3")}','','','Rejected',0),
    ('GENEE','${sha("4")}','','','draft',1), ('GENEE','${sha("5")}','','','draft',0), ('GENEF','${sha("8")}','','','draft',0)`)
  await run(`INSERT INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,upvotes,score,vote_count) VALUES
    ('GENEA','${sha("b")}','r',2,2,2)`)
  await run(`INSERT INTO icono_gene_comments(id,gene_symbol,user_id,username,avatar_url,body,status,created_at) VALUES
    (3,'GENEA','u1','early','','yesterday','visible','2026-10-18T23:59:59.999Z'),
    (7,'GENEA','u1','ana','/api/avatar?src=${encodeURIComponent("https://cdn.discordapp.com/avatars/1/a.png")}','First line\nsecond line','visible','2026-10-19T10:00:00.000Z'),
    (8,'GENEB','u2','bob','','gone','deleted','2026-10-19T11:00:00.000Z'),
    (12,'GENEB','u3','late','','tomorrow','visible','2026-10-20T00:00:00.000Z')`)
  const assignment = (id, gene, who, status, started, ended) =>
    `('${id}','${gene}','${who}','${status}','t','2026-10-01T00:00:00Z','${acct("f")}',${started ? `'${started}'` : "NULL"},${ended ? `'${ended}'` : "NULL"},${ended ? "'relinquished'" : "NULL"})`
  await run(`INSERT INTO icono_caretaker_assignments(caretaker_assignment_id,gene_symbol,account_id,status,terms_version_id,terms_accepted_at,invited_by_account_id,started_at,ended_at,end_reason) VALUES
    ${assignment("n1", "CA3", acct("1"), "ended", "2026-10-10T00:00:00Z", "2026-10-19T10:00:00Z")},
    ${assignment("n2", "OTP", acct("1"), "ended", "2026-10-19T10:05:00Z", "2026-10-19T11:00:00Z")},
    ${assignment("n3", "LARP1", acct("1"), "active", "2026-10-19T11:05:00Z", null)},
    ${assignment("s1", "SOX11", acct("2"), "active", "2026-10-19T12:00:00Z", null)},
    ${assignment("x1", "GENEX", acct("3"), "ended", "2026-10-19T12:00:00Z", "2026-10-19T13:00:00Z")}`)
  const version = (id, gene, line, v, who, text, see, at, withdrawn = null) =>
    `('${id}','${gene}','${line}',${v},'${who}','n3','${text}','${sha("a")}',${see},'${at}',${withdrawn ? `'${withdrawn}'` : "NULL"})`
  await run(`INSERT INTO icono_caretaker_text_versions(version_id,gene_symbol,line_id,version,account_id,caretaker_assignment_id,text,text_sha256,readers_see,created_at,withdrawn_at) VALUES
    ${version("v1", "LARP1", "l1", 1, acct("1"), "draft one", 1, "2026-10-19 12:00:00")},
    ${version("v2", "LARP1", "l1", 2, acct("1"), "draft two", 1, "2026-10-19 12:01:00")},
    ${version("v3", "LARP1", "l1", 3, acct("1"), "The final words.\n\nMore.", 1, "2026-10-19 12:02:00")},
    ${version("h1", "SOX11", "l2", 1, acct("2"), "hidden", 0, "2026-10-19 13:00:00")},
    ${version("w1", "GENEA", "l3", 1, acct("2"), "withdrawn", 1, "2026-10-19 13:00:00", "2026-10-19 14:00:00")}`)
  await run(`INSERT INTO icono_gene_texts(gene_symbol,gene_id,text_id,version,text_sha256,chosen_caretaker_version_id) VALUES
    ('LARP1','g1','t1',1,'${sha("a")}','v3'), ('SOX11','g2','t2',1,'${sha("a")}','h1'), ('GENEA','g3','t3',1,'${sha("a")}','w1')`)
  for (const [c, name] of [
    ["1", "loweren"],
    ["2", "sox"],
  ]) {
    await accounts
      .prepare(`INSERT INTO brinedew_accounts(account_id,created_at,updated_at) VALUES(?,1,1)`)
      .bind(acct(c))
      .run()
    await accounts
      .prepare(
        `INSERT INTO users(discord_id,username,avatar_url,created_at,updated_at) VALUES(?,?,?,1,1)`,
      )
      .bind(`d${c}`, name, `https://cdn.discordapp.com/avatars/d${c}/x.png`)
      .run()
    await accounts
      .prepare(
        `INSERT INTO brinedew_account_identities(provider,provider_subject,account_id,created_at,last_seen_at) VALUES('discord',?,?,1,1)`,
      )
      .bind(`d${c}`, acct(c))
      .run()
  }
}

test(
  "the digest settles the day at midnight and its cost ignores older history",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["ICONO", "ACCOUNTS"],
      }),
    )
    try {
      const icono = await runtime.getD1Database("ICONO")
      const accounts = await runtime.getD1Database("ACCOUNTS")
      await copyTables(schemaOf("migrations-iconoplasm"), icono, [
        "icono_publish_events",
        "icono_portrait_assets",
        "icono_vote_asset_summary",
        "icono_gene_comments",
        "icono_caretaker_assignments",
        "icono_caretaker_text_versions",
        "icono_gene_texts",
      ])
      await copyTables(schemaOf("migrations"), accounts, [
        "brinedew_accounts",
        "users",
        "brinedew_account_identities",
      ])
      await seed(icono, accounts)

      const read = async () => {
        const meter = createOperationCostD1Meter(icono)
        const digest = await readDailyDigest({
          iconoplasmDb: meter.db,
          accountDb: accounts,
          day: DAY,
        })
        const cost = meter.finish()
        assert.equal(cost.rows_written, 0)
        return { digest, cost }
      }
      const { digest, cost } = await read()

      // GENEA: the vote raised the winner, so it comes first. GENEB: a new
      // candidate took over a tie nobody had voted on; it is an update all the
      // same (mistake 30). GENED: the owner chose it. GENEC flipped back, so
      // nothing changed; GENEF is tomorrow.
      assert.deepEqual(
        digest.updates.map((u) => [u.symbol, u.from_sha[0], u.to_sha[0]]),
        [
          ["GENEA", "a", "b"],
          ["GENEB", "c", "d"],
          ["GENED", "1", "2"],
        ],
      )
      // Rejected (any case), stale and duplicate candidates drop out.
      assert.deepEqual(
        digest.candidates.map((c) => [c.symbol, c.shas.length]),
        [
          ["GENEB", 1],
          ["GENEE", 1],
        ],
      )
      // The nomad appears once, on the gene held at midnight, moved from the
      // gene held when the day began; a caretaker who left again doesn't appear.
      assert.deepEqual(
        digest.caretakers.map((c) => [c.symbol, c.from_symbol, c.username, c.avatar]),
        [
          ["LARP1", "CA3", "loweren", "https://cdn.discordapp.com/avatars/d1/x.png"],
          ["SOX11", null, "sox", "https://cdn.discordapp.com/avatars/d2/x.png"],
        ],
      )
      // Autosaves are one change; hidden and withdrawn lore never shows.
      assert.deepEqual(
        digest.lore.map((l) => [l.symbol, l.username, l.text]),
        [["LARP1", "loweren", "The final words."]],
      )
      assert.deepEqual(
        digest.comments.map((c) => [c.symbol, c.username, c.avatar, c.text]),
        [["GENEA", "ana", "https://cdn.discordapp.com/avatars/1/a.png", "First line"]],
      )

      // Twenty thousand events from the next day cost about one more seek step.
      await icono
        .prepare(
          "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO icono_publish_events(id,gene_symbol,action,actor,created_at) SELECT 3000+i,'OLD'||i,'candidate_added','g','2026-10-20 01:00:00' FROM n",
        )
        .run()
      const later = await read()
      assert.deepEqual(later.digest, digest)
      assert.ok(
        later.cost.rows_read <= cost.rows_read + 20,
        JSON.stringify({ before: cost, after: later.cost }),
      )
      t.diagnostic(JSON.stringify({ rows_read: cost.rows_read, after20000: later.cost.rows_read }))
    } finally {
      await runtime.dispose()
    }
  },
)
