import { createHash } from "node:crypto"
import type { ResolvedFinding } from "./types"

// Scott's review comes back as plain text items:
//   > exact quote from the draft
//   Comment: what's wrong and why
//   Suggestion: the replacement text
// Each item becomes one independent highlight in the note, at the level the
// request asked about. Nothing is generated here: the comment and suggestion
// are Echo's words; the plugin only finds where the quote sits.

export const ECHO_LEVELS = ["macro", "meso", "micro"] as const
export type EchoLevel = (typeof ECHO_LEVELS)[number]
export const ECHO_LEVEL_PREFIX = "echo-"

export function echoAgentId(level: EchoLevel): string {
  return `${ECHO_LEVEL_PREFIX}${level}`
}

export function echoLevelOf(agentId: string): EchoLevel | null {
  if (!agentId.startsWith(ECHO_LEVEL_PREFIX)) return null
  const level = agentId.slice(ECHO_LEVEL_PREFIX.length)
  return (ECHO_LEVELS as readonly string[]).includes(level) ? (level as EchoLevel) : null
}

export interface ReviewItem {
  quote: string
  comment: string
  suggestion: string | null
}

function unwrapQuoted(text: string): string {
  let value = text.trim()
  // Echo writes quotes and multi-line suggestions as Markdown block quotes.
  if (/^>/.test(value)) {
    value = value
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n")
      .trim()
  }
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
  ]
  for (const [open, close] of pairs) {
    if (value.length > 1 && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, -close.length).trim()
    }
  }
  return value
}

// Labels as Echo writes them: "Comment:", "**Comment:**", "**Comment**:".
const COMMENT_LABEL = /^\s*\*{0,2}Comment\*{0,2}\s*:\s*\*{0,2}\s*/i
const SUGGESTION_LABEL = /^\s*\*{0,2}Suggestion\*{0,2}\s*:\s*\*{0,2}\s*/i

const isQuoteLine = (line: string): boolean => /^\s*>/.test(line)

export function parseReview(text: string): ReviewItem[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const items: ReviewItem[] = []
  let floor = 0
  for (let commentIndex = 0; commentIndex < lines.length; commentIndex += 1) {
    if (!COMMENT_LABEL.test(lines[commentIndex] ?? "")) continue
    // The quote is the block of ">" lines just above the comment; a truly blank
    // line ends it, so the previous item's suggestion is never swallowed.
    let index = commentIndex - 1
    while (index >= floor && (lines[index] ?? "").trim() === "") index -= 1
    let quoteStart = index + 1
    while (index >= floor && isQuoteLine(lines[index] ?? "")) {
      quoteStart = index
      index -= 1
    }
    const quote = unwrapQuoted(lines.slice(quoteStart, commentIndex).join("\n"))

    // Comment runs to the suggestion label; the suggestion runs to the next quote block.
    let suggestionIndex = -1
    let next = lines.length
    for (let cursor = commentIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? ""
      if (COMMENT_LABEL.test(line)) {
        // Back up over the next item's quote block and any heading above it.
        next = cursor
        let back = cursor - 1
        while (back > commentIndex && (lines[back] ?? "").trim() === "") back -= 1
        while (back > commentIndex && isQuoteLine(lines[back] ?? "")) back -= 1
        while (
          back > commentIndex &&
          !isQuoteLine(lines[back] ?? "") &&
          (lines[back] ?? "").trim() !== "" &&
          !SUGGESTION_LABEL.test(lines[back] ?? "")
        )
          back -= 1
        next = Math.max(back + 1, suggestionIndex + 1)
        break
      }
      if (suggestionIndex < 0 && SUGGESTION_LABEL.test(line)) suggestionIndex = cursor
    }
    const commentEnd = suggestionIndex >= 0 ? suggestionIndex : next
    const comment = [
      (lines[commentIndex] ?? "").replace(COMMENT_LABEL, ""),
      ...lines.slice(commentIndex + 1, commentEnd),
    ]
      .join("\n")
      .trim()
    let suggestion: string | null = null
    if (suggestionIndex >= 0) {
      suggestion = unwrapQuoted(
        [
          (lines[suggestionIndex] ?? "").replace(SUGGESTION_LABEL, ""),
          ...lines.slice(suggestionIndex + 1, Math.max(next, suggestionIndex + 1)),
        ].join("\n"),
      )
    }
    if (quote && comment) items.push({ quote, comment, suggestion: suggestion || null })
    floor = Math.max(commentIndex + 1, next)
    commentIndex = Math.max(commentIndex, next - 1)
  }
  return items
}

/** Text with Markdown emphasis, quote styles and whitespace runs folded, plus a map back to source offsets. */
function normalizeWithMap(text: string): { value: string; map: number[] } {
  let value = ""
  const map: number[] = []
  let lastWasSpace = false
  for (let index = 0; index < text.length; index += 1) {
    let char = text[index] ?? ""
    if (char === "*" || char === "_" || char === "`") continue
    if (/\s/.test(char) || char === ">") {
      if (lastWasSpace || value.length === 0) continue
      char = " "
      lastWasSpace = true
    } else {
      lastWasSpace = false
      if ("“”„".includes(char)) char = '"'
      if ("‘’".includes(char)) char = "'"
      if ("—–".includes(char)) char = "-"
    }
    value += char
    map.push(index)
  }
  return { value, map }
}

/** Finds the quote in the document, tolerating emphasis markers, quote styles and line breaks. */
export function locateQuote(
  documentText: string,
  quote: string,
): { from: number; to: number } | null {
  const exact = documentText.indexOf(quote)
  if (exact >= 0 && documentText.indexOf(quote, exact + 1) < 0) {
    return { from: exact, to: exact + quote.length }
  }
  const doc = normalizeWithMap(documentText)
  const needle = normalizeWithMap(quote).value.trim()
  if (needle.length < 4) return null
  const at = doc.value.indexOf(needle)
  if (at < 0 || doc.value.indexOf(needle, at + 1) >= 0) return null
  const from = doc.map[at] ?? 0
  const lastSource = doc.map[at + needle.length - 1] ?? from
  let to = lastSource + 1
  // Keep closing emphasis markers that belong to the quoted span.
  while (to < documentText.length && /[*_`]/.test(documentText[to] ?? "")) to += 1
  return { from, to }
}

export function reviewFindings(options: {
  items: readonly ReviewItem[]
  level: EchoLevel
  documentText: string
  documentHash: string
  filePath: string
  persona: string
}): { findings: ResolvedFinding[]; unplaced: ReviewItem[] } {
  const { items, level, documentText, documentHash, filePath, persona } = options
  const findings: ResolvedFinding[] = []
  const unplaced: ReviewItem[] = []
  for (const item of items) {
    const anchor = locateQuote(documentText, item.quote)
    if (!anchor) {
      unplaced.push(item)
      continue
    }
    const exactText = documentText.slice(anchor.from, anchor.to)
    findings.push({
      agentId: echoAgentId(level),
      exactText,
      prefixContext: documentText.slice(Math.max(0, anchor.from - 80), anchor.from),
      suffixContext: documentText.slice(anchor.to, anchor.to + 80),
      occurrenceHint: 0,
      explanation: item.comment,
      replacement: item.suggestion,
      anchorKind: "span",
      id: createHash("sha256")
        .update([level, persona, String(anchor.from), exactText, item.comment].join("\u0000"))
        .digest("hex")
        .slice(0, 24),
      filePath,
      agentLabel: `${persona} · ${level}`,
      agentDefinition: "",
      from: anchor.from,
      to: anchor.to,
      sourceDocumentHash: documentHash,
      agentVersion: 1,
      visualState: "fresh",
      canApply: item.suggestion !== null,
    })
  }
  return { findings, unplaced }
}
