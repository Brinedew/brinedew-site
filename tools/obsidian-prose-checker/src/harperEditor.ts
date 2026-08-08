import type { Diagnostic } from "@codemirror/lint"
import { linter } from "@codemirror/lint"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { HarperEngine, HarperSuggestion } from "./harperEngineContract"

declare const require: (id: string) => unknown

export interface HarperGrammarOptions {
  enabled: () => boolean
  delayMs: () => number
  engineModulePath: string
}

interface HarperEngineModule {
  createHarperEngine(): Promise<HarperEngine>
}

export class HarperGrammarService {
  readonly extension: Extension
  private linterInstance: HarperEngine | null = null
  private initialization: Promise<HarperEngine> | null = null

  constructor(private readonly options: HarperGrammarOptions) {
    // ARCHITECTURE FENCE [BPC-001]: Harper's 20+ MB engine is a separate
    // artifact. Obsidian startup parses only the small plugin shell; the local
    // engine is required after the editor's idle lint delay. Remote analysis is
    // neither imported nor invoked from this path.
    this.extension = linter((view) => this.lint(view), {
      delay: Math.max(250, this.options.delayMs()),
    })
  }

  private async ensureLinter(): Promise<HarperEngine> {
    if (this.linterInstance) return this.linterInstance
    this.initialization ??= Promise.resolve().then(async () => {
      const module = require(this.options.engineModulePath) as HarperEngineModule
      const instance = await module.createHarperEngine()
      this.linterInstance = instance
      return instance
    })
    return this.initialization
  }

  private suggestionAction(
    suggestion: HarperSuggestion,
    editorView: EditorView,
    from: number,
    to: number,
  ): void {
    if (suggestion.kind === "remove") {
      editorView.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      })
      return
    }
    if (suggestion.kind === "insert-after") {
      editorView.dispatch({
        changes: { from: to, to, insert: suggestion.replacement },
        selection: { anchor: to + suggestion.replacement.length },
      })
      return
    }
    editorView.dispatch({
      changes: { from, to, insert: suggestion.replacement },
      selection: { anchor: from + suggestion.replacement.length },
    })
  }

  private async lint(view: EditorView): Promise<readonly Diagnostic[]> {
    if (!this.options.enabled()) return []
    const instance = await this.ensureLinter()
    const lints = await instance.lint(view.state.doc.toString())
    return lints.map((lint) => ({
      from: lint.from,
      to: lint.to,
      severity: "warning" as const,
      source: `Harper · ${lint.source}`,
      message: lint.message,
      actions: lint.suggestions.map((suggestion) => ({
        name:
          suggestion.kind === "remove"
            ? "Remove"
            : suggestion.kind === "insert-after"
              ? `Insert “${suggestion.replacement}”`
              : `Replace with “${suggestion.replacement}”`,
        apply: (editorView: EditorView, from: number, to: number) =>
          this.suggestionAction(suggestion, editorView, from, to),
      })),
    }))
  }

  dispose(): void {
    this.linterInstance?.dispose()
    this.linterInstance = null
    this.initialization = null
  }
}
