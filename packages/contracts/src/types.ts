/** Unified AitoolMgr state vocabulary (plan §5). */
export type UnifiedState =
  | "OFFLINE"
  | "IDLE"
  | "STARTING"
  | "THINKING"
  | "EXECUTING"
  | "WAITING_APPROVAL"
  | "WAITING_INPUT"
  | "SUCCEEDED"
  | "FAILED"
  | "STALLED"
  | "UNKNOWN";

export type EvidenceSource =
  | "official_event"
  | "cli_structured"
  | "ide_extension"
  | "hook"
  | "process"
  | "window"
  | "ocr"
  | "inferred"
  | "simulated"
  | "unknown";

export type ToolType =
  | "codex"
  | "cursor"
  | "cursor_cli"
  | "vscode"
  | "openclaw"
  | "claude_code"
  | "coze"
  | "generic"
  | "simulator";

export interface CapabilitySet {
  monitor: boolean;
  streamEvents: boolean;
  startTask: boolean;
  continueTask: boolean;
  approve: boolean;
  cancel: boolean;
  windowObservation: boolean;
  /** Runtime-discovered; never invent. */
  notes?: string[];
}

export interface MachineRecord {
  id: string;
  name: string;
  os: string;
  online: boolean;
  lastSeenAt: string;
  agentVersion?: string;
}

export interface ToolInstance {
  id: string;
  machineId: string;
  toolType: ToolType;
  displayName: string;
  version?: string;
  capabilities: CapabilitySet;
  simulated?: boolean;
}

export interface AgentInstance {
  id: string;
  machineId: string;
  toolInstanceId: string;
  /** OpenClaw agent id or synthetic seat id */
  agentKey: string;
  displayName: string;
  parentAgentId?: string;
}

export interface TelemetryEvent {
  eventId: string;
  timestamp: string;
  machineId: string;
  toolType: ToolType;
  toolInstanceId: string;
  agentId?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  state: UnifiedState;
  activity?: string;
  summary?: string;
  needsAttention?: boolean;
  confidence: number;
  evidenceSource: EvidenceSource;
  evidenceType: string;
  evidenceSummary?: string;
  sensitivity: "metadata_only" | "redacted_content";
  simulated?: boolean;
}

export interface SeatSnapshot {
  seatId: string;
  machineId: string;
  toolInstanceId: string;
  agentId?: string;
  toolType: ToolType;
  title: string;
  state: UnifiedState;
  confidence: number;
  evidenceSource: EvidenceSource;
  evidenceType: string;
  evidenceSummary?: string;
  summary?: string;
  needsAttention: boolean;
  since: string;
  updatedAt: string;
  durationMs: number;
  simulated?: boolean;
  capabilities: CapabilitySet;
  projectPath?: string;
  gitBranch?: string;
}

export interface AlertRecord {
  id: string;
  severity: "info" | "warning" | "critical";
  objectType: "machine" | "tool" | "agent" | "task";
  objectId: string;
  title: string;
  body: string;
  evidenceSummary: string;
  createdAt: string;
  clearedAt?: string;
}

export interface TaskRecord {
  id: string;
  machineId: string;
  adapter: ToolType;
  agentId?: string;
  workspace?: string;
  task: string;
  mode?: string;
  approvalPolicy?: string;
  status: "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface StateSnapshot {
  generatedAt: string;
  simulatedMode: boolean;
  machines: MachineRecord[];
  tools: ToolInstance[];
  agents: AgentInstance[];
  seats: SeatSnapshot[];
  alerts: AlertRecord[];
  tasks: TaskRecord[];
}

export const EMPTY_CAPABILITIES: CapabilitySet = {
  monitor: false,
  streamEvents: false,
  startTask: false,
  continueTask: false,
  approve: false,
  cancel: false,
  windowObservation: false,
};

export const FULL_SIM_CAPABILITIES: CapabilitySet = {
  monitor: true,
  streamEvents: true,
  startTask: true,
  continueTask: true,
  approve: true,
  cancel: true,
  windowObservation: false,
  notes: ["simulator only"],
};
