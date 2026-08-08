import type { EditorView } from "@codemirror/view";
import { join } from "node:path";
import {
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { AGENTS, AGENT_BY_ID } from "./agents";
import { validateAndResolveFindings } from "./anchors";
import { HarperGrammarService } from "./harperEditor";
import { hashDocument } from "./hash";
import { OpenCodeClient } from "./openCodeClient";
import { RemoteEditorBridge } from "./remoteEditor";
import { RunCoordinator } from "./runCoordinator";
import type {
  AgentDefinition,
  CachedFinding,
  DocumentRun,
  ModelCatalogInfo,
  ProseCheckerData,
  ProseCheckerSettings,
  ResolvedFinding,
  RunProgressSnapshot,
} from "./types";
import {
  AgentSelectorModal,
  PROGRESS_VIEW_TYPE,
  ProseCheckerSettingTab,
  ProseProgressView,
  RemoteConsentModal,
} from "./ui";

const DEFAULT_SETTINGS: ProseCheckerSettings = {
  remoteConsentAccepted: false,
  localHarperEnabled: true,
  harperDelayMs: 750,
  maxConcurrency: 24,
  enabledAgents: Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.enabled])),
};

function normalizeData(raw: unknown): ProseCheckerData {
  const candidate = typeof raw === "object" && raw !== null ? (raw as Partial<ProseCheckerData>) : {};
  const settings = candidate.settings ?? ({} as Partial<ProseCheckerSettings>);
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      enabledAgents: {
        ...DEFAULT_SETTINGS.enabledAgents,
        ...(settings.enabledAgents ?? {}),
      },
    },
    cachedDocuments: candidate.cachedDocuments ?? {},
  };
}

function toCachedFinding(finding: ResolvedFinding): CachedFinding {
  return {
    id: finding.id,
    agentId: finding.agentId,
    agentLabel: finding.agentLabel,
    agentDefinition: finding.agentDefinition,
    agentVersion: finding.agentVersion,
    exactText: finding.exactText,
    prefixContext: finding.prefixContext,
    suffixContext: finding.suffixContext,
    occurrenceHint: finding.occurrenceHint,
    explanation: finding.explanation,
    replacement: finding.replacement,
    anchorKind: finding.anchorKind,
    sourceDocumentHash: finding.sourceDocumentHash,
  };
}

export default class BrinedewProseCheckerPlugin extends Plugin {
  startupMilliseconds: number | null = null;
  settings: ProseCheckerSettings = { ...DEFAULT_SETTINGS };
  private data: ProseCheckerData = normalizeData(null);
  private client!: OpenCodeClient;
  private coordinator!: RunCoordinator;
  private remoteEditor!: RemoteEditorBridge;
  private harper!: HarperGrammarService;
  private statusBar!: HTMLElement;
  private latestProgress: RunProgressSnapshot | null = null;
  private statusTimer: number | null = null;
  private saveTimer: number | null = null;
  private readonly paneActions = new WeakSet<MarkdownView>();

  async onload(): Promise<void> {
    const started = performance.now();
    this.data = normalizeData(await this.loadData());
    this.settings = this.data.settings;

    // ARCHITECTURE FENCE [BPC-001]: constructing these objects must not read the
    // API key, probe a model, inspect a document, or schedule a remote request.
    this.client = new OpenCodeClient();
    this.remoteEditor = new RemoteEditorBridge({
      initialFindings: (filePath, documentText) => this.initialFindings(filePath, documentText),
      documentEdited: (filePath, documentText, findings, sourceView) =>
        this.handleDocumentEdited(filePath, documentText, findings, sourceView),
      applied: (filePath, finding, documentText) =>
        this.handleApplied(filePath, finding, documentText),
      dismissed: (filePath, finding) => this.handleDismissed(filePath, finding),
      disableAgent: (filePath, agentId) => void this.disableAgent(filePath, agentId),
    });
    this.harper = new HarperGrammarService({
      enabled: () => this.settings.localHarperEnabled,
      delayMs: () => this.settings.harperDelayMs,
      engineModulePath: this.harperEnginePath(),
    });
    this.coordinator = new RunCoordinator(
      this.client,
      AGENTS,
      {
        onRunStarted: (run) => this.handleRunStarted(run),
        onAgentCompleted: (run, agent, findings) =>
          this.handleAgentCompleted(run, agent, findings),
        onAgentCleared: (filePath, agentId) => this.clearAgentFindings(filePath, agentId),
      },
      this.settings.maxConcurrency,
    );

    this.registerEditorExtension([this.harper.extension, this.remoteEditor.extension]);
    this.registerView(
      PROGRESS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new ProseProgressView(leaf, this.coordinator, (filePath, agentId) => {
          void this.runFileWithAgents(filePath, [agentId]);
        }),
    );
    this.addSettingTab(
      new ProseCheckerSettingTab(this.app, this, {
        settings: this.settings,
        saveSettings: () => this.saveSettings(),
        probeConnection: () => this.probeConnection(),
        setAgentEnabled: (agentId, enabled) => this.setAgentEnabled(agentId, enabled),
      }, AGENTS),
    );

    this.registerCommands();
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("bpc-status-bar", "mod-clickable");
    this.statusBar.setText("Prose check: idle");
    this.registerDomEvent(this.statusBar, "click", () => {
      if (this.latestProgress) void this.openProgress(this.latestProgress.runId);
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.attachPaneActions();
        this.refreshStatusForActiveFile();
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.attachPaneActions()));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        this.renameCachedFile(oldPath, file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        this.deleteCachedFile(file.path);
      }),
    );
    this.register(() => this.coordinator.destroy());
    this.register(() => this.harper.dispose());
    this.register(() => {
      if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    });
    this.coordinator.subscribe((snapshot) => {
      this.latestProgress = snapshot;
      this.renderStatus(snapshot);
    });
    this.statusTimer = window.setInterval(() => {
      if (this.latestProgress?.finishedAt === null) this.renderStatus(this.latestProgress);
    }, 1_000);

    this.app.workspace.onLayoutReady(() => this.attachPaneActions());
    this.startupMilliseconds = performance.now() - started;
    console.info(`[Brinedew Prose Checker] onload ${this.startupMilliseconds.toFixed(1)} ms; remote requests: 0`);
  }

  onunload(): void {
    void this.app.workspace.detachLeavesOfType(PROGRESS_VIEW_TYPE);
  }

  private harperEnginePath(): string {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter) || !this.manifest.dir) {
      throw new Error("Brinedew Prose Checker requires an Obsidian desktop filesystem vault.");
    }
    return join(this.app.vault.adapter.getBasePath(), this.manifest.dir, "harper-engine.cjs");
  }

  private registerCommands(): void {
    this.addCommand({
      id: "check-active-note-all-agents",
      name: "Check active note with all enabled agents",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.runViewWithAgents(view);
        return true;
      },
    });
    this.addCommand({
      id: "check-active-note-one-agent",
      name: "Check active note with one agent…",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) this.openAgentSelector(view);
        return true;
      },
    });
    this.addCommand({
      id: "open-prose-check-progress",
      name: "Open prose-check progress",
      callback: () => {
        if (this.latestProgress) void this.openProgress(this.latestProgress.runId);
        else new Notice("No prose check has run in this session.");
      },
    });
  }

  private attachPaneActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || this.paneActions.has(view)) continue;
      this.paneActions.add(view);
      const action = view.addAction(
        "scan-search",
        "Check prose with all enabled agents · right-click to choose one",
        () => void this.runViewWithAgents(view),
      );
      this.register(() => action.remove());
      this.registerDomEvent(action, "contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openAgentSelector(view);
      });
    }
  }

  private openAgentSelector(view: MarkdownView): void {
    new AgentSelectorModal(this.app, AGENTS, (agent) => {
      void this.runViewWithAgents(view, [agent.id]);
    }).open();
  }

  private async ensureConsent(): Promise<boolean> {
    if (this.settings.remoteConsentAccepted) return true;
    return new Promise((resolve) => {
      new RemoteConsentModal(this.app, (accepted) => {
        if (!accepted) {
          resolve(false);
          return;
        }
        this.settings.remoteConsentAccepted = true;
        void this.saveSettings().then(() => resolve(true));
      }).open();
    });
  }

  private enabledAgentIds(): string[] {
    return AGENTS.filter((agent) => this.settings.enabledAgents[agent.id] ?? agent.enabled).map(
      (agent) => agent.id,
    );
  }

  private async runViewWithAgents(view: MarkdownView, agentIds?: readonly string[]): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice("Open an editable Markdown note before running a prose check.");
      return;
    }
    if (!(await this.ensureConsent())) return;
    const selected = agentIds ?? this.enabledAgentIds();
    if (selected.length === 0) {
      new Notice("Every prose-checker agent is disabled. Enable at least one in settings.");
      return;
    }
    const existing = this.coordinator.getRunForFile(file.path);
    if (existing?.finishedAt === null && !existing.cancelled) {
      await this.openProgress(existing.id);
      return;
    }
    const startPromise = this.coordinator.startRun(file.path, view.editor.getValue(), selected);
    const startedRun = this.coordinator.getRunForFile(file.path);
    if (startedRun) await this.openProgress(startedRun.id);
    try {
      await startPromise;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    }
  }

  private async runFileWithAgents(filePath: string, agentIds: readonly string[]): Promise<void> {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === filePath) {
      await this.runViewWithAgents(active, agentIds);
      return;
    }
    const abstract = this.app.vault.getAbstractFileByPath(filePath);
    if (!(abstract instanceof TFile)) {
      new Notice(`Cannot rerun agent: ${filePath} no longer exists.`);
      return;
    }
    if (!(await this.ensureConsent())) return;
    const text = await this.app.vault.cachedRead(abstract);
    const promise = this.coordinator.startRun(filePath, text, agentIds);
    const run = this.coordinator.getRunForFile(filePath);
    if (run) await this.openProgress(run.id);
    await promise;
  }

  private async openProgress(runId: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(PROGRESS_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: PROGRESS_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof ProseProgressView) view.showRun(runId);
  }

  private handleRunStarted(run: DocumentRun): void {
    this.remoteEditor.markStale(run.filePath);
    this.data.cachedDocuments[run.filePath] = {
      documentHash: run.sourceDocumentHash,
      findings: [],
      savedAt: Date.now(),
    };
    void this.savePluginData();
  }

  private async currentDocumentText(filePath: string): Promise<string | null> {
    const editorText = this.remoteEditor.currentText(filePath);
    if (editorText !== null) return editorText;
    const abstract = this.app.vault.getAbstractFileByPath(filePath);
    return abstract instanceof TFile ? this.app.vault.cachedRead(abstract) : null;
  }

  private async handleAgentCompleted(
    run: DocumentRun,
    agent: AgentDefinition,
    findings: ResolvedFinding[],
  ): Promise<void> {
    const currentText = await this.currentDocumentText(run.filePath);
    if (currentText === null) return;
    const currentHash = hashDocument(currentText);
    const reanchored = validateAndResolveFindings(
      findings,
      agent.id,
      run.filePath,
      currentText,
      currentHash,
    ).valid;
    const entry = this.data.cachedDocuments[run.filePath] ?? {
      documentHash: currentHash,
      findings: [],
      savedAt: Date.now(),
    };
    entry.documentHash = currentHash;
    entry.findings = [
      ...entry.findings.filter((finding) => finding.agentId !== agent.id),
      ...reanchored.map(toCachedFinding),
    ];
    entry.savedAt = Date.now();
    this.data.cachedDocuments[run.filePath] = entry;
    await this.savePluginData();
    this.remoteEditor.replaceAgentFindings(run.filePath, agent.id, reanchored);
  }

  private initialFindings(filePath: string, documentText: string): ResolvedFinding[] {
    const entry = this.data.cachedDocuments[filePath];
    const documentHash = hashDocument(documentText);
    if (!entry || entry.documentHash !== documentHash) return [];
    return this.resolveCachedFindings(filePath, documentText, entry.findings);
  }

  private resolveCachedFindings(
    filePath: string,
    documentText: string,
    cached: readonly CachedFinding[],
  ): ResolvedFinding[] {
    const documentHash = hashDocument(documentText);
    return cached.flatMap((finding) => {
      const agent = AGENT_BY_ID.get(finding.agentId);
      if (
        !agent ||
        finding.agentVersion !== agent.version ||
        !(this.settings.enabledAgents[agent.id] ?? agent.enabled)
      ) {
        return [];
      }
      return validateAndResolveFindings(
        [finding],
        finding.agentId,
        filePath,
        documentText,
        documentHash,
      ).valid;
    });
  }

  private handleDocumentEdited(
    filePath: string,
    documentText: string,
    findings: ResolvedFinding[],
    sourceView: EditorView,
  ): void {
    const fresh = findings.filter((finding) => finding.visualState === "fresh");
    this.data.cachedDocuments[filePath] = {
      documentHash: hashDocument(documentText),
      findings: fresh.map(toCachedFinding),
      savedAt: Date.now(),
    };
    this.remoteEditor.setFindings(filePath, findings, sourceView);
    this.scheduleSave();
  }

  private handleApplied(
    filePath: string,
    _finding: ResolvedFinding,
    documentText: string,
  ): void {
    const entry = this.data.cachedDocuments[filePath];
    const remaining = entry
      ? this.resolveCachedFindings(filePath, documentText, entry.findings)
      : [];
    this.data.cachedDocuments[filePath] = {
      documentHash: hashDocument(documentText),
      findings: remaining.map(toCachedFinding),
      savedAt: Date.now(),
    };
    this.scheduleSave();
  }

  private handleDismissed(filePath: string, finding: ResolvedFinding): void {
    const entry = this.data.cachedDocuments[filePath];
    if (entry) {
      entry.findings = entry.findings.filter((candidate) => candidate.id !== finding.id);
      entry.savedAt = Date.now();
      this.scheduleSave();
    }
    this.remoteEditor.removeFinding(filePath, finding.id);
  }

  private async disableAgent(filePath: string, agentId: string): Promise<void> {
    await this.setAgentEnabled(agentId, false);
    await this.clearAgentFindings(filePath, agentId);
    const run = this.coordinator.getRunForFile(filePath);
    if (run?.finishedAt === null) this.coordinator.cancelAgent(run.id, agentId);
  }

  private async clearAgentFindings(filePath: string, agentId: string): Promise<void> {
    const entry = this.data.cachedDocuments[filePath];
    if (entry) {
      entry.findings = entry.findings.filter((finding) => finding.agentId !== agentId);
      entry.savedAt = Date.now();
      await this.savePluginData();
    }
    this.remoteEditor.removeAgent(filePath, agentId);
  }

  private renameCachedFile(oldPath: string, newPath: string): void {
    const entry = this.data.cachedDocuments[oldPath];
    if (entry) {
      delete this.data.cachedDocuments[oldPath];
      this.data.cachedDocuments[newPath] = entry;
      this.scheduleSave();
    }
    this.coordinator.renameFile(oldPath, newPath);
  }

  private deleteCachedFile(filePath: string): void {
    delete this.data.cachedDocuments[filePath];
    this.remoteEditor.removeAll(filePath);
    this.coordinator.deleteFile(filePath);
    this.scheduleSave();
  }

  private renderStatus(snapshot: RunProgressSnapshot): void {
    const elapsed = Math.max(0, Math.round(((snapshot.finishedAt ?? Date.now()) - snapshot.startedAt) / 1_000));
    this.statusBar.setText(
      `Prose check: ${snapshot.complete}/${snapshot.total} · ${snapshot.findings} findings${snapshot.failed ? ` · ${snapshot.failed} failed` : ""} · ${elapsed}s`,
    );
    this.statusBar.setAttr("aria-label", `Open progress for ${snapshot.filePath}`);
  }

  private refreshStatusForActiveFile(): void {
    const filePath = this.app.workspace.getActiveFile()?.path;
    const snapshot = filePath ? this.coordinator.getLatestSnapshot(filePath) : null;
    if (snapshot) {
      this.latestProgress = snapshot;
      this.renderStatus(snapshot);
    }
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    this.coordinator.updateMaxConcurrency(this.settings.maxConcurrency);
    await this.savePluginData();
  }

  private async setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    this.settings.enabledAgents[agentId] = enabled;
    if (!enabled) {
      for (const [filePath, entry] of Object.entries(this.data.cachedDocuments)) {
        entry.findings = entry.findings.filter((finding) => finding.agentId !== agentId);
        this.remoteEditor.removeAgent(filePath, agentId);
      }
    }
    await this.saveSettings();
  }

  private probeConnection(): Promise<ModelCatalogInfo> {
    return this.client.probeModel(new AbortController().signal, true);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.savePluginData();
    }, 500);
  }

  private async savePluginData(): Promise<void> {
    this.data.settings = this.settings;
    await this.saveData(this.data);
  }
}
