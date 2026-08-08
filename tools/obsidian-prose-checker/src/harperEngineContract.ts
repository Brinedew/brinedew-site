export type HarperSuggestionKind = "replace" | "remove" | "insert-after";

export interface HarperSuggestion {
  kind: HarperSuggestionKind;
  replacement: string;
}

export interface HarperLint {
  from: number;
  to: number;
  source: string;
  message: string;
  suggestions: HarperSuggestion[];
}

export interface HarperEngine {
  lint(text: string): Promise<HarperLint[]>;
  dispose(): void;
}
