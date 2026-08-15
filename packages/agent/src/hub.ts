import type { AgentConfig, MachineInfo, Task, ToolSession } from "@toolmgr/core";
import type { Orchestrator } from "./orchestrator.js";

/** Speaks to a remote hub: push heartbeats and optionally pull aggregate state. */
export class HubClient {
  private timer?: NodeJS.Timeout;

  constructor(
    private config: AgentConfig,
    private orchestrator: Orchestrator,
  ) {}

  start() {
    if (this.config.isHub || !this.config.hubUrl) return;
    const tick = () => void this.heartbeat();
    tick();
    this.timer = setInterval(tick, 5000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async heartbeat() {
    const snap = this.orchestrator.getSnapshot();
    const body = {
      machine: snap.machine as MachineInfo,
      sessions: snap.sessions.filter(
        (s: ToolSession) => s.machineId === this.orchestrator.machineId,
      ),
      tasks: snap.tasks.filter(
        (t: Task) => t.assignedMachineId === this.orchestrator.machineId,
      ),
    };
    try {
      const res = await fetch(`${this.config.hubUrl!.replace(/\/$/, "")}/hub/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-toolmgr-token": this.config.pairingToken,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn("[hub] heartbeat failed", res.status);
      }
    } catch (err) {
      console.warn("[hub] unreachable", err instanceof Error ? err.message : err);
    }
  }
}

/** On hub, mark remotes offline if heartbeat goes stale. */
export function startStaleMachineWatcher(orchestrator: Orchestrator, isHub: boolean) {
  if (!isHub) return () => undefined;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const m of orchestrator.getSnapshot().machines) {
      if (m.id === orchestrator.machineId) continue;
      if (!m.online) continue;
      const age = now - new Date(m.lastSeenAt).getTime();
      if (age > 20_000) orchestrator.markMachineOffline(m.id);
    }
  }, 5000);
  return () => clearInterval(timer);
}
