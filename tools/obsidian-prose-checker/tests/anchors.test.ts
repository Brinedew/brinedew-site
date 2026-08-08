import { describe, expect, test } from "vitest"
import { resolveAnchor, validateAndResolveFindings } from "../src/anchors"
import { hashDocument } from "../src/hash"
import { findProtectedRanges } from "../src/protectedRanges"
import type { AgentFinding } from "../src/types"

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    agentId: "staccato-exposition",
    exactText: "Two alleles exist. One mutates. The other works.",
    prefixContext: "",
    suffixContext: " Growth stays restrained.",
    occurrenceHint: 0,
    explanation: "The causal joint is left implicit.",
    replacement: "One allele mutates, but the other still works.",
    anchorKind: "span",
    ...overrides,
  }
}

describe("protected Markdown and anchor validation", () => {
  test("protects frontmatter, code, math, quotations, citations, and URLs", () => {
    const text = `---
title: Test
---
> A quoted claim.

\`inline code\` and $x = y$ and [source](https://example.com) [@smith2024].

“Quoted speech remains verbatim.”

\`\`\`ts
const x = 1;
\`\`\`
`
    const kinds = new Set(findProtectedRanges(text).flatMap((range) => range.kinds))
    expect(kinds).toEqual(
      new Set([
        "frontmatter",
        "block-quote",
        "inline-code",
        "inline-math",
        "url",
        "citation",
        "quoted-speech",
        "fenced-code",
      ]),
    )
  })

  test("resolves a unique exact anchor with adjacent context", () => {
    const text = "Two alleles exist. One mutates. The other works. Growth stays restrained."
    expect(resolveAnchor(text, finding())).toEqual({ from: 0, to: 48 })
  })

  test("canonicalizes model context after resolving a unique exact quotation", () => {
    const text = "Before. Two alleles exist. One mutates. The other works. After."
    const result = validateAndResolveFindings(
      [finding({ prefixContext: "wrong", suffixContext: "wrong" })],
      "staccato-exposition",
      "note.md",
      text,
      hashDocument(text),
    )
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]?.prefixContext).toBe("Before. ")
    expect(result.valid[0]?.suffixContext).toBe(" After.")
  })

  test("uses the zero-based occurrence hint only when that occurrence has matching context", () => {
    const text = "A repeat here / B repeat here"
    expect(
      resolveAnchor(
        text,
        finding({
          exactText: "repeat",
          prefixContext: "B ",
          suffixContext: " here",
          occurrenceHint: 1,
        }),
      ),
    ).toEqual({ from: 18, to: 24 })
  })

  test("rejects an invented quotation and protected quotation", () => {
    expect(resolveAnchor("The real text.", finding({ exactText: "Invented text" }))).toBeNull()
    expect(
      resolveAnchor(
        "> Two alleles exist. One mutates. The other works.\n",
        finding({ suffixContext: "" }),
      ),
    ).toBeNull()
  })

  test("allows only an agent that explicitly targets citation prose to anchor its citation", () => {
    const text = "Smith et al. reported more repair.[@smith2024]"
    expect(
      resolveAnchor(
        text,
        finding({
          agentId: "citation-shaped-prose",
          exactText: text,
          suffixContext: "",
        }),
      ),
    ).toEqual({ from: 0, to: text.length })
    expect(resolveAnchor(text, finding({ exactText: text, suffixContext: "" }))).toBeNull()
  })

  test("rejects a finding attributed to another agent", () => {
    const text = "Two alleles exist. One mutates. The other works. Growth stays restrained."
    const result = validateAndResolveFindings(
      [finding({ agentId: "unfinished-causal-chain" })],
      "staccato-exposition",
      "note.md",
      text,
      hashDocument(text),
    )
    expect(result.valid).toHaveLength(0)
    expect(result.rejected).toBe(1)
  })
})
