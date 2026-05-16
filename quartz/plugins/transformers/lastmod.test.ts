import assert from "node:assert/strict"
import test, { describe } from "node:test"
import { usableFilesystemTimestamp } from "./lastmod"

describe("last modified date helpers", () => {
  test("ignores zero filesystem timestamps instead of warning as invalid content dates", () => {
    assert.equal(usableFilesystemTimestamp(0), undefined)
    assert.equal(usableFilesystemTimestamp(-1), undefined)
    assert.equal(usableFilesystemTimestamp(Number.NaN), undefined)
  })

  test("keeps positive filesystem timestamps", () => {
    assert.equal(usableFilesystemTimestamp(1710000000000), 1710000000000)
  })
})
