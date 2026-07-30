import assert from "node:assert/strict"
import { createServer, get } from "node:http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"

import sirv from "sirv"

import { serveStaticRequest } from "./handlers.js"

test("an aborted static response is a normal terminal state", async () => {
  const response = new PassThrough()
  const handler = (_request, stream) => {
    queueMicrotask(() => stream.destroy())
  }

  await assert.doesNotReject(serveStaticRequest(handler, {}, response))
})

test("real static response errors still reject", async () => {
  const response = new PassThrough()
  const failure = new Error("disk read failed")
  const handler = (_request, stream) => {
    queueMicrotask(() => stream.destroy(failure))
  }

  await assert.rejects(serveStaticRequest(handler, {}, response), failure)
})

test("the sirv server survives a browser aborting a large asset", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-sirv-abort-"))
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "index.html"), "<h1>alive</h1>")
  await writeFile(path.join(root, "large.bin"), Buffer.alloc(4 * 1024 * 1024, 120))

  const failures = []
  const staticHandler = sirv(root, { dev: true })
  const server = createServer((request, response) => {
    void serveStaticRequest(staticHandler, request, response).catch((error) => {
      failures.push(error)
    })
  })
  server.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const address = server.address()
  assert.ok(address && typeof address === "object")
  const baseUrl = `http://127.0.0.1:${address.port}`

  const initial = await fetch(`${baseUrl}/`)
  assert.equal(initial.status, 200)
  assert.equal(await initial.text(), "<h1>alive</h1>")

  await new Promise((resolve, reject) => {
    const request = get(`${baseUrl}/large.bin`, (response) => {
      response.once("data", () => {
        response.destroy()
        resolve()
      })
    })
    request.once("error", (error) => {
      if (error.code === "ECONNRESET") resolve()
      else reject(error)
    })
  })
  await new Promise((resolve) => setImmediate(resolve))

  const afterAbort = await fetch(`${baseUrl}/`)
  assert.equal(afterAbort.status, 200)
  assert.equal(failures.length, 0)

  const missing = await fetch(`${baseUrl}/missing`)
  assert.equal(missing.status, 404)
  assert.equal(await missing.text(), "Not found")
})
