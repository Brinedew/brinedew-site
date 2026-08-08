import { SuggestionKind, WorkerLinter } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import type {
  HarperEngine,
  HarperLint,
  HarperSuggestionKind,
} from "./harperEngineContract";

function suggestionKind(kind: SuggestionKind): HarperSuggestionKind {
  if (kind === SuggestionKind.Remove) return "remove";
  if (kind === SuggestionKind.InsertAfter) return "insert-after";
  return "replace";
}

export async function createHarperEngine(): Promise<HarperEngine> {
  const instance = new WorkerLinter({ binary: slimBinaryInlined });
  await instance.getDefaultLintConfig();
  instance.setup();
  return {
    async lint(text: string): Promise<HarperLint[]> {
      const organized = await instance.organizedLints(text);
      return Object.entries(organized).flatMap(([source, lints]) =>
        lints.map((lint) => {
          const span = lint.span();
          return {
            from: span.start,
            to: span.end,
            source,
            message: lint.message(),
            suggestions: lint.suggestions().map((suggestion) => ({
              kind: suggestionKind(suggestion.kind()),
              replacement: suggestion.get_replacement_text(),
            })),
          };
        }),
      );
    },
    dispose(): void {
      instance.dispose();
    },
  };
}
