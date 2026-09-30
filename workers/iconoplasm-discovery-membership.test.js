import assert from "node:assert/strict"
import test from "node:test"
import { parseDiscoveryMembershipSymbols } from "./iconoplasm-discovery-membership.js"

test("membership validates bounded symbols before querying private storage", () => {
  assert.deepEqual(parseDiscoveryMembershipSymbols('[" ezh2 ","EZH2","TP53"]'), ["EZH2", "TP53"])
  for (const value of ["oops", "{}", "[1]", '[""]', JSON.stringify(Array(129).fill("TP53"))])
    assert.throws(() => parseDiscoveryMembershipSymbols(value))
})
