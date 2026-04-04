import assert from "node:assert/strict"
import test from "node:test"

import {
  getCalibratedColorName,
  isKnownCalibratedColorName,
  normalizeHexColor,
  resolveDisplayedColorName,
} from "./color-name-db.js"

test("calibrated color matcher uses the same palette name as the control-plane", () => {
  assert.equal(getCalibratedColorName("#AED7C3"), "Refrigerator Green")
})

test("calibrated color matcher normalizes bare hex input", () => {
  assert.equal(normalizeHexColor("1b1b1b"), "#1B1B1B")
  assert.equal(getCalibratedColorName("1b1b1b"), "Onyx Black")
})

test("calibrated name membership uses the real palette file", () => {
  assert.equal(isKnownCalibratedColorName("Light Teal"), true)
  assert.equal(isKnownCalibratedColorName("Dark Teal"), true)
  assert.equal(isKnownCalibratedColorName("Teal Blue"), true)
  assert.equal(isKnownCalibratedColorName("Teal"), false)
  assert.equal(isKnownCalibratedColorName("Soft Teal"), false)
})

test("displayed color resolver rejects non-database synced names and uses calibrated names", () => {
  assert.equal(
    resolveDisplayedColorName("#AED7C3", {
      skin_hex: "#AED7C3",
      skin_name: "Teal",
    }),
    "Refrigerator Green",
  )

  assert.equal(
    resolveDisplayedColorName("#AED7C3", {
      skin_hex: "#AED7C3",
      skin_name: "Soft Teal",
    }),
    "Refrigerator Green",
  )
})

test("displayed color resolver still honors exact calibrated synced names", () => {
  assert.equal(
    resolveDisplayedColorName("#AED7C3", {
      skin_hex: "#AED7C3",
      skin_name: "Refrigerator Green",
    }),
    "Refrigerator Green",
  )
})