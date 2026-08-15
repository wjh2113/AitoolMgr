import type {
  CapabilitySet,
  TelemetryEvent,
  ToolInstance,
  ToolType,
} from "@aitoolmgr/contracts";

export type EventSink = (event: TelemetryEvent) => void;

export interface Disposable {
  dispose(): void;
}

export interface StartTaskRequest {
  machineId: string;
  toolInstanceId: string;
  agentId?: string;
  workspace?: string;
  task: string;
  mode?: string;
  approvalPolicy?: string;
  timeoutMinutes?: number;
}

export interface ContinueTaskRequest {
  taskId: string;
  input: string;
}

export interface ApprovalDecision {
  taskId: string;
  decision: "allow" | "deny";
  reason?: string;
}

export interface TaskHandle {
  taskId: string;
  accepted: boolean;
  message?: string;
}

export interface ToolAdapter {
  id: string;
  discover(): Promise<ToolInstance[]>;
  capabilities(instance: ToolInstance): Promise<CapabilitySet>;
  snapshot(instance: ToolInstance): Promise<{
    stateSummary: string;
    simulated?: boolean;
  }>;
  subscribe(instance: ToolInstance, sink: EventSink): Promise<Disposable>;
  startTask?(request: StartTaskRequest): Promise<TaskHandle>;
  continueTask?(request: ContinueTaskRequest): Promise<void>;
  approve?(request: ApprovalDecision): Promise<void>;
  cancelTask?(taskId: string): Promise<void>;
}

export type AdapterFactory = () => ToolAdapter;

export function unsupportedCapabilities(notes: string[]): CapabilitySet {
  return {
    monitor: false,
    streamEvents: false,
    startTask: false,
    continueTask: false,
    approve: false,
    cancel: false,
    windowObservation: false,
    notes,
  };
}

export function toolLabel(t: ToolType): string {
  switch (t) {
    case "openclaw":
      return "OpenClaw";
    case "cursor_cli":
      return "Cursor CLI";
    case "claude_code":
      return "Claude Code";
    default:
      return t.charAt(0).toUpperCase() + t.slice(1);
  }
}
