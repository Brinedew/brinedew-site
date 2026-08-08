import {
  App,
  ItemView,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SuggestModal,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type { AgentDefinition, ModelCatalogInfo, ProseCheckerSettings, RunProgressSnapshot } from "./types";
import type { RunCoordinator } from "./runCoordinator";

export const PROGRESS_VIEW_TYPE = "brinedew-prose-checker-progress";

export class AgentSelectorModal extends SuggestModal<AgentDefinition> {
  constructor(
    app: App,
    private readonly agents: readonly AgentDefinition[],
    private readonly onChoose: (agent: AgentDefinition) => void,
  ) {
    super(app);
    this.setPlaceholder("Run one atomic prose agent…");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "run selected agent" },
      { command: "esc", purpose: "close" },
    ]);
  }

  getSuggestions(query: string): AgentDefinition[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [...this.agents];
    return this.agents.filter(
      (agent) =>
        agent.label.toLowerCase().includes(normalized) ||
        agent.definition.toLowerCase().includes(normalized),
    );
  }

  renderSuggestion(agent: AgentDefinition, element: HTMLElement): void {
    element.createDiv({ cls: "bpc-agent-picker-label", text: agent.label });
    element.createDiv({ cls: "bpc-agent-picker-definition", text: agent.definition });
  }

  onChooseSuggestion(agent: AgentDefinition): void {
    this.onChoose(agent);
  }
}

export class RemoteConsentModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly resolveChoice: (accepted: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Send this note to DeepSeek V4 Flash Free?");
    this.contentEl.createEl("p", {
      text: "A check sends the complete active Markdown note to OpenCode Zen. The free model may retain free-tier inputs for model improvement. Nothing is sent while typing or at startup.",
    });
    this.contentEl.createEl("p", {
      text: "Accepting records one consent choice for this personal plugin. You can revoke it in settings.",
    });
    const actions = this.contentEl.createDiv({ cls: "bpc-consent-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.finish(false));
    const accept = actions.createEl("button", { cls: "mod-cta", text: "Allow explicit checks" });
    accept.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveChoice(false);
    }
    this.contentEl.empty();
  }

  private finish(accepted: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice(accepted);
    this.close();
  }
}

function formatDuration(start: number | null, finish: number | null): string {
  if (start === null) return "—";
  const seconds = Math.max(0, Math.round(((finish ?? Date.now()) - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export class ProseProgressView extends ItemView {
  private runId: string | null = null;
  private snapshot: RunProgressSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly coordinator: RunCoordinator,
    private readonly runOne: (filePath: string, agentId: string) => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PROGRESS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Prose check";
  }

  getIcon(): string {
    return "scan-search";
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.coordinator.subscribe((snapshot) => {
      if (this.runId === null || snapshot.runId === this.runId) {
        this.snapshot = snapshot;
        this.render();
      }
    });
    this.timer = window.setInterval(() => {
      if (this.snapshot?.finishedAt === null) this.render();
    }, 1_000);
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  showRun(runId: string): void {
    this.runId = runId;
    const run = this.coordinator.getRun(runId);
    this.snapshot = run ? this.coordinator.getLatestSnapshot(run.filePath) : null;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("bpc-progress-view");
    const snapshot = this.snapshot;
    if (!snapshot) {
      container.createDiv({ cls: "bpc-progress-empty", text: "No prose check has run in this session." });
      return;
    }

    const header = container.createDiv({ cls: "bpc-progress-header" });
    const icon = header.createSpan({ cls: "bpc-progress-icon" });
    setIcon(icon, "scan-search");
    const heading = header.createDiv();
    heading.createEl("h3", { text: snapshot.filePath });
    heading.createDiv({
      cls: "bpc-progress-summary",
      text: `${snapshot.complete}/${snapshot.total} complete · ${snapshot.findings} findings · ${snapshot.failed} failed · ${formatDuration(snapshot.startedAt, snapshot.finishedAt)}`,
    });

    const controls = container.createDiv({ cls: "bpc-progress-controls" });
    const cancelAll = controls.createEl("button", { text: "Cancel all" });
    cancelAll.disabled = snapshot.finishedAt !== null;
    cancelAll.addEventListener("click", () => this.coordinator.cancelRun(snapshot.runId));
    const retryFailed = controls.createEl("button", { text: "Retry failed" });
    retryFailed.disabled = snapshot.failed === 0;
    retryFailed.addEventListener("click", () => this.coordinator.retryFailed(snapshot.runId));

    const rows = container.createDiv({ cls: "bpc-progress-rows" });
    for (const state of snapshot.agents) {
      const row = rows.createDiv({ cls: `bpc-progress-row is-${state.status}` });
      const status = row.createSpan({ cls: "bpc-progress-status" });
      setIcon(
        status,
        state.status === "complete"
          ? "check"
          : state.status === "failed"
            ? "circle-x"
            : state.status === "running"
              ? "loader-circle"
              : state.status === "cancelled"
                ? "ban"
                : "clock-3",
      );
      const details = row.createDiv({ cls: "bpc-progress-details" });
      details.createDiv({ cls: "bpc-progress-agent", text: state.label });
      details.createDiv({
        cls: "bpc-progress-meta",
        text: `${state.status} · ${formatDuration(state.startedAt, state.finishedAt)} · ${state.findingCount} findings${state.rejectedAnchorCount > 0 ? ` · ${state.rejectedAnchorCount} anchors rejected` : ""}`,
      });
      if (state.error) details.createDiv({ cls: "bpc-progress-error", text: state.error });

      const actions = row.createDiv({ cls: "bpc-progress-row-actions" });
      if (state.status === "queued" || state.status === "running") {
        const cancel = actions.createEl("button", { attr: { "aria-label": `Cancel ${state.label}` } });
        setIcon(cancel, "x");
        cancel.addEventListener("click", () => this.coordinator.cancelAgent(snapshot.runId, state.agentId));
      } else if (state.status === "failed" || state.status === "cancelled") {
        const retry = actions.createEl("button", { attr: { "aria-label": `Retry ${state.label}` } });
        setIcon(retry, "rotate-cw");
        retry.addEventListener("click", () => this.coordinator.retryAgent(snapshot.runId, state.agentId));
      } else {
        const rerun = actions.createEl("button", { attr: { "aria-label": `Run ${state.label} again` } });
        setIcon(rerun, "play");
        rerun.addEventListener("click", () => this.runOne(snapshot.filePath, state.agentId));
      }
    }
  }
}

export interface SettingsHost {
  settings: ProseCheckerSettings;
  saveSettings: () => Promise<void>;
  probeConnection: () => Promise<ModelCatalogInfo>;
  setAgentEnabled: (agentId: string, enabled: boolean) => Promise<void>;
}

export class ProseCheckerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: import("obsidian").Plugin,
    private readonly host: SettingsHost,
    private readonly agents: readonly AgentDefinition[],
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Brinedew Prose Checker" });

    new Setting(containerEl)
      .setName("Local Harper grammar")
      .setDesc("Fast on-device grammar checking. This does not contact OpenCode.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.localHarperEnabled).onChange(async (value) => {
          this.host.settings.localHarperEnabled = value;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Allow explicit remote checks")
      .setDesc("A button press sends the complete active note to DeepSeek V4 Flash Free. The provider may retain free-tier inputs for model improvement.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.remoteConsentAccepted).onChange(async (value) => {
          this.host.settings.remoteConsentAccepted = value;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Maximum simultaneous agents")
      .setDesc("Starts at 24 and automatically backs off after rate limits.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 32, 1)
          .setDynamicTooltip()
          .setValue(this.host.settings.maxConcurrency)
          .onChange(async (value) => {
            this.host.settings.maxConcurrency = value;
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("OpenCode connection")
      .setDesc("The API key is read from the Windows user environment and never stored in this plugin.")
      .addButton((button) =>
        button.setButtonText("Check now").onClick(async () => {
          button.setDisabled(true).setButtonText("Checking…");
          const result = await this.host.probeConnection();
          new Notice(result.message, 8_000);
          button.setDisabled(false).setButtonText("Check now");
        }),
      );

    containerEl.createEl("h3", { text: `Atomic agents (${this.agents.length})` });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The main check button runs every enabled agent. Each toggle controls one independent model call.",
    });
    for (const agent of this.agents) {
      new Setting(containerEl)
        .setName(agent.label)
        .setDesc(agent.definition)
        .addToggle((toggle) =>
          toggle
            .setValue(this.host.settings.enabledAgents[agent.id] ?? agent.enabled)
            .onChange((value) => this.host.setAgentEnabled(agent.id, value)),
        );
    }
  }
}
