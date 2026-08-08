export type ProtectedKind =
  | "frontmatter"
  | "fenced-code"
  | "inline-code"
  | "block-math"
  | "inline-math"
  | "html-comment"
  | "block-quote"
  | "url"
  | "citation"
  | "quoted-speech"

export interface ProtectedRange {
  from: number
  to: number
  kinds: ProtectedKind[]
}

interface RawProtectedRange {
  from: number
  to: number
  kind: ProtectedKind
}

function addMatches(
  ranges: RawProtectedRange[],
  text: string,
  regex: RegExp,
  kind: ProtectedKind,
  group = 0,
): void {
  for (const match of text.matchAll(regex)) {
    const selected = match[group]
    if (selected === undefined || match.index === undefined) continue
    const whole = match[0]
    const relative = group === 0 ? 0 : whole.indexOf(selected)
    if (relative < 0) continue
    ranges.push({
      from: match.index + relative,
      to: match.index + relative + selected.length,
      kind,
    })
  }
}

export function findProtectedRanges(text: string): ProtectedRange[] {
  const raw: RawProtectedRange[] = []

  if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
    const end = /^---\s*$/m.exec(text.slice(4))
    if (end?.index !== undefined) {
      const endStart = end.index + 4
      const endLine = text.indexOf("\n", endStart)
      raw.push({
        from: 0,
        to: endLine === -1 ? text.length : endLine + 1,
        kind: "frontmatter",
      })
    }
  }

  addMatches(raw, text, /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\r?\n|$)/g, "fenced-code")
  addMatches(raw, text, /`{1,2}[^`\n]+`{1,2}/g, "inline-code")
  addMatches(raw, text, /\$\$[\s\S]*?\$\$/g, "block-math")
  addMatches(raw, text, /(?<!\$)\$(?!\$)[^\n$]+\$(?!\$)/g, "inline-math")
  addMatches(raw, text, /<!--[\s\S]*?-->/g, "html-comment")
  addMatches(raw, text, /^(?:\s*>[^\n]*(?:\n|$))+/gm, "block-quote")
  addMatches(raw, text, /\]\(([^)\n]+)\)/g, "url", 1)
  addMatches(raw, text, /https?:\/\/[^\s)>\]]+/g, "url")
  addMatches(raw, text, /\[(?:@|\^)[^\]\n]+\]/g, "citation")
  addMatches(raw, text, /“[^”\n]+”/g, "quoted-speech")
  addMatches(raw, text, /(?<![A-Za-z0-9])"[^"\n]+"(?![A-Za-z0-9])/g, "quoted-speech")

  raw.sort((left, right) => left.from - right.from || left.to - right.to)
  const merged: ProtectedRange[] = []
  for (const range of raw) {
    if (range.to <= range.from) continue
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to)
      if (!previous.kinds.includes(range.kind)) previous.kinds.push(range.kind)
    } else {
      merged.push({ from: range.from, to: range.to, kinds: [range.kind] })
    }
  }
  return merged
}

export function intersectsProtectedRange(
  from: number,
  to: number,
  protectedRanges: readonly ProtectedRange[],
): boolean {
  return protectedRanges.some((range) => from < range.to && to > range.from)
}
