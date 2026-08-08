import { StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { ResolvedFinding } from "./types";

interface ReplaceAgentPayload {
  agentId: string;
  findings: ResolvedFinding[];
}

const setAllFindingsEffect = StateEffect.define<ResolvedFinding[]>();
const replaceAgentFindingsEffect = StateEffect.define<ReplaceAgentPayload>();
const removeFindingEffect = StateEffect.define<string>();
const removeAgentEffect = StateEffect.define<string>();
const markAllStaleEffect = StateEffect.define<null>();
const upsertFindingEffect = StateEffect.define<ResolvedFinding>();

function filePathForView(view: EditorView): string | null {
  const info = view.state.field(editorInfoField, false);
  return info?.file?.path ?? null;
}

function rangeTouched(transaction: Transaction, finding: ResolvedFinding): boolean {
  if (!transaction.docChanged) return false;
  return Boolean(transaction.changes.touchesRange(finding.from, finding.to));
}

function mapFinding(transaction: Transaction, finding: ResolvedFinding): ResolvedFinding | null {
  if (rangeTouched(transaction, finding)) return null;
  const from = transaction.changes.mapPos(finding.from, 1);
  const to = transaction.changes.mapPos(finding.to, -1);
  if (from > to || to > transaction.newDoc.length) return null;
  return { ...finding, from, to };
}

function deduplicate(findings: readonly ResolvedFinding[]): ResolvedFinding[] {
  const byId = new Map<string, ResolvedFinding>();
  for (const finding of findings) byId.set(finding.id, finding);
  return [...byId.values()].sort(
    (left, right) => left.from - right.from || left.to - right.to || left.agentLabel.localeCompare(right.agentLabel),
  );
}

class RemoteLineMarkerWidget extends WidgetType {
  constructor(
    private readonly findingId: string,
    private readonly visualState: ResolvedFinding["visualState"],
  ) {
    super();
  }

  eq(other: RemoteLineMarkerWidget): boolean {
    return other.findingId === this.findingId && other.visualState === this.visualState;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = `bpc-line-marker bpc-${this.visualState}`;
    marker.setAttribute("aria-label", "Prose checker finding");
    marker.textContent = "◆";
    return marker;
  }
}

function buildDecorations(findings: readonly ResolvedFinding[]): DecorationSet {
  const ranges = findings.map((finding) => {
    if (finding.anchorKind === "line") {
      return Decoration.widget({
        widget: new RemoteLineMarkerWidget(finding.id, finding.visualState),
        side: -1,
      }).range(finding.from);
    }
    return Decoration.mark({
      class: `bpc-range bpc-${finding.visualState}`,
      attributes: {
        "data-bpc-finding": finding.id,
        "aria-label": `${finding.agentLabel}: ${finding.explanation}`,
      },
    }).range(finding.from, finding.to);
  });
  return Decoration.set(ranges, true);
}

const remoteFindingField = StateField.define<ResolvedFinding[]>({
  create: () => [],
  update(previous, transaction) {
    let findings = transaction.docChanged
      ? previous
          .map((finding) => mapFinding(transaction, finding))
          .filter((finding): finding is ResolvedFinding => finding !== null)
      : [...previous];

    for (const effect of transaction.effects) {
      if (effect.is(setAllFindingsEffect)) {
        findings = effect.value;
      } else if (effect.is(replaceAgentFindingsEffect)) {
        findings = [
          ...findings.filter((finding) => finding.agentId !== effect.value.agentId),
          ...effect.value.findings,
        ];
      } else if (effect.is(removeFindingEffect)) {
        findings = findings.filter((finding) => finding.id !== effect.value);
      } else if (effect.is(removeAgentEffect)) {
        findings = findings.filter((finding) => finding.agentId !== effect.value);
      } else if (effect.is(markAllStaleEffect)) {
        findings = findings
          .filter((finding) => finding.visualState !== "resolved")
          .map((finding) => ({ ...finding, visualState: "stale", canApply: false }));
      } else if (effect.is(upsertFindingEffect)) {
        findings = [
          ...findings.filter((finding) => finding.id !== effect.value.id),
          effect.value,
        ];
      }
    }
    return deduplicate(findings);
  },
  provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

export interface RemoteEditorCallbacks {
  initialFindings: (filePath: string, documentText: string) => ResolvedFinding[];
  documentEdited: (
    filePath: string,
    documentText: string,
    findings: ResolvedFinding[],
    sourceView: EditorView,
  ) => void;
  applied: (filePath: string, finding: ResolvedFinding, documentText: string) => void;
  dismissed: (filePath: string, finding: ResolvedFinding) => void;
  disableAgent: (filePath: string, agentId: string) => void;
}

function appendText(parent: HTMLElement, className: string, text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function currentFinding(view: EditorView, id: string): ResolvedFinding | null {
  return view.state.field(remoteFindingField, false)?.find((finding) => finding.id === id) ?? null;
}

function renderFindingCard(
  view: EditorView,
  finding: ResolvedFinding,
  callbacks: RemoteEditorCallbacks,
): HTMLElement {
  const card = document.createElement("li");
  card.className = `bpc-diagnostic bpc-${finding.visualState}`;

  const badge = appendText(card, "bpc-agent-badge", finding.agentLabel);
  badge.title = finding.agentDefinition;
  appendText(card, "bpc-agent-definition", finding.agentDefinition);
  appendText(card, "bpc-explanation", finding.explanation);

  const passage = document.createElement("code");
  passage.className = "bpc-passage";
  passage.textContent = finding.exactText;
  card.appendChild(passage);

  if (finding.replacement !== null) {
    const replacement = document.createElement("div");
    replacement.className = "bpc-replacement";
    const arrow = document.createElement("span");
    arrow.className = "bpc-replacement-arrow";
    arrow.textContent = "→";
    replacement.appendChild(arrow);
    const replacementText = document.createElement("code");
    replacementText.textContent = finding.replacement === "" ? "Delete this passage" : finding.replacement;
    replacement.appendChild(replacementText);
    card.appendChild(replacement);
  } else {
    appendText(card, "bpc-no-replacement", "Explanation only — no safe local replacement.");
  }

  if (finding.visualState === "resolved") {
    appendText(card, "bpc-resolved-label", "Resolved for this view session");
    return card;
  }

  const actions = document.createElement("div");
  actions.className = "bpc-actions";

  if (finding.canApply && finding.replacement !== null && finding.visualState === "fresh") {
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = finding.replacement === "" ? "Delete" : "Apply";
    apply.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const mapped = currentFinding(view, finding.id);
      if (!mapped || mapped.visualState !== "fresh" || mapped.replacement === null) return;
      const currentText = view.state.doc.sliceString(mapped.from, mapped.to);
      if (currentText !== mapped.exactText) return;
      const replacement = mapped.replacement;
      const resolved: ResolvedFinding = {
        ...mapped,
        exactText: replacement,
        prefixContext: "",
        suffixContext: "",
        from: mapped.from,
        to: mapped.from + replacement.length,
        visualState: "resolved",
        canApply: false,
      };
      view.dispatch({
        changes: { from: mapped.from, to: mapped.to, insert: replacement },
        selection: { anchor: mapped.from + replacement.length },
        effects: upsertFindingEffect.of(resolved),
      });
      const filePath = filePathForView(view);
      if (filePath) callbacks.applied(filePath, mapped, view.state.doc.toString());
    });
    actions.appendChild(apply);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const mapped = currentFinding(view, finding.id);
    if (!mapped) return;
    view.dispatch({ effects: removeFindingEffect.of(mapped.id) });
    const filePath = filePathForView(view);
    if (filePath) callbacks.dismissed(filePath, mapped);
  });
  actions.appendChild(dismiss);

  const disable = document.createElement("button");
  disable.type = "button";
  disable.textContent = "Disable agent";
  disable.addEventListener("mousedown", (event) => {
    event.preventDefault();
    view.dispatch({ effects: removeAgentEffect.of(finding.agentId) });
    const filePath = filePathForView(view);
    if (filePath) callbacks.disableAgent(filePath, finding.agentId);
  });
  actions.appendChild(disable);
  card.appendChild(actions);
  return card;
}

function remoteTooltip(callbacks: RemoteEditorCallbacks): Extension {
  return hoverTooltip((view, position, side) => {
    const findings = view.state.field(remoteFindingField, false) ?? [];
    const matching = findings.filter((finding) => {
      if (finding.from === finding.to) return position === finding.from;
      return (
        position >= finding.from &&
        position <= finding.to &&
        (position > finding.from || side > 0) &&
        (position < finding.to || side < 0)
      );
    });
    if (matching.length === 0) return null;
    const from = Math.min(...matching.map((finding) => finding.from));
    const to = Math.max(...matching.map((finding) => finding.to));
    return {
      pos: from,
      end: to,
      above: view.state.doc.lineAt(from).to < to,
      create(tooltipView) {
        const list = document.createElement("ul");
        list.className = "bpc-tooltip";
        for (const finding of matching) {
          list.appendChild(renderFindingCard(tooltipView, finding, callbacks));
        }
        return { dom: list };
      },
    };
  });
}

const remoteTheme = EditorView.baseTheme({
  ".bpc-range": {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.5 L2 1 L3 1 L5 2.5 L6 2.5' stroke='%238b5cf6' fill='none' stroke-width='1'/%3E%3C/svg%3E\")",
    backgroundPosition: "left bottom",
    backgroundRepeat: "repeat-x",
    paddingBottom: "1px",
  },
  ".bpc-range.bpc-stale": { filter: "grayscale(1)", opacity: "0.35" },
  ".bpc-range.bpc-resolved": { filter: "grayscale(1)", opacity: "0.25" },
  ".bpc-line-marker": {
    display: "inline-block",
    width: "1.2em",
    marginLeft: "-1.35em",
    color: "#8b5cf6",
    fontSize: "0.7em",
    cursor: "help",
  },
  ".bpc-line-marker.bpc-stale": { color: "var(--text-muted)", opacity: "0.35" },
  ".bpc-line-marker.bpc-resolved": { color: "var(--text-muted)", opacity: "0.25" },
  ".cm-tooltip:has(.bpc-tooltip)": {
    padding: "0 !important",
    border: "1px solid var(--background-modifier-border-hover)",
    borderRadius: "var(--radius-m)",
    background: "var(--background-secondary)",
    boxShadow: "var(--shadow-s)",
    maxWidth: "min(560px, 86vw)",
    overflow: "hidden",
  },
  ".bpc-tooltip": {
    listStyle: "none",
    margin: "0",
    padding: "var(--size-4-2)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--size-4-2)",
    maxHeight: "min(70vh, 680px)",
    overflowY: "auto",
  },
  ".bpc-diagnostic": {
    display: "flex",
    flexDirection: "column",
    gap: "var(--size-4-2)",
    padding: "var(--size-4-3)",
    borderRadius: "var(--radius-s)",
    background: "var(--background-primary-alt)",
  },
  ".bpc-diagnostic.bpc-stale": { opacity: "0.6" },
  ".bpc-diagnostic.bpc-resolved": { opacity: "0.45" },
  ".bpc-agent-badge": {
    width: "fit-content",
    padding: "2px 7px",
    borderRadius: "999px",
    color: "var(--text-on-accent)",
    background: "#7c3aed",
    fontSize: "var(--font-ui-smaller)",
    fontWeight: "600",
  },
  ".bpc-agent-definition": { color: "var(--text-muted)", fontSize: "var(--font-ui-smaller)" },
  ".bpc-explanation": { whiteSpace: "pre-wrap" },
  ".bpc-passage, .bpc-replacement code": {
    display: "block",
    whiteSpace: "pre-wrap",
    userSelect: "text",
    padding: "var(--size-4-2)",
    borderRadius: "var(--radius-s)",
    background: "var(--code-background)",
  },
  ".bpc-replacement": { display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "8px" },
  ".bpc-replacement-arrow": { color: "#8b5cf6", fontWeight: "700" },
  ".bpc-no-replacement, .bpc-resolved-label": { color: "var(--text-muted)", fontStyle: "italic" },
  ".bpc-actions": { display: "flex", flexWrap: "wrap", gap: "var(--size-4-2)" },
  ".bpc-actions button": { cursor: "var(--cursor)" },
});

export class RemoteEditorBridge {
  private readonly views = new Set<EditorView>();
  readonly extension: Extension;

  constructor(private readonly callbacks: RemoteEditorCallbacks) {
    const bridge = this;
    const lifecycle = ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          bridge.views.add(view);
          queueMicrotask(() => {
            if (!bridge.views.has(view)) return;
            const filePath = filePathForView(view);
            if (!filePath) return;
            const findings = callbacks.initialFindings(filePath, view.state.doc.toString());
            view.dispatch({ effects: setAllFindingsEffect.of(findings) });
          });
        }

        update(update: { view: EditorView; docChanged: boolean }): void {
          if (!update.docChanged) return;
          const filePath = filePathForView(update.view);
          if (!filePath) return;
          const findings = update.view.state.field(remoteFindingField, false) ?? [];
          callbacks.documentEdited(
            filePath,
            update.view.state.doc.toString(),
            findings.filter((finding) => finding.visualState !== "resolved"),
            update.view,
          );
        }

        destroy(): void {
          bridge.views.delete(this.view);
        }
      },
    );
    this.extension = [remoteFindingField, remoteTooltip(callbacks), remoteTheme, lifecycle];
  }

  currentText(filePath: string): string | null {
    for (const view of this.views) {
      if (filePathForView(view) === filePath) return view.state.doc.toString();
    }
    return null;
  }

  setFindings(filePath: string, findings: ResolvedFinding[], except?: EditorView): void {
    for (const view of this.views) {
      if (view === except || filePathForView(view) !== filePath) continue;
      view.dispatch({ effects: setAllFindingsEffect.of(findings) });
    }
  }

  replaceAgentFindings(
    filePath: string,
    agentId: string,
    findings: ResolvedFinding[],
  ): void {
    for (const view of this.views) {
      if (filePathForView(view) !== filePath) continue;
      view.dispatch({ effects: replaceAgentFindingsEffect.of({ agentId, findings }) });
    }
  }

  markStale(filePath: string): void {
    for (const view of this.views) {
      if (filePathForView(view) !== filePath) continue;
      view.dispatch({ effects: markAllStaleEffect.of(null) });
    }
  }

  removeAgent(filePath: string, agentId: string): void {
    for (const view of this.views) {
      if (filePathForView(view) !== filePath) continue;
      view.dispatch({ effects: removeAgentEffect.of(agentId) });
    }
  }

  removeFinding(filePath: string, findingId: string): void {
    for (const view of this.views) {
      if (filePathForView(view) !== filePath) continue;
      view.dispatch({ effects: removeFindingEffect.of(findingId) });
    }
  }

  removeAll(filePath: string): void {
    this.setFindings(filePath, []);
  }
}

export const REMOTE_EDITOR_TESTING = {
  field: remoteFindingField,
  setAll: setAllFindingsEffect,
  replaceAgent: replaceAgentFindingsEffect,
  removeFinding: removeFindingEffect,
  removeAgent: removeAgentEffect,
  markAllStale: markAllStaleEffect,
  upsert: upsertFindingEffect,
};
