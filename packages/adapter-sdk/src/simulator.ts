import {
  FULL_SIM_CAPABILITIES,
  type TelemetryEvent,
  type ToolInstance,
  type UnifiedState,
} from "@aitoolmgr/contracts";
import type {
  ApprovalDecision,
  ContinueTaskRequest,
  Disposable,
  EventSink,
  StartTaskRequest,
  TaskHandle,
  ToolAdapter,
} from "./types.js";

const CYCLE: UnifiedState[] = [
  "IDLE",
  "STARTING",
  "THINKING",
  "EXECUTING",
  "WAITING_APPROVAL",
  "WAITING_INPUT",
  "SUCCEEDED",
  "FAILED",
  "STALLED",
  "UNKNOWN",
  "OFFLINE",
];

/**
 * Development-only adapter. Always sets simulated=true.
 * Production builds should keep TOOLMGR_SIMULATOR=false.
 */
export class SimulatorAdapter implements ToolAdapter {
  id = "simulator";
  private sinks = new Map<string, EventSink>();
  private timers = new Map<string, NodeJS.Timeout>();
  private machineId: string;

  constructor(machineId: string) {
    this.machineId = machineId;
  }

  async discover(): Promise<ToolInstance[]> {
    return [
      {
        id: "sim-codex",
        machineId: this.machineId,
        toolType: "codex",
        displayName: "Codex (simulated)",
        capabilities: FULL_SIM_CAPABILITIES,
        simulated: true,
        version: "sim-1",
      },
      {
        id: "sim-cursor",
        machineId: this.machineId,
        toolType: "cursor",
        displayName: "Cursor (simulated)",
        capabilities: FULL_SIM_CAPABILITIES,
        simulated: true,
        version: "sim-1",
      },
      {
        id: "sim-openclaw-gw",
        machineId: this.machineId,
        toolType: "openclaw",
        displayName: "OpenClaw Gateway (simulated)",
        capabilities: FULL_SIM_CAPABILITIES,
        simulated: true,
        version: "sim-1",
      },
    ];
  }

  async capabilities(instance: ToolInstance) {
    return instance.capabilities;
  }

  async snapshot(instance: ToolInstance) {
    return {
      stateSummary: `${instance.displayName} simulated snapshot`,
      simulated: true,
    };
  }

  async subscribe(instance: ToolInstance, sink: EventSink): Promise<Disposable> {
    this.sinks.set(instance.id, sink);
    if (instance.toolType === "openclaw") {
      for (const agent of ["main", "researcher", "coder"]) {
        this.emit(instance, agent, "IDLE", "sim.boot");
      }
      let i = 0;
      const timer = setInterval(() => {
        const agent = ["main", "researcher", "coder"][i % 3]!;
        const state = CYCLE[i % CYCLE.length]!;
        this.emit(instance, agent, state, "sim.cycle");
        i += 1;
      }, 3500);
      this.timers.set(instance.id, timer);
    } else {
      let i = 0;
      const timer = setInterval(() => {
        const state = CYCLE[i % CYCLE.length]!;
        this.emit(instance, undefined, state, "sim.cycle");
        i += 1;
      }, 4500);
      this.timers.set(instance.id, timer);
    }
    return {
      dispose: () => {
        const t = this.timers.get(instance.id);
        if (t) clearInterval(t);
        this.timers.delete(instance.id);
        this.sinks.delete(instance.id);
      },
    };
  }

  private emit(
    instance: ToolInstance,
    agentId: string | undefined,
    state: UnifiedState,
    evidenceType: string,
  ) {
    const sink = this.sinks.get(instance.id);
    if (!sink) return;
    const needsAttention =
      state === "WAITING_APPROVAL" ||
      state === "WAITING_INPUT" ||
      state === "FAILED" ||
      state === "STALLED";
    const event: TelemetryEvent = {
      eventId: globalThis.crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      machineId: this.machineId,
      toolType: instance.toolType,
      toolInstanceId: instance.id,
      agentId,
      state,
      activity: evidenceType,
      summary: `Simulated ${state}${agentId ? ` for ${agentId}` : ""}`,
      needsAttention,
      confidence: state === "UNKNOWN" ? 0 : 1,
      evidenceSource: "simulated",
      evidenceType,
      evidenceSummary:
        state === "UNKNOWN"
          ? "Simulator demonstrating UNKNOWN (no forged vendor event)"
          : `simulator emitted ${state}`,
      sensitivity: "metadata_only",
      simulated: true,
    };
    sink(event);
  }

  async startTask(request: StartTaskRequest): Promise<TaskHandle> {
    const taskId = `sim-task-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const instanceId = request.toolInstanceId;
    const sink = this.sinks.get(instanceId);
    if (sink) {
      const base = {
        eventId: globalThis.crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        machineId: request.machineId,
        toolType: "simulator" as const,
        toolInstanceId: instanceId,
        agentId: request.agentId,
        taskId,
        confidence: 1,
        evidenceSource: "simulated" as const,
        evidenceType: "sim.startTask",
        sensitivity: "metadata_only" as const,
        simulated: true,
      };
      sink({
        ...base,
        state: "STARTING",
        summary: request.task.slice(0, 120),
        needsAttention: false,
      });
      setTimeout(() => {
        sink({
          ...base,
          eventId: globalThis.crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          state: "EXECUTING",
          summary: "Simulated execution",
          needsAttention: false,
        });
      }, 800);
    }
    return { taskId, accepted: true, message: "simulated" };
  }

  async continueTask(_request: ContinueTaskRequest): Promise<void> {}

  async approve(request: ApprovalDecision): Promise<void> {
    for (const sink of this.sinks.values()) {
      sink({
        eventId: globalThis.crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        machineId: this.machineId,
        toolType: "simulator",
        toolInstanceId: "sim-openclaw-gw",
        taskId: request.taskId,
        state: request.decision === "allow" ? "EXECUTING" : "FAILED",
        summary: `Simulated approval ${request.decision}`,
        needsAttention: request.decision === "deny",
        confidence: 1,
        evidenceSource: "simulated",
        evidenceType: "sim.approve",
        sensitivity: "metadata_only",
        simulated: true,
      });
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    for (const sink of this.sinks.values()) {
      sink({
        eventId: globalThis.crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        machineId: this.machineId,
        toolType: "simulator",
        toolInstanceId: "sim-openclaw-gw",
        taskId,
        state: "IDLE",
        summary: "Simulated cancel",
        needsAttention: false,
        confidence: 1,
        evidenceSource: "simulated",
        evidenceType: "sim.cancel",
        sensitivity: "metadata_only",
        simulated: true,
      });
    }
  }
}
