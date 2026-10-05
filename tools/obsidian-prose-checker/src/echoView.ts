import { ItemView, WorkspaceLeaf, setIcon } from "obsidian"
import type { EchoResult } from "./echoClient"
import type { EchoLevel, ReviewItem } from "./echoReview"
import type { RequestRecord } from "./requestLog"
import { renderRequestRecord } from "./requestInspector"

export const ECHO_VIEW_TYPE = "brinedew-prose-checker-echo"

export type EchoScope = "selection" | "note"

/** One request to Echo: one level of the review. */
export interface EchoCall {
  level: EchoLevel
  body: string
  record: RequestRecord | null
  status: "running" | "done" | "failed" | "cancelled"
  startedAt: number
  finishedAt: number | null
  result: EchoResult | null
  /** How many of Scott's notes were placed in the text. */
  placed: number
  /** Notes whose quote could not be found in the text. */
  unplaced: ReviewItem[]
  error: string | null
}

export interface EchoSession {
  id: string
  filePath: string
  persona: string
  scope: EchoScope
  sourceText: string
  startedAt: number
  calls: EchoCall[]
}

export interface EchoViewHost {
  current: () => EchoSession | null
  cancel: () => void
  retry: (session: EchoSession) => void
  rejectAll: () => void
}

function seconds(start: number, finish: number | null): string {
  const value = Math.max(0, Math.round(((finish ?? Date.now()) - start) / 1_000))
  return value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${value % 60}s`
}

/** The request body's fields with the message text unescaped, for reading. */
function readableMessage(body: string): string {
  const parsed = JSON.parse(body) as {
    persona: string
    reasoning_effort: string
    messages: Array<{ role: string; content: string }>
  }
  return [
    `persona: ${parsed.persona}`,
    `reasoning_effort: ${parsed.reasoning_effort}`,
    ...parsed.messages.map((entry) => `\n${entry.role}:\n${entry.content}`),
  ].join("\n")
}

export class EchoView extends ItemView {
  private timer: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: EchoViewHost,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return ECHO_VIEW_TYPE
  }

  getDisplayText(): string {
    return "Echo"
  }

  getIcon(): string {
    return "feather"
  }

  async onOpen(): Promise<void> {
    this.timer = window.setInterval(() => {
      if (this.host.current()?.calls.some((call) => call.status === "running")) this.render()
    }, 1_000)
    this.render()
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  render(): void {
    const container = this.contentEl
    container.empty()
    container.addClass("bpc-progress-view", "bpc-echo-view")
    const session = this.host.current()
    if (!session) {
      container.createDiv({ cls: "bpc-progress-empty", text: "No Echo review in this session." })
      return
    }
    const running = session.calls.some((call) => call.status === "running")

    const header = container.createDiv({ cls: "bpc-progress-header" })
    setIcon(header.createSpan({ cls: "bpc-progress-icon" }), "feather")
    const heading = header.createDiv()
    heading.createEl("h3", { text: `Echo · ${session.persona}` })
    heading.createDiv({
      cls: "bpc-progress-summary",
      text: `${session.filePath} · ${session.scope} · ${session.calls.reduce((sum, call) => sum + call.placed, 0)} notes in the text`,
    })

    const controls = container.createDiv({ cls: "bpc-progress-controls" })
    if (running) {
      const cancel = controls.createEl("button", { text: "Cancel" })
      cancel.addEventListener("click", () => this.host.cancel())
    } else {
      const retry = controls.createEl("button", { text: "Try again" })
      retry.addEventListener("click", () => this.host.retry(session))
    }
    const rejectAll = controls.createEl("button", { text: "Reject all" })
    rejectAll.addEventListener("click", () => this.host.rejectAll())

    container.createDiv({
      cls: "bpc-progress-summary",
      text: "Echo's API reference says that, given a persona, it “applies its own system prompt and puts the writer’s name at the top of each user message”; that server-side text is not visible here. Everything this plugin sent is below.",
    })

    for (const call of session.calls) {
      const section = container.createDiv({ cls: `bpc-echo-call is-${call.status}` })
      const title = section.createDiv({ cls: "bpc-progress-row" })
      const status = title.createSpan({ cls: "bpc-progress-status" })
      setIcon(
        status,
        call.status === "done"
          ? "check"
          : call.status === "failed"
            ? "circle-x"
            : call.status === "running"
              ? "loader-circle"
              : "ban",
      )
      const details = title.createDiv({ cls: "bpc-progress-details" })
      details.createDiv({
        cls: `bpc-progress-agent bpc-echo-level-${call.level}`,
        text: call.level,
      })
      const usage = call.result
        ? ` · ${call.result.completionTokens?.toLocaleString() ?? "?"} output tokens (${call.result.reasoningTokens?.toLocaleString() ?? "?"} reasoning) · Echo counted ${call.result.promptTokens?.toLocaleString() ?? "?"} input tokens`
        : ""
      details.createDiv({
        cls: "bpc-progress-meta",
        text: `${call.status} · ${seconds(call.startedAt, call.finishedAt)} · ${call.placed} notes placed${call.unplaced.length ? ` · ${call.unplaced.length} not found in the text` : ""}${usage}`,
      })
      if (call.error) details.createDiv({ cls: "bpc-progress-error", text: call.error })

      for (const item of call.unplaced) {
        const note = section.createDiv({ cls: "bpc-echo-unplaced" })
        note.createEl("blockquote", { text: item.quote })
        note.createDiv({ text: item.comment })
        if (item.suggestion)
          note.createEl("pre", { cls: "bpc-request-body", text: item.suggestion })
      }

      const message = section.createEl("details", { cls: "bpc-request" })
      message.createEl("summary", { text: "Message as Echo reads it" })
      message.createEl("pre", { cls: "bpc-request-body", text: readableMessage(call.body) })
      if (call.record) renderRequestRecord(section, call.record)
      if (call.result) {
        const reply = section.createEl("details", { cls: "bpc-request" })
        reply.createEl("summary", { text: "Echo's full reply" })
        reply.createEl("pre", { cls: "bpc-request-body", text: call.result.text })
      }
      if (call.result?.reasoning) {
        const reasoning = section.createEl("details", { cls: "bpc-request" })
        reasoning.createEl("summary", { text: "Echo's reasoning" })
        reasoning.createEl("pre", { cls: "bpc-request-body", text: call.result.reasoning })
      }
    }
  }
}
