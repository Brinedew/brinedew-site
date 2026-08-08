import { validateAndResolveFindings } from "./anchors"
import { createId, hashDocument } from "./hash"
import { OpenCodeClient, OpenCodeError } from "./openCodeClient"
import type {
  AgentDefinition,
  AgentRunState,
  DocumentRun,
  ModelCatalogInfo,
  ResolvedFinding,
  RunProgressSnapshot,
} from "./types"

interface QueuedTask {
  runId: string
  agentId: string
}

export interface RunCoordinatorCallbacks {
  onRunStarted: (run: DocumentRun) => void
  onAgentCompleted: (
    run: DocumentRun,
    agent: AgentDefinition,
    findings: ResolvedFinding[],
    rejectedAnchors: number,
  ) => Promise<void> | void
  onAgentCleared: (filePath: string, agentId: string) => Promise<void> | void
}

type ProgressListener = (snapshot: RunProgressSnapshot) => void

function sleepWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new OpenCodeError("Request cancelled.", "cancelled"))
      return
    }
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(new OpenCodeError("Request cancelled.", "cancelled"))
      },
      { once: true },
    )
  })
}

function newAgentState(definition: AgentDefinition): AgentRunState {
  return {
    agentId: definition.id,
    label: definition.label,
    status: "queued",
    startedAt: null,
    finishedAt: null,
    findingCount: 0,
    rejectedAnchorCount: 0,
    error: null,
    attempt: 0,
  }
}

export class RunCoordinator {
  private readonly runs = new Map<string, DocumentRun>()
  private readonly runByFile = new Map<string, string>()
  private readonly queue: QueuedTask[] = []
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<ProgressListener>()
  private readonly catalogByRun = new Map<string, ModelCatalogInfo>()
  private activeCount = 0
  private successSinceThrottle = 0
  private configuredConcurrency: number
  private currentConcurrency: number
  private destroyed = false

  constructor(
    private readonly client: OpenCodeClient,
    private readonly definitions: readonly AgentDefinition[],
    private readonly callbacks: RunCoordinatorCallbacks,
    maxConcurrency = 24,
  ) {
    this.configuredConcurrency = Math.max(1, Math.floor(maxConcurrency))
    this.currentConcurrency = this.configuredConcurrency
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  updateMaxConcurrency(value: number): void {
    this.configuredConcurrency = Math.max(1, Math.floor(value))
    this.currentConcurrency = Math.min(this.currentConcurrency, this.configuredConcurrency)
    if (this.activeCount === 0) this.currentConcurrency = this.configuredConcurrency
    this.pump()
  }

  getRunForFile(filePath: string): DocumentRun | null {
    const id = this.runByFile.get(filePath)
    return id ? (this.runs.get(id) ?? null) : null
  }

  getRun(runId: string): DocumentRun | null {
    return this.runs.get(runId) ?? null
  }

  getLatestSnapshot(filePath?: string): RunProgressSnapshot | null {
    const run = filePath
      ? this.getRunForFile(filePath)
      : [...this.runs.values()].sort((left, right) => right.startedAt - left.startedAt)[0]
    return run ? this.snapshot(run) : null
  }

  async startRun(
    filePath: string,
    sourceText: string,
    agentIds?: readonly string[],
  ): Promise<DocumentRun> {
    const existing = this.getRunForFile(filePath)
    if (existing && existing.finishedAt === null && !existing.cancelled) return existing

    const requested = new Set(agentIds ?? this.definitions.map((definition) => definition.id))
    const selected = this.definitions.filter((definition) => requested.has(definition.id))
    if (selected.length === 0) throw new Error("No enabled prose-checker agents were selected.")

    const run: DocumentRun = {
      id: createId("run"),
      filePath,
      sourceText,
      sourceDocumentHash: hashDocument(sourceText),
      startedAt: Date.now(),
      finishedAt: null,
      cancelled: false,
      agents: new Map(selected.map((definition) => [definition.id, newAgentState(definition)])),
    }
    this.runs.set(run.id, run)
    this.runByFile.set(filePath, run.id)
    this.callbacks.onRunStarted(run)
    this.emit(run)

    if (sourceText.trim().length === 0) {
      for (const state of run.agents.values()) {
        state.status = "complete"
        state.finishedAt = Date.now()
      }
      run.finishedAt = Date.now()
      this.emit(run)
      return run
    }

    const probeController = new AbortController()
    this.controllers.set(`${run.id}:catalog`, probeController)
    const catalog = await this.client.probeModel(probeController.signal)
    this.controllers.delete(`${run.id}:catalog`)
    this.catalogByRun.set(run.id, catalog)
    if (!catalog.available) {
      for (const state of run.agents.values()) {
        state.status = "failed"
        state.error = catalog.message
        state.finishedAt = Date.now()
      }
      run.finishedAt = Date.now()
      this.emit(run)
      return run
    }

    for (const definition of selected) this.queue.push({ runId: run.id, agentId: definition.id })
    this.pump()
    return run
  }

  cancelRun(runId: string): void {
    const run = this.runs.get(runId)
    if (!run || run.finishedAt !== null) return
    run.cancelled = true
    for (const state of run.agents.values()) {
      if (state.status === "queued" || state.status === "running") {
        state.status = "cancelled"
        state.finishedAt = Date.now()
        state.error = null
      }
      this.controllers.get(`${run.id}:${state.agentId}`)?.abort()
    }
    this.controllers.get(`${run.id}:catalog`)?.abort()
    run.finishedAt = Date.now()
    this.emit(run)
  }

  cancelAgent(runId: string, agentId: string): void {
    const run = this.runs.get(runId)
    const state = run?.agents.get(agentId)
    if (!run || !state || !["queued", "running"].includes(state.status)) return
    state.status = "cancelled"
    state.finishedAt = Date.now()
    this.controllers.get(`${runId}:${agentId}`)?.abort()
    void this.callbacks.onAgentCleared(run.filePath, agentId)
    this.finishIfDone(run)
    this.emit(run)
  }

  retryAgent(runId: string, agentId: string): void {
    const run = this.runs.get(runId)
    const state = run?.agents.get(agentId)
    if (!run || !state || !["failed", "cancelled"].includes(state.status)) return
    const catalog = this.catalogByRun.get(runId)
    if (!catalog?.available) return
    state.status = "queued"
    state.startedAt = null
    state.finishedAt = null
    state.error = null
    state.findingCount = 0
    state.rejectedAnchorCount = 0
    state.attempt = 0
    run.finishedAt = null
    run.cancelled = false
    this.queue.push({ runId, agentId })
    this.emit(run)
    this.pump()
  }

  retryFailed(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    for (const state of run.agents.values()) {
      if (state.status === "failed") this.retryAgent(runId, state.agentId)
    }
  }

  renameFile(oldPath: string, newPath: string): void {
    const runId = this.runByFile.get(oldPath)
    if (!runId) return
    const run = this.runs.get(runId)
    if (!run) return
    this.runByFile.delete(oldPath)
    this.runByFile.set(newPath, runId)
    run.filePath = newPath
    this.emit(run)
  }

  deleteFile(filePath: string): void {
    const run = this.getRunForFile(filePath)
    if (run) this.cancelRun(run.id)
    this.runByFile.delete(filePath)
  }

  destroy(): void {
    this.destroyed = true
    for (const run of this.runs.values()) this.cancelRun(run.id)
    this.queue.splice(0)
    this.listeners.clear()
  }

  private pump(): void {
    if (this.destroyed) return
    while (this.activeCount < this.currentConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) break
      const run = this.runs.get(task.runId)
      const state = run?.agents.get(task.agentId)
      if (!run || !state || state.status !== "queued" || run.cancelled) continue
      this.activeCount += 1
      void this.executeTask(run, state).finally(() => {
        this.activeCount -= 1
        this.finishIfDone(run)
        this.emit(run)
        this.pump()
      })
    }
  }

  private async executeTask(run: DocumentRun, state: AgentRunState): Promise<void> {
    const definition = this.definitions.find((item) => item.id === state.agentId)
    const catalog = this.catalogByRun.get(run.id)
    if (!definition || !catalog) {
      state.status = "failed"
      state.error = "Agent or model catalog state is missing."
      state.finishedAt = Date.now()
      return
    }

    const controller = new AbortController()
    this.controllers.set(`${run.id}:${definition.id}`, controller)
    state.status = "running"
    state.startedAt ??= Date.now()
    state.attempt += 1
    this.emit(run)

    try {
      const rawFindings = await this.client.runAgent(
        definition,
        run.sourceText,
        run.sourceDocumentHash,
        controller.signal,
        catalog.contextTokens,
      )
      const validated = validateAndResolveFindings(
        rawFindings,
        definition.id,
        run.filePath,
        run.sourceText,
        run.sourceDocumentHash,
      )
      state.status = "complete"
      state.finishedAt = Date.now()
      state.findingCount = validated.valid.length
      state.rejectedAnchorCount = validated.rejected
      state.error = null
      await this.callbacks.onAgentCompleted(run, definition, validated.valid, validated.rejected)
      this.successSinceThrottle += 1
      if (this.currentConcurrency < this.configuredConcurrency && this.successSinceThrottle >= 12) {
        this.currentConcurrency += 1
        this.successSinceThrottle = 0
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof OpenCodeError && error.code === "cancelled")
      ) {
        state.status = "cancelled"
        state.finishedAt = Date.now()
        state.error = null
        return
      }
      if (error instanceof OpenCodeError && error.transient && state.attempt < 2) {
        if (error.code === "rate-limited") {
          this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2))
          this.successSinceThrottle = 0
        }
        const retryDelay = Math.min(60_000, Math.max(1_000, error.retryAfterMs ?? 1_000))
        try {
          await sleepWithAbort(retryDelay, controller.signal)
        } catch {
          state.status = "cancelled"
          state.finishedAt = Date.now()
          return
        }
        state.status = "queued"
        state.error = error.message
        this.queue.push({ runId: run.id, agentId: definition.id })
        return
      }
      state.status = "failed"
      state.finishedAt = Date.now()
      state.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.controllers.delete(`${run.id}:${definition.id}`)
    }
  }

  private finishIfDone(run: DocumentRun): void {
    if (run.finishedAt !== null) return
    const pending = [...run.agents.values()].some(
      (state) => state.status === "queued" || state.status === "running",
    )
    if (!pending) run.finishedAt = Date.now()
  }

  private snapshot(run: DocumentRun): RunProgressSnapshot {
    const agents = [...run.agents.values()].map((state) => ({ ...state }))
    return {
      runId: run.id,
      filePath: run.filePath,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      cancelled: run.cancelled,
      total: agents.length,
      queued: agents.filter((state) => state.status === "queued").length,
      running: agents.filter((state) => state.status === "running").length,
      complete: agents.filter((state) => state.status === "complete").length,
      failed: agents.filter((state) => state.status === "failed").length,
      cancelledAgents: agents.filter((state) => state.status === "cancelled").length,
      findings: agents.reduce((sum, state) => sum + state.findingCount, 0),
      agents,
    }
  }

  private emit(run: DocumentRun): void {
    const snapshot = this.snapshot(run)
    for (const listener of this.listeners) listener(snapshot)
  }
}
