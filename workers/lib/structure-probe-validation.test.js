import assert from "node:assert/strict"
import test from "node:test"

import { isUsableStructureProbe } from "./structure-probe-validation.js"

const bytes = (value) => new TextEncoder().encode(value)

test("structure probes reject successful HTML and JSON error documents", () => {
  assert.equal(
    isUsableStructureProbe({
      format: "pdb",
      contentType: "text/html; charset=utf-8",
      bytes: bytes("<html>temporary error</html>"),
    }),
    false,
  )
  assert.equal(
    isUsableStructureProbe({
      format: "cif",
      contentType: "application/json",
      bytes: bytes('{"error":"not found"}'),
    }),
    false,
  )
})

test("structure probes recognize PDB, CIF, and non-empty binary CIF payloads", () => {
  assert.equal(
    isUsableStructureProbe({
      format: "pdb",
      contentType: "chemical/x-pdb",
      bytes: bytes("REMARK   SWISS-MODEL\nATOM      1  N"),
    }),
    true,
  )
  assert.equal(
    isUsableStructureProbe({
      format: "cif",
      contentType: "chemical/x-cif",
      bytes: bytes("#\ndata_Q96T54\n_entry.id Q96T54"),
    }),
    true,
  )
  assert.equal(
    isUsableStructureProbe({
      format: "bcif",
      contentType: "application/octet-stream",
      bytes: new Uint8Array([0x83, 0xa7, 0x76, 0x65]),
    }),
    true,
  )
})

test("structure probes reject text that cannot be parsed as the declared format", () => {
  assert.equal(
    isUsableStructureProbe({
      format: "pdb",
      contentType: "text/plain",
      bytes: bytes("upstream is healthy"),
    }),
    false,
  )
  assert.equal(
    isUsableStructureProbe({
      format: "cif",
      contentType: "text/plain",
      bytes: bytes("ATOM 1 N"),
    }),
    false,
  )
})
