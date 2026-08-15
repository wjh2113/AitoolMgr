import { OfficeEngine, SimulatorAdapter } from "@aitoolmgr/adapter-sdk";
import type { StateSnapshot } from "@aitoolmgr/contracts";
import type { AgentConfig } from "@toolmgr/core";
import type { Store } from "./store.js";

export function simulatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.TOOLMGR_SIMULATOR ?? "true").toLowerCase();
  return v !== "false" && v !== "0";
}

export async function startOfficeEngine(input: {
  machineId: string;
  machineName: string;
  os: string;
  config: AgentConfig;
  store: Store;
}) {
  const enabled = simulatorEnabled();
  const machine = {
    id: input.machineId,
    name: input.machineName,
    os: input.os,
    online: true,
    lastSeenAt: new Date().toISOString(),
    agentVersion: "0.1.0",
  };
  const adapters = enabled ? [new SimulatorAdapter(input.machineId)] : [];
  const engine = new OfficeEngine(machine, adapters, enabled, {
    upsertTool: (t) => input.store.upsertOfficeTool(t),
    upsertAgent: (a) => input.store.upsertOfficeAgent(a),
    upsertSeat: (s) => input.store.upsertSeat(s),
    insertTelemetry: (e) => input.store.insertTelemetry(e),
    upsertAlert: (a) => input.store.upsertAlert(a),
    loadSeats: () => input.store.listSeats(),
    loadAlerts: () => input.store.listOpenAlerts(),
  });
  await engine.start();
  return engine;
}

export type { StateSnapshot };
