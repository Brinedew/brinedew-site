import assert from "node:assert/strict"
import test from "node:test"

import {
  buildImageEditProviderOptions,
  createImageEditJobWatcher,
  formatFreeImageEditModelLabel,
  isImageEditJobPendingStatus,
  resolveImageEditAspectRatio,
} from "./image-edit-dialog-live.js"

function createFakeTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    pending,
    setTimeoutFn(fn, ms) {
      const id = nextId++
      pending.set(id, { fn, ms })
      return id
    },
    clearTimeoutFn(id) {
      pending.delete(id)
    },
    async runNext() {
      const first = pending.entries().next()
      if (first.done) return false
      const [id, entry] = first.value
      pending.delete(id)
      entry.fn()
      await Promise.resolve()
      await Promise.resolve()
      return true
    },
  }
}

test("resolveImageEditAspectRatio prefers edited result dimensions and falls back to before/source", () => {
  assert.equal(
    resolveImageEditAspectRatio({
      afterWidth: 1024,
      afterHeight: 1536,
      beforeWidth: 832,
      beforeHeight: 1216,
      sourceWidth: 896,
      sourceHeight: 1152,
    }),
    "1024 / 1536",
  )
  assert.equal(
    resolveImageEditAspectRatio({
      afterWidth: 0,
      afterHeight: 0,
      beforeWidth: 832,
      beforeHeight: 1216,
    }),
    "832 / 1216",
  )
  assert.equal(resolveImageEditAspectRatio({ width: 768, height: 1024 }), "768 / 1024")
  assert.equal(resolveImageEditAspectRatio({ width: 0, height: 0 }), "")
})

test("createImageEditJobWatcher updates the open dialog when a queued free edit finishes", async () => {
  const timers = createFakeTimers()
  let now = 0
  let dialogOpen = true
  const resolved = []
  const fetched = []
  let pollCount = 0

  const watcher = createImageEditJobWatcher({
    fetchJob: async (jobId) => {
      fetched.push(jobId)
      pollCount += 1
      return pollCount === 1
        ? { id: jobId, status: "running" }
        : { id: jobId, status: "succeeded", published: false }
    },
    isDialogOpen: () => dialogOpen,
    onResolved: (job, sessionVersion) => resolved.push({ job, sessionVersion }),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    nowFn: () => now,
    documentObj: { visibilityState: "visible", addEventListener() {} },
    windowObj: { addEventListener() {} },
  })

  watcher.start({ jobId: "request-42", sessionVersion: 3 })
  assert.equal(timers.pending.size, 1)

  now += 4000
  await timers.runNext()
  assert.deepEqual(fetched, ["request-42"])
  assert.equal(resolved.length, 0)
  assert.equal(timers.pending.size, 1)

  now += 4000
  await timers.runNext()
  assert.deepEqual(fetched, ["request-42", "request-42"])
  assert.equal(resolved.length, 1)
  assert.deepEqual(resolved[0], {
    job: { id: "request-42", status: "succeeded", published: false },
    sessionVersion: 3,
  })
  assert.equal(timers.pending.size, 0)
  assert.equal(watcher.getActiveJobId(), "")
  dialogOpen = false
})

test("createImageEditJobWatcher checks immediately when inbox reports matching edit_image ready", async () => {
  const timers = createFakeTimers()
  const resolved = []
  const watcher = createImageEditJobWatcher({
    fetchJob: async (jobId) => ({ id: jobId, status: "succeeded", published: false }),
    isDialogOpen: () => true,
    onResolved: (job, sessionVersion) => resolved.push({ job, sessionVersion }),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    documentObj: { visibilityState: "visible", addEventListener() {} },
    windowObj: { addEventListener() {} },
  })

  watcher.start({ jobId: "request-91", sessionVersion: 7 })
  watcher.notifyReadyJobs([{ request_kind: "edit_image", edit_job_id: "request-999" }])
  await Promise.resolve()
  assert.equal(resolved.length, 0)

  watcher.notifyReadyJobs([{ request_kind: "edit_image", edit_job_id: "request-91" }])
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].sessionVersion, 7)
  assert.equal(timers.pending.size, 0)
})

test("createImageEditJobWatcher stops cleanly on close and ignores in-flight completion", async () => {
  const timers = createFakeTimers()
  let dialogOpen = true
  let finishFetch
  const resolved = []
  const watcher = createImageEditJobWatcher({
    fetchJob: () =>
      new Promise((resolve) => {
        finishFetch = resolve
      }),
    isDialogOpen: () => dialogOpen,
    onResolved: (job) => resolved.push(job),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    documentObj: { visibilityState: "visible", addEventListener() {} },
    windowObj: { addEventListener() {} },
  })

  watcher.start({ jobId: "request-55", sessionVersion: 2 })
  await timers.runNext()
  assert.equal(typeof finishFetch, "function")

  dialogOpen = false
  watcher.stop()
  finishFetch({ id: "request-55", status: "succeeded" })
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(resolved.length, 0)
  assert.equal(timers.pending.size, 0)
})

test("createImageEditJobWatcher pauses when hidden and resumes check on focus or visible", async () => {
  const timers = createFakeTimers()
  const listeners = new Map()
  const doc = {
    visibilityState: "hidden",
    addEventListener(event, fn) {
      listeners.set("doc:" + event, fn)
    },
  }
  const win = {
    addEventListener(event, fn) {
      listeners.set("win:" + event, fn)
    },
  }
  let calls = 0
  const watcher = createImageEditJobWatcher({
    fetchJob: async (id) => {
      calls += 1
      return { id, status: "succeeded" }
    },
    isDialogOpen: () => true,
    onResolved() {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    documentObj: doc,
    windowObj: win,
  })

  watcher.start({ jobId: "request-7", sessionVersion: 1 })
  assert.equal(timers.pending.size, 0, "does not schedule while tab is hidden")

  doc.visibilityState = "visible"
  listeners.get("doc:visibilitychange")()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(isImageEditJobPendingStatus("queued"), true)
  assert.equal(isImageEditJobPendingStatus("succeeded"), false)
})

test("buildImageEditProviderOptions puts free models first and prefixes labels with (Free)", () => {
  assert.equal(
    formatFreeImageEditModelLabel("FLUX.2 Klein 9B KV (Free)"),
    "(Free) FLUX.2 Klein 9B KV",
  )
  assert.equal(formatFreeImageEditModelLabel("(Free) FLUX.3 Klein"), "(Free) FLUX.3 Klein")

  const built = buildImageEditProviderOptions({
    supported: [
      {
        provider_id: "anthropic_alpha",
        label: "AlphaPaid",
        free_queue: false,
        model_options: [{ model: "alpha-1", label: "Alpha Edit" }],
      },
      {
        provider_id: "comfyui",
        label: "Iconoplasm",
        free_queue: true,
        model_options: [
          { model: "qwen", label: "Qwen-Image-2.1 Turbo INT8 (Free)" },
          { model: "flux", label: "(Free) FLUX.2 Klein 4B" },
        ],
      },
      {
        provider_id: "openai",
        label: "OpenAI",
        free_queue: false,
        model_options: [{ model: "gpt-image-1.5", label: "GPT Image 1.5" }],
      },
    ],
    configured: { anthropic_alpha: true, openai: true },
    lastUsed: { provider_id: "openai", model: "gpt-image-1.5" },
  })

  assert.deepEqual(
    built.options.map((o) => [o.value, o.label, o.free]),
    [
      ["comfyui:flux", "(Free) FLUX.2 Klein 4B", true],
      ["comfyui:qwen", "(Free) Qwen-Image-2.1 Turbo INT8", true],
      ["anthropic_alpha:alpha-1", "AlphaPaid · Alpha Edit", false],
      ["openai:gpt-image-1.5", "OpenAI · GPT Image 1.5 · last used", false],
    ],
  )
  assert.equal(built.selectedValue, "openai:gpt-image-1.5")
})
