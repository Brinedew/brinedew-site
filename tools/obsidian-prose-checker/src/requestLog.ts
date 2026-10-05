import { createId } from "./hash"

// Every remote request the plugin sends is recorded here exactly as it left the
// machine (the credential is the only redaction), so the person using the
// plugin can read the complete prompt and the raw response. Records live in
// memory for this Obsidian session only and are never written to disk.

export type RequestLane = "agent" | "echo"

export interface RequestRecord {
  id: string
  lane: RequestLane
  /** Agent id for the agent lane, persona for the Echo lane. */
  subject: string
  label: string
  method: "GET" | "POST"
  url: string
  /** Header names and values as sent; the credential is shown by its source. */
  headers: Record<string, string>
  /** The request body byte-for-byte as sent. */
  body: string | null
  startedAt: number
  finishedAt: number | null
  status: number | null
  responseBody: string | null
  error: string | null
}

const MAX_RECORDS = 200

export class RequestLog {
  private readonly records: RequestRecord[] = []

  start(
    entry: Omit<
      RequestRecord,
      "id" | "startedAt" | "finishedAt" | "status" | "responseBody" | "error"
    >,
  ): RequestRecord {
    const record: RequestRecord = {
      ...entry,
      id: createId("request"),
      startedAt: Date.now(),
      finishedAt: null,
      status: null,
      responseBody: null,
      error: null,
    }
    this.records.push(record)
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS)
    return record
  }

  finish(record: RequestRecord, status: number | null, responseBody: string | null): void {
    record.finishedAt = Date.now()
    record.status = status
    record.responseBody = responseBody
  }

  fail(record: RequestRecord, error: unknown): void {
    record.finishedAt = Date.now()
    record.error = error instanceof Error ? error.message : String(error)
  }

  forSubject(lane: RequestLane, subject: string, since = 0): RequestRecord[] {
    return this.records.filter(
      (record) => record.lane === lane && record.subject === subject && record.startedAt >= since,
    )
  }
}

/** The headers `httpRequest` sends, with the credential replaced by its source. */
export function describedHeaders(
  credentialSource: string,
  body: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer <${credentialSource}>`,
    "Content-Type": "application/json",
    "User-Agent": "Brinedew-Prose-Checker/0.1",
    ...(body === null ? {} : { "Content-Length": String(Buffer.byteLength(body, "utf8")) }),
    ...extra,
  }
}
