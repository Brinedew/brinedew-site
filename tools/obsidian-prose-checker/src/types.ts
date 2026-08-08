export type AnchorPolicy = "exact-span" | "line-marker"
export type SuggestionPolicy = "replace" | "delete" | "explain-only"

export interface Example {
  text: string
  rationale: string
}

export interface AgentDefinition {
  id: string
  label: string
  definition: string
  positiveExamples: Example[]
  hardNegativeExamples: Example[]
  protectedNearNeighbors: string[]
  anchorPolicy: AnchorPolicy
  suggestionPolicy: SuggestionPolicy
  enabled: boolean
  version: number
}

export interface AgentFinding {
  agentId: string
  exactText: string
  prefixContext: string
  suffixContext: string
  occurrenceHint: number
  explanation: string
  replacement: string | null
  anchorKind: "span" | "line"
}

export type FindingVisualState = "fresh" | "stale" | "resolved"

export interface ResolvedFinding extends AgentFinding {
  id: string
  filePath: string
  agentLabel: string
  agentDefinition: string
  from: number
  to: number
  sourceDocumentHash: string
  agentVersion: number
  visualState: FindingVisualState
  canApply: boolean
}

export interface CachedFinding extends AgentFinding {
  id: string
  agentLabel: string
  agentDefinition: string
  sourceDocumentHash: string
  agentVersion: number
}

export type AgentRunStatus = "queued" | "running" | "complete" | "failed" | "cancelled"

export interface AgentRunState {
  agentId: string
  label: string
  status: AgentRunStatus
  startedAt: number | null
  finishedAt: number | null
  findingCount: number
  rejectedAnchorCount: number
  error: string | null
  attempt: number
}

export interface DocumentRun {
  id: string
  filePath: string
  sourceText: string
  sourceDocumentHash: string
  startedAt: number
  finishedAt: number | null
  cancelled: boolean
  agents: Map<string, AgentRunState>
}

export interface StoredDocumentFindings {
  documentHash: string
  findings: CachedFinding[]
  savedAt: number
}

export type OpenCodeConnectionStatus =
  | "unchecked"
  | "connected"
  | "missing-key"
  | "invalid-key"
  | "model-unavailable"
  | "free-period-ended"
  | "network-error"

export interface ProseCheckerSettings {
  remoteConsentAccepted: boolean
  localHarperEnabled: boolean
  harperDelayMs: number
  maxConcurrency: number
  enabledAgents: Record<string, boolean>
}

export interface ProseCheckerData {
  settings: ProseCheckerSettings
  cachedDocuments: Record<string, StoredDocumentFindings>
}

export interface ModelCatalogInfo {
  available: boolean
  contextTokens: number
  status: OpenCodeConnectionStatus
  message: string
  checkedAt: number
}

export interface RunProgressSnapshot {
  runId: string
  filePath: string
  startedAt: number
  finishedAt: number | null
  cancelled: boolean
  total: number
  queued: number
  running: number
  complete: number
  failed: number
  cancelledAgents: number
  findings: number
  agents: AgentRunState[]
}
