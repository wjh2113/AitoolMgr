import {
  fuseEvent,
  maybeMarkStalled,
  type AgentInstance,
  type AlertRecord,
  type MachineRecord,
  type SeatSnapshot,
  type StateSnapshot,
  type TelemetryEvent,
  type ToolInstance,
} from "@aitoolmgr/contracts";
import type { Disposable, ToolAdapter } from "./types.js";

export interface OfficePersistence {
  upsertTool?(tool: ToolInstance): void;
  upsertAgent?(agent: AgentInstance): void;
  upsertSeat?(seat: SeatSnapshot): void;
  insertTelemetry?(event: TelemetryEvent): void;
  upsertAlert?(alert: AlertRecord): void;
  loadSeats?(): SeatSnapshot[];
  loadAlerts?(): AlertRecord[];
}

export class OfficeEngine {
  private seats = new Map<string, SeatSnapshot>();
  private tools: ToolInstance[] = [];
  private agents: AgentInstance[] = [];
  private alerts: AlertRecord[] = [];
  private disposables: Disposable[] = [];
  private listeners = new Set<(snap: StateSnapshot) => void>();

  constructor(
    private machine: MachineRecord,
    private adapters: ToolAdapter[],
    private simulatedMode: boolean,
    private persistence?: OfficePersistence,
  ) {}

  onChange(fn: (snap: StateSnapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  async start() {
    for (const seat of this.persistence?.loadSeats?.() ?? []) {
      this.seats.set(seat.seatId, seat);
    }
    for (const alert of this.persistence?.loadAlerts?.() ?? []) {
      this.alerts.push(alert);
    }

    for (const adapter of this.adapters) {
      const instances = await adapter.discover();
      this.tools.push(...instances);
      for (const instance of instances) {
        this.persistence?.upsertTool?.(instance);
        if (instance.toolType === "openclaw") {
          for (const key of ["main", "researcher", "coder"]) {
            const agent: AgentInstance = {
              id: `${instance.id}:${key}`,
              machineId: this.machine.id,
              toolInstanceId: instance.id,
              agentKey: key,
              displayName: key,
            };
            this.agents.push(agent);
            this.persistence?.upsertAgent?.(agent);
          }
        }
        const d = await adapter.subscribe(instance, (event) => this.ingest(event));
        this.disposables.push(d);
      }
    }
    this.emit();
  }

  stop() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  ingest(event: TelemetryEvent) {
    this.persistence?.insertTelemetry?.(event);

    const seatId = event.agentId
      ? `${event.toolInstanceId}:${event.agentId}`
      : event.toolInstanceId;
    const tool = this.tools.find((t) => t.id === event.toolInstanceId);
    const prev = this.seats.get(seatId);
    let next = fuseEvent(prev, event);
    if (tool) {
      next = {
        ...next,
        capabilities: tool.capabilities,
        title: next.title || tool.displayName,
      };
    }
    next = maybeMarkStalled(next, Date.now());
    this.seats.set(seatId, next);
    this.persistence?.upsertSeat?.(next);

    if (next.needsAttention) {
      const alertId = `alert:${seatId}:${next.state}`;
      if (!this.alerts.some((a) => a.id === alertId && !a.clearedAt)) {
        const alert: AlertRecord = {
          id: alertId,
          severity: next.state === "FAILED" ? "critical" : "warning",
          objectType: event.agentId ? "agent" : "tool",
          objectId: seatId,
          title: `${next.title} · ${next.state}`,
          body: next.summary || "Needs attention",
          evidenceSummary: next.evidenceSummary || next.evidenceType,
          createdAt: new Date().toISOString(),
        };
        this.alerts.unshift(alert);
        this.alerts = this.alerts.slice(0, 50);
        this.persistence?.upsertAlert?.(alert);
      }
    } else {
      this.alerts = this.alerts.map((a) => {
        if (a.objectId === seatId && !a.clearedAt) {
          const cleared = { ...a, clearedAt: new Date().toISOString() };
          this.persistence?.upsertAlert?.(cleared);
          return cleared;
        }
        return a;
      });
    }
    this.emit();
  }

  snapshot(): StateSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      simulatedMode: this.simulatedMode,
      machines: [this.machine],
      tools: this.tools,
      agents: this.agents,
      seats: [...this.seats.values()].sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
      alerts: this.alerts.filter((a) => !a.clearedAt).slice(0, 20),
      tasks: [],
    };
  }
}
