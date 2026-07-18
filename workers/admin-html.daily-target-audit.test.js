import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_HTML } from "./admin-html.js"

test("daily target rejection audit displays the recorded UniProt id", () => {
  assert.match(
    ADMIN_HTML,
    /r\?\.gene \|\| r\?\.hgnc \|\| r\?\.symbol \|\| r\?\.uniprot_id \|\| 'Unknown'/,
  )
})
