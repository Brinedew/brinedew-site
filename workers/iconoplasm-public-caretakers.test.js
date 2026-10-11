import assert from "node:assert/strict"
import test from "node:test"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"
import { readPublicCaretakers } from "./iconoplasm-public-caretakers.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// The gene page's caretaker name and avatar, from the roles table of the real
// main schema (every migration) and the sign-in database's profile.
function buildDatabases(t) {
  const iconoplasm = iconoplasmDatabase()
  iconoplasm.raw = iconoplasm.database
  const accounts = new TestD1()
  t.after(() => {
    iconoplasm.database.close()
    accounts.close()
  })
  accounts.raw.exec(`
    CREATE TABLE users (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT,
      account_id TEXT
    );
    CREATE TABLE brinedew_account_identities (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (provider, provider_subject)
    );
  `)
  return { iconoplasm, accounts }
}

function assignmentSql({ symbol, accountId, status = "active" }) {
  const at = (when) => (when ? "'2026-10-01'" : "NULL")
  return `
    INSERT INTO icono_caretaker_assignments (
      caretaker_assignment_id, gene_symbol, account_id, status, terms_accepted_at,
      relinquish_policy, invited_by_account_id, started_at, suspended_at, ended_at, end_reason
    ) VALUES (
      'assignment_${symbol}', '${symbol}', '${accountId}', '${status}', '2026-10-01', 'retain',
      '${accountId}', '2026-10-01', ${at(status === "suspended")}, ${at(status === "ended")},
      ${status === "ended" ? "'caretaker_resigned'" : "NULL"}
    );
  `
}

test("public caretaker projection exposes only avatar and username for a current tenure", async (t) => {
  const { iconoplasm, accounts } = buildDatabases(t)
  iconoplasm.raw.exec(assignmentSql({ symbol: "TP53", accountId: "acct_current" }))
  accounts.raw.exec(`
    INSERT INTO users VALUES (
      '123456789012345678', 'Caretaker <one>',
      'https://cdn.discordapp.com/avatars/123456789012345678/avatar.png', 'acct_current'
    );
    INSERT INTO brinedew_account_identities VALUES (
      'discord', '123456789012345678', 'acct_current', 1, 1
    );
  `)

  const result = await readPublicCaretakers(iconoplasm, accounts, ["tp53", "TP53"])

  assert.deepEqual(result, {
    TP53: {
      username: "Caretaker <one>",
      avatar_url:
        "/api/avatar?src=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F123456789012345678%2Favatar.png",
    },
  })
  assert.equal(JSON.stringify(result).includes('123456789012345678"'), false)
  assert.equal(Object.isFrozen(result), true)
})

test("suspended remains visible while ended and missing profiles fail closed", async (t) => {
  const { iconoplasm, accounts } = buildDatabases(t)
  iconoplasm.raw.exec(
    assignmentSql({ symbol: "CASP9", accountId: "acct_suspended", status: "suspended" }),
  )
  iconoplasm.raw.exec(assignmentSql({ symbol: "STK11", accountId: "acct_ended", status: "ended" }))
  iconoplasm.raw.exec(assignmentSql({ symbol: "BRCA1", accountId: "acct_missing" }))
  accounts.raw.exec(`
    INSERT INTO users VALUES ('175928847299117063', 'Suspended caretaker', NULL, 'acct_suspended');
    INSERT INTO users VALUES ('999999999999999999', 'Former caretaker', NULL, 'acct_ended');
    INSERT INTO brinedew_account_identities VALUES ('discord', '175928847299117063', 'acct_suspended', 1, 2);
    INSERT INTO brinedew_account_identities VALUES ('discord', '999999999999999999', 'acct_ended', 1, 1);
  `)

  const result = await readPublicCaretakers(iconoplasm, accounts, ["CASP9", "STK11", "BRCA1"])

  assert.equal(result.CASP9.username, "Suspended caretaker")
  assert.match(result.CASP9.avatar_url, /^\/api\/avatar\?src=/)
  assert.equal(result.STK11, undefined)
  assert.equal(result.BRCA1, undefined)
})

test("range-sized caretaker reads stay inside D1 bind limits", async (t) => {
  const { iconoplasm, accounts } = buildDatabases(t)
  iconoplasm.raw.exec(assignmentSql({ symbol: "GENE120", accountId: "acct_large_range" }))
  accounts.raw.exec(`
    INSERT INTO users VALUES ('123456789012345678', 'Range caretaker', NULL, 'acct_large_range');
    INSERT INTO brinedew_account_identities VALUES (
      'discord', '123456789012345678', 'acct_large_range', 1, 1
    );
  `)
  const symbols = Array.from({ length: 401 }, (_, index) => `GENE${index}`)

  const result = await readPublicCaretakers(iconoplasm, accounts, symbols)

  assert.equal(result.GENE120.username, "Range caretaker")
  assert.equal(Object.keys(result).length, 1)
})
