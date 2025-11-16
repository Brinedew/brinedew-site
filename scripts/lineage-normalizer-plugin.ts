// @ts-nocheck
// Obsidian plugin for Lineage grouped-by-depth normalization
// Maintains scaffold (depth 1-2) + content (depth 3+) structure

import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian"
import { 
  assignUidsOnce, 
  normalizeGrouped, 
  NormalizeOptions,
  parseSections,
  hasUids
} from "./lineage-core"

interface LineageNormalizerSettings {
  autoNormalizeOnSave: boolean
  sortScaffoldSections: boolean
  addBlockComments: boolean
  onlyProcessLineageFiles: boolean
}

const DEFAULT_SETTINGS: LineageNormalizerSettings = {
  autoNormalizeOnSave: true,
  sortScaffoldSections: false,
  addBlockComments: true,
  onlyProcessLineageFiles: true
}

export default class LineageNormalizerPlugin extends Plugin {
  settings: LineageNormalizerSettings
  private inFlight = false

  async onload() {
    await this.loadSettings()

    // Add settings tab
    this.addSettingTab(new LineageNormalizerSettingTab(this.app, this))

    // Manual normalize command
    this.addCommand({
      id: "lineage-normalize-current",
      name: "Lineage: Normalize current document",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile()
        if (activeFile && activeFile.extension === "md") {
          if (!checking) {
            this.normalizeFile(activeFile)
          }
          return true
        }
        return false
      }
    })

    // Normalize all lineage files command
    this.addCommand({
      id: "lineage-normalize-all",
      name: "Lineage: Normalize all documents with lineage markers",
      callback: () => this.normalizeAllLineageFiles()
    })

    // Auto-normalize on file save
    if (this.settings.autoNormalizeOnSave) {
      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (this.inFlight) return
          this.handleFileModified(file)
        })
      )
    }

    console.log("Lineage Normalizer plugin loaded")
  }

  onunload() {
    console.log("Lineage Normalizer plugin unloaded")
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  private async handleFileModified(file: TFile) {
    if (!(file instanceof TFile) || file.extension !== "md") return
    
    try {
      const content = await this.app.vault.read(file)
      
      // Skip if not a lineage file and we're only processing lineage files
      if (this.settings.onlyProcessLineageFiles && !this.isLineageFile(content)) {
        return
      }
      
      await this.normalizeFileContent(file, content)
    } catch (error) {
      console.error("Error in auto-normalize:", error)
    }
  }

  private isLineageFile(content: string): boolean {
    return content.includes("data-lineage-section")
  }

  private async normalizeFile(file: TFile) {
    try {
      const content = await this.app.vault.read(file)
      await this.normalizeFileContent(file, content)
      new Notice(`Normalized ${file.name}`)
    } catch (error) {
      new Notice(`Failed to normalize ${file.name}: ${error.message}`)
      console.error("Normalize error:", error)
    }
  }

  private async normalizeFileContent(file: TFile, content: string) {
    if (this.inFlight) return
    
    try {
      this.inFlight = true
      
      // Skip if no lineage markers
      if (!this.isLineageFile(content)) return
      
      // Step 1: Assign UIDs if missing
      const withUids = assignUidsOnce(content)
      
      // Step 2: Normalize structure
      const normalizeOptions: NormalizeOptions = {
        sortScaffold: this.settings.sortScaffoldSections,
        addComments: this.settings.addBlockComments
      }
      
      const normalized = normalizeGrouped(withUids, normalizeOptions)
      
      // Only write if content changed
      if (normalized !== content) {
        await this.app.vault.modify(file, normalized)
        
        // Show subtle feedback
        if (!this.settings.autoNormalizeOnSave) {
          const sections = parseSections(normalized)
          const scaffoldCount = sections.filter(s => s.depth <= 2).length
          const contentCount = sections.filter(s => s.depth >= 3).length
          new Notice(`Normalized: ${scaffoldCount} scaffold + ${contentCount} content sections`, 2000)
        }
      }
    } finally {
      this.inFlight = false
    }
  }

  private async normalizeAllLineageFiles() {
    const markdownFiles = this.app.vault.getMarkdownFiles()
    const lineageFiles: TFile[] = []
    
    // Find all files with lineage markers
    for (const file of markdownFiles) {
      try {
        const content = await this.app.vault.read(file)
        if (this.isLineageFile(content)) {
          lineageFiles.push(file)
        }
      } catch (error) {
        console.warn(`Could not read ${file.path}:`, error)
      }
    }
    
    if (lineageFiles.length === 0) {
      new Notice("No files with lineage markers found")
      return
    }
    
    new Notice(`Normalizing ${lineageFiles.length} lineage files...`)
    
    let processedCount = 0
    for (const file of lineageFiles) {
      try {
        await this.normalizeFile(file)
        processedCount++
      } catch (error) {
        console.error(`Failed to normalize ${file.path}:`, error)
      }
    }
    
    new Notice(`Normalized ${processedCount}/${lineageFiles.length} files`)
  }
}

class LineageNormalizerSettingTab extends PluginSettingTab {
  plugin: LineageNormalizerPlugin

  constructor(app: App, plugin: LineageNormalizerPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl("h2", { text: "Lineage Normalizer Settings" })

    containerEl.createEl("p", { 
      text: "Automatically maintains grouped-by-depth structure: scaffold sections (depth 1-2) followed by content sections (depth 3+)." 
    })

    new Setting(containerEl)
      .setName("Auto-normalize on save")
      .setDesc("Automatically normalize lineage files when they are modified")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoNormalizeOnSave)
        .onChange(async (value) => {
          this.plugin.settings.autoNormalizeOnSave = value
          await this.plugin.saveSettings()
          
          // Show restart notice since we need to re-register events
          new Notice("Restart Obsidian to apply auto-normalize setting changes")
        }))

    new Setting(containerEl)
      .setName("Sort scaffold sections")
      .setDesc("Sort scaffold sections (depth 1-2) numerically instead of preserving document order")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.sortScaffoldSections)
        .onChange(async (value) => {
          this.plugin.settings.sortScaffoldSections = value
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName("Add block comments")
      .setDesc("Add <!-- lineage:scaffold start --> style comments to mark sections")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.addBlockComments)
        .onChange(async (value) => {
          this.plugin.settings.addBlockComments = value
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName("Only process lineage files")
      .setDesc("Only auto-normalize files that contain data-lineage-section markers")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.onlyProcessLineageFiles)
        .onChange(async (value) => {
          this.plugin.settings.onlyProcessLineageFiles = value
          await this.plugin.saveSettings()
        }))

    // Add some helpful info
    containerEl.createEl("h3", { text: "How it works" })
    
    const infoEl = containerEl.createEl("div")
    infoEl.innerHTML = `
      <ul>
        <li><strong>UIDs:</strong> Adds stable data-lineage-uid to each section marker (one-time)</li>
        <li><strong>Scaffold:</strong> Sections with depth ≤ 2 (editorial signposts)</li>
        <li><strong>Content:</strong> Sections with depth ≥ 3 (actual content)</li>
        <li><strong>Idempotent:</strong> Safe to run repeatedly, produces same output</li>
        <li><strong>Order-agnostic:</strong> Works with any section arrangement in source</li>
      </ul>
    `

    containerEl.createEl("p", { 
      text: "Use 'Lineage: Normalize current document' command to manually normalize the active file, or enable auto-normalize for seamless workflow." 
    })
  }
}
