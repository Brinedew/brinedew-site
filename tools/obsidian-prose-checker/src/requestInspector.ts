import { App, Modal, Notice } from "obsidian"
import type { RequestRecord } from "./requestLog"

function prettyResponse(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** Renders one request exactly as sent, followed by the raw response. */
export function renderRequestRecord(container: HTMLElement, record: RequestRecord): void {
  const sent = container.createEl("details", { cls: "bpc-request" })
  sent.open = record.finishedAt === null
  const bytes = record.body === null ? 0 : Buffer.byteLength(record.body, "utf8")
  sent.createEl("summary", {
    text: `Request sent · ${record.method} · ${bytes.toLocaleString()} bytes`,
  })
  const wire = [
    `${record.method} ${record.url}`,
    ...Object.entries(record.headers).map(([name, value]) => `${name}: ${value}`),
    "",
    record.body ?? "",
  ].join("\n")
  const copy = sent.createEl("button", { cls: "bpc-request-copy", text: "Copy" })
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(record.body ?? "")
    new Notice("Request body copied.")
  })
  sent.createEl("pre", { cls: "bpc-request-body", text: wire })

  if (record.responseBody !== null) {
    const received = container.createEl("details", { cls: "bpc-request" })
    received.createEl("summary", { text: `Raw response · HTTP ${record.status ?? "—"}` })
    received.createEl("pre", { cls: "bpc-request-body", text: prettyResponse(record.responseBody) })
  } else if (record.error) {
    container.createDiv({ cls: "bpc-progress-error", text: record.error })
  }
}

export class RequestInspectorModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly records: readonly RequestRecord[],
  ) {
    super(app)
  }

  onOpen(): void {
    this.modalEl.addClass("bpc-request-modal")
    this.titleEl.setText(this.heading)
    if (this.records.length === 0) {
      this.contentEl.createEl("p", { text: "No request has been sent for this agent yet." })
      return
    }
    for (const record of this.records) {
      const section = this.contentEl.createDiv({ cls: "bpc-request-section" })
      section.createEl("h4", {
        text: `${record.label} · ${new Date(record.startedAt).toLocaleTimeString()}`,
      })
      renderRequestRecord(section, record)
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
