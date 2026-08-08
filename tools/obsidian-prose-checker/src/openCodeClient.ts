import * as https from "node:https"
import type { IncomingHttpHeaders } from "node:http"
import { buildAgentPrompt, buildJsonRepairPrompt, type AgentPrompt } from "./prompt"
import type { AgentDefinition, AgentFinding, ModelCatalogInfo } from "./types"

// ARCHITECTURE FENCE [BPC-001]: this explicit free Zen route has no paid or Go
// fallback. Model absence is a terminal, user-visible run error.
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1"
export const OPENCODE_FREE_MODEL = "deepseek-v4-flash-free"
export const OPENCODE_REQUEST_TIMEOUT_MS = 240_000
export const OPENCODE_MAX_OUTPUT_TOKENS = 8_192
export const DEFAULT_MODEL_CONTEXT_TOKENS = 1_048_576
const MODEL_CACHE_MS = 15 * 60 * 1_000

export interface HttpResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  content?: string | Array<{ type?: string; text?: string }>
}

interface ModelRecord {
  id?: string
  model?: string
  name?: string
  context_length?: number
  context_window?: number
  limit?: { context?: number }
  limits?: { context?: number }
}

export class OpenCodeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
    readonly transient = false,
  ) {
    super(message)
    this.name = "OpenCodeError"
  }
}

function retryAfterMilliseconds(headers: IncomingHttpHeaders): number | null {
  const raw = headers["retry-after"]
  if (typeof raw !== "string") return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - Date.now())
}

export type OpenCodeTransport = (
  url: URL,
  method: "GET" | "POST",
  apiKey: string,
  body: string | null,
  signal: AbortSignal,
  timeoutMs?: number,
) => Promise<HttpResponse>

function httpRequest(
  url: URL,
  method: "GET" | "POST",
  apiKey: string,
  body: string | null,
  signal: AbortSignal,
  timeoutMs = OPENCODE_REQUEST_TIMEOUT_MS,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new OpenCodeError("Request cancelled.", "cancelled"))
      return
    }
    let settled = false
    const finishReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const finishResolve = (response: HttpResponse): void => {
      if (settled) return
      settled = true
      resolve(response)
    }

    const request = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Brinedew-Prose-Checker/0.1",
          ...(body === null ? {} : { "Content-Length": Buffer.byteLength(body, "utf8") }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let byteCount = 0
        const maxResponseBytes = 16 * 1024 * 1024
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          byteCount += buffer.length
          if (byteCount > maxResponseBytes) {
            request.destroy(
              new OpenCodeError("OpenCode response exceeded 16 MiB.", "response-too-large"),
            )
            return
          }
          chunks.push(buffer)
        })
        response.on("end", () => {
          finishResolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      },
    )

    const timeout = setTimeout(() => {
      request.destroy(
        new OpenCodeError(
          `OpenCode request exceeded ${Math.round(timeoutMs / 1_000)} seconds.`,
          "timeout",
          null,
          null,
          true,
        ),
      )
    }, timeoutMs)

    const onAbort = (): void => {
      request.destroy(new OpenCodeError("Request cancelled.", "cancelled"))
    }
    signal.addEventListener("abort", onAbort, { once: true })

    request.on("error", (error: Error) => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      if (error instanceof OpenCodeError) {
        finishReject(error)
      } else {
        finishReject(
          new OpenCodeError(
            error.message || "OpenCode network request failed.",
            "network",
            null,
            null,
            true,
          ),
        )
      }
    })
    request.on("close", () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
    })
    if (body !== null) request.write(body)
    request.end()
  })
}

function classifyHttpError(response: HttpResponse): OpenCodeError {
  const detail = response.body.slice(0, 1_000).trim()
  if (response.status === 401 || response.status === 403) {
    return new OpenCodeError("OpenCode rejected the API key.", "invalid-key", response.status)
  }
  if (response.status === 402 || response.status === 410) {
    return new OpenCodeError(
      "The free DeepSeek model is no longer available under the current account contract.",
      "free-period-ended",
      response.status,
    )
  }
  if (response.status === 429) {
    return new OpenCodeError(
      "OpenCode rate limited the request.",
      "rate-limited",
      response.status,
      retryAfterMilliseconds(response.headers),
      true,
    )
  }
  if (response.status >= 500) {
    return new OpenCodeError(
      `OpenCode service error ${response.status}${detail ? `: ${detail}` : ""}`,
      "server-error",
      response.status,
      null,
      true,
    )
  }
  return new OpenCodeError(
    `OpenCode request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    "http-error",
    response.status,
  )
}

function parseJson<T>(text: string, code: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new OpenCodeError(
      `OpenCode returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      code,
    )
  }
}

function extractText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content ?? payload.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" || item.type === undefined)
      .map((item) => item.text ?? "")
      .join("\n")
      .trim()
  }
  return ""
}

function isAgentFinding(value: unknown): value is AgentFinding {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.agentId === "string" &&
    typeof item.exactText === "string" &&
    typeof item.prefixContext === "string" &&
    typeof item.suffixContext === "string" &&
    typeof item.occurrenceHint === "number" &&
    Number.isInteger(item.occurrenceHint) &&
    typeof item.explanation === "string" &&
    (typeof item.replacement === "string" || item.replacement === null) &&
    (item.anchorKind === "span" || item.anchorKind === "line")
  )
}

function parseFindingsJson(text: string): AgentFinding[] {
  const parsed = parseJson<unknown>(text, "malformed-agent-json")
  if (typeof parsed !== "object" || parsed === null) {
    throw new OpenCodeError("Agent response must be a JSON object.", "invalid-agent-schema")
  }
  const findings = (parsed as Record<string, unknown>).findings
  if (!Array.isArray(findings) || !findings.every(isAgentFinding)) {
    throw new OpenCodeError(
      "Agent response does not match the findings schema.",
      "invalid-agent-schema",
    )
  }
  return findings
}

function modelContext(record: ModelRecord): number {
  const candidates = [
    record.context_length,
    record.context_window,
    record.limit?.context,
    record.limits?.context,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate)
    }
  }
  return DEFAULT_MODEL_CONTEXT_TOKENS
}

export interface OpenCodeClientOptions {
  baseUrl?: string
  model?: string
  keyProvider?: () => string
  now?: () => number
  transport?: OpenCodeTransport
}

export class OpenCodeClient {
  private readonly baseUrl: string
  private readonly model: string
  private readonly keyProvider: () => string
  private readonly now: () => number
  private readonly transport: OpenCodeTransport
  private catalogCache: ModelCatalogInfo | null = null

  constructor(options: OpenCodeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OPENCODE_ZEN_BASE_URL).replace(/\/$/, "")
    this.model = options.model ?? OPENCODE_FREE_MODEL
    this.keyProvider = options.keyProvider ?? (() => process.env.OPENCODE_API_KEY?.trim() ?? "")
    this.now = options.now ?? Date.now
    this.transport = options.transport ?? httpRequest
  }

  private apiKey(): string {
    const key = this.keyProvider().trim()
    if (!key) throw new OpenCodeError("OPENCODE_API_KEY is missing.", "missing-key")
    return key
  }

  async probeModel(signal: AbortSignal, force = false): Promise<ModelCatalogInfo> {
    if (
      !force &&
      this.catalogCache !== null &&
      this.now() - this.catalogCache.checkedAt < MODEL_CACHE_MS
    ) {
      return this.catalogCache
    }

    let key: string
    try {
      key = this.apiKey()
    } catch (error) {
      if (error instanceof OpenCodeError && error.code === "missing-key") {
        return {
          available: false,
          contextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
          status: "missing-key",
          message: error.message,
          checkedAt: this.now(),
        }
      }
      throw error
    }

    try {
      const response = await this.transport(
        new URL(`${this.baseUrl}/models`),
        "GET",
        key,
        null,
        signal,
        20_000,
      )
      if (response.status < 200 || response.status >= 300) throw classifyHttpError(response)
      const parsed = parseJson<{ data?: ModelRecord[] } | ModelRecord[]>(
        response.body,
        "malformed-model-catalog",
      )
      const records = Array.isArray(parsed) ? parsed : parsed.data
      const record = records?.find(
        (item) =>
          (item.id ?? item.model ?? item.name ?? "").toLowerCase() === this.model.toLowerCase(),
      )
      this.catalogCache = {
        available: record !== undefined,
        contextTokens: record ? modelContext(record) : DEFAULT_MODEL_CONTEXT_TOKENS,
        status: record ? "connected" : "model-unavailable",
        message: record
          ? `${this.model} is available on OpenCode Zen.`
          : `${this.model} is absent from the OpenCode Zen model catalog.`,
        checkedAt: this.now(),
      }
      return this.catalogCache
    } catch (error) {
      const status =
        error instanceof OpenCodeError && error.code === "invalid-key"
          ? "invalid-key"
          : error instanceof OpenCodeError && error.code === "free-period-ended"
            ? "free-period-ended"
            : "network-error"
      this.catalogCache = {
        available: false,
        contextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
        status,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: this.now(),
      }
      return this.catalogCache
    }
  }

  private async completion(prompt: AgentPrompt, signal: AbortSignal): Promise<string> {
    const payload = JSON.stringify({
      model: this.model,
      temperature: 0,
      // DeepSeek V4 defaults to thinking mode. The prose checker needs the
      // bounded 8,192-token budget for the JSON result rather than hidden
      // reasoning that can exhaust the budget and yield empty content.
      reasoning_effort: "none",
      max_tokens: OPENCODE_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    })
    const response = await this.transport(
      new URL(`${this.baseUrl}/chat/completions`),
      "POST",
      this.apiKey(),
      payload,
      signal,
    )
    if (response.status < 200 || response.status >= 300) throw classifyHttpError(response)
    const parsed = parseJson<ChatCompletionResponse>(response.body, "malformed-chat-response")
    const text = extractText(parsed)
    if (!text) throw new OpenCodeError("OpenCode returned an empty completion.", "empty-response")
    return text
  }

  async runAgent(
    definition: AgentDefinition,
    documentText: string,
    documentHash: string,
    signal: AbortSignal,
    contextTokens: number,
  ): Promise<AgentFinding[]> {
    const prompt = buildAgentPrompt(definition, documentText, documentHash)
    const estimatedInputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 3)
    const reserve = OPENCODE_MAX_OUTPUT_TOKENS + 16_384
    if (estimatedInputTokens + reserve > contextTokens) {
      throw new OpenCodeError(
        `Complete prompt is approximately ${estimatedInputTokens.toLocaleString()} tokens; the model limit is ${contextTokens.toLocaleString()} tokens. The document was not sent.`,
        "context-overflow",
      )
    }

    const raw = await this.completion(prompt, signal)
    try {
      return parseFindingsJson(raw)
    } catch (error) {
      if (
        !(error instanceof OpenCodeError) ||
        !["malformed-agent-json", "invalid-agent-schema"].includes(error.code)
      ) {
        throw error
      }
      const repaired = await this.completion(buildJsonRepairPrompt(raw), signal)
      return parseFindingsJson(repaired)
    }
  }
}
