import { httpRequest, type HttpResponse, type OpenCodeTransport } from "./openCodeClient"
import { describedHeaders, type RequestLog, type RequestRecord } from "./requestLog"

// Echo by Fulcrum writes in a named writer's voice. API reference:
// https://echo.fulcrum.inc/dev/ (read 2026-10-05). Every request needs a
// `persona`; Echo then applies its own server-side system prompt and puts the
// writer's name at the top of each user message. The plugin adds nothing else:
// the body below is built only from the person's settings and their text, and
// the request inspector shows it byte-for-byte.
export const ECHO_BASE_URL = "https://echo.fulcrum.inc/api/v1"
export const ECHO_MODEL = "echo"
export const ECHO_REQUEST_TIMEOUT_MS = 900_000
export const ECHO_TEXT_PLACEHOLDER = "{{text}}"
export const DEFAULT_ECHO_PERSONA = "Scott Alexander"
export const DEFAULT_ECHO_REASONING_EFFORT: EchoReasoningEffort = "low"
// One request per review level. Echo's prompting tips: paste the draft and
// say what you want. The questions are the owner's own level definitions; the
// item format is what lets each note sit on its passage in the editor.
const REVIEW_FORMAT = `For each problem, quote the passage from my draft exactly, then comment on it, then suggest a replacement for the whole quoted passage:

> exact quote from the draft
Comment: what's wrong and why
Suggestion: the replacement text`

function reviewTemplate(question: string): string {
  return `Here is my draft:

<draft>
${ECHO_TEXT_PLACEHOLDER}
</draft>

${question}

${REVIEW_FORMAT}`
}

export const DEFAULT_ECHO_TEMPLATES = {
  macro: reviewTemplate("What are the biggest problems at the macro level, between paragraphs?"),
  meso: reviewTemplate("What are the biggest problems at the meso level, between sentences?"),
  micro: reviewTemplate("What are the biggest problems at the micro level, inside sentences?"),
} as const

export const ECHO_REASONING_EFFORTS = ["low", "medium", "high", "max"] as const
export type EchoReasoningEffort = (typeof ECHO_REASONING_EFFORTS)[number]

export interface EchoRequestOptions {
  persona: string
  template: string
  reasoningEffort: EchoReasoningEffort
}

export interface EchoResult {
  text: string
  reasoning: string | null
  promptTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
}

export class EchoError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = "EchoError"
  }
}

/** Returns the exact request body that `rewrite` sends, or a reason it cannot be built. */
export function buildEchoBody(options: EchoRequestOptions, text: string): string {
  const persona = options.persona.trim()
  if (!persona) throw new EchoError("Set a writer in the Echo settings first.", "missing-persona")
  if (!options.template.includes(ECHO_TEXT_PLACEHOLDER)) {
    throw new EchoError(
      `The Echo request template must contain ${ECHO_TEXT_PLACEHOLDER} where your text goes.`,
      "missing-placeholder",
    )
  }
  return JSON.stringify(
    {
      model: ECHO_MODEL,
      persona,
      reasoning_effort: options.reasoningEffort,
      messages: [
        {
          role: "user",
          content: options.template.split(ECHO_TEXT_PLACEHOLDER).join(text),
        },
      ],
    },
    null,
    2,
  )
}

interface EchoChatResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string }
}

function describeFailure(response: HttpResponse): string {
  let detail = response.body.slice(0, 1_000).trim()
  try {
    const parsed = JSON.parse(response.body) as EchoChatResponse
    detail = parsed.error?.message ?? detail
  } catch {
    // Keep the raw body excerpt.
  }
  if (response.status === 401) return "Echo rejected the API key (HTTP 401)."
  return `Echo request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`
}

export interface EchoClientOptions {
  keyProvider?: () => string
  transport?: OpenCodeTransport
  log?: RequestLog
}

export class EchoClient {
  private readonly keyProvider: () => string
  private readonly transport: OpenCodeTransport
  private readonly log: RequestLog | null

  constructor(options: EchoClientOptions = {}) {
    this.keyProvider = options.keyProvider ?? (() => process.env.ECHO_API_KEY?.trim() ?? "")
    this.transport = options.transport ?? httpRequest
    this.log = options.log ?? null
  }

  private apiKey(): string {
    const key = this.keyProvider().trim()
    if (!key) {
      throw new EchoError(
        "ECHO_API_KEY is missing from the Windows user environment. Restart Obsidian after setting it.",
        "missing-key",
      )
    }
    return key
  }

  async checkConnection(signal: AbortSignal): Promise<string> {
    const response = await this.transport(
      new URL(`${ECHO_BASE_URL}/models`),
      "GET",
      this.apiKey(),
      null,
      signal,
      20_000,
    )
    if (response.status < 200 || response.status >= 300) throw new Error(describeFailure(response))
    return "Echo is reachable and accepted the API key."
  }

  /** Sends `body` unchanged. The returned record holds the exact request and raw response. */
  async rewrite(
    body: string,
    persona: string,
    signal: AbortSignal,
    onRecord: (record: RequestRecord) => void = () => {},
  ): Promise<EchoResult> {
    const key = this.apiKey()
    const url = new URL(`${ECHO_BASE_URL}/chat/completions`)
    const record = this.log?.start({
      lane: "echo",
      subject: persona,
      label: `Echo · ${persona}`,
      method: "POST",
      url: url.toString(),
      headers: describedHeaders("ECHO_API_KEY", body),
      body,
    })
    if (record) onRecord(record)
    let response: HttpResponse
    try {
      response = await this.transport(url, "POST", key, body, signal, ECHO_REQUEST_TIMEOUT_MS)
    } catch (error) {
      if (record) this.log?.fail(record, error)
      throw error
    }
    if (record) this.log?.finish(record, response.status, response.body)
    if (response.status < 200 || response.status >= 300) {
      throw new EchoError(describeFailure(response), "http-error")
    }
    let parsed: EchoChatResponse
    try {
      parsed = JSON.parse(response.body) as EchoChatResponse
    } catch {
      throw new EchoError("Echo returned a response that is not JSON.", "malformed-response")
    }
    const message = parsed.choices?.[0]?.message
    const text = (message?.content ?? "").trim()
    if (!text) throw new EchoError("Echo returned an empty reply.", "empty-response")
    return {
      text,
      reasoning: message?.reasoning_content?.trim() || null,
      promptTokens: parsed.usage?.prompt_tokens ?? null,
      completionTokens: parsed.usage?.completion_tokens ?? null,
      reasoningTokens: parsed.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    }
  }
}
