export type ToolKind = "cursor" | "codex" | "claude_code" | "coze" | "fake";

export type SessionState =
  | "offline"
  | "idle"
  | "busy"
  | "needs_attention"
  | "error";

export type AttentionReason =
  | "approval"
  | "question"
  | "failed"
  | "completed";

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "done"
  | "failed";

export interface MachineInfo {
  id: string;
  name: string;
  host: string;
  os: string;
  isHub: boolean;
  online: boolean;
  lastSeenAt: string;
}

export interface ToolSession {
  id: string;
  machineId: string;
  tool: ToolKind;
  cwd?: string;
  title?: string;
  state: SessionState;
  attentionReason?: AttentionReason;
  lastEventAt: string;
  summary?: string;
  externalId?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  prompt: string;
  preferredTools: ToolKind[];
  cwd?: string;
  status: TaskStatus;
  assignedSessionId?: string;
  assignedMachineId?: string;
  handoffNotes?: string;
  sourceTaskId?: string;
  resultSummary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type EventType =
  | "session.started"
  | "session.updated"
  | "state.changed"
  | "needs_attention"
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.failed"
  | "handoff"
  | "machine.online"
  | "machine.offline"
  | "error"
  | "heartbeat";

export interface ToolMgrEvent {
  id: string;
  type: EventType;
  machineId: string;
  sessionId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface DispatchRequest {
  prompt: string;
  tool?: ToolKind;
  preferredTools?: ToolKind[];
  cwd?: string;
  machineId?: string;
  handoffNotes?: string;
  sourceTaskId?: string;
}

export interface HandoffRequest {
  taskId: string;
  targetTool: ToolKind;
  targetMachineId?: string;
  notes?: string;
  cwd?: string;
}

export interface AgentConfig {
  port: number;
  host: string;
  dataDir: string;
  machineName: string;
  pairingToken: string;
  hubUrl?: string;
  isHub: boolean;
  feishuWebhookUrl?: string;
  feishuWebhookSecret?: string;
  cursorApiKey?: string;
  cozePat?: string;
  cozeBotId?: string;
  cozeBaseUrl?: string;
}

export interface AdapterCapabilities {
  observe: boolean;
  dispatch: boolean;
  cancel: boolean;
  approve: boolean;
}

export interface SendPromptResult {
  sessionId: string;
  externalId?: string;
  accepted: boolean;
  message?: string;
}

export const TOOL_LABELS: Record<ToolKind, string> = {
  cursor: "Cursor",
  codex: "Codex",
  claude_code: "Claude Code",
  coze: "Coze",
  fake: "Fake",
};

export const STATE_LABELS: Record<SessionState, string> = {
  offline: "Offline",
  idle: "Idle",
  busy: "Busy",
  needs_attention: "Needs attention",
  error: "Error",
};
