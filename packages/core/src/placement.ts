import type { MachineInfo, SessionState, ToolKind, ToolSession } from "./types.js";

export interface PlacementCandidate {
  machine: MachineInfo;
  session?: ToolSession;
  tool: ToolKind;
  score: number;
}

/** Prefer idle session on same machine + same cwd, then other machines. */
export function rankPlacement(input: {
  preferredTools: ToolKind[];
  cwd?: string;
  sourceMachineId?: string;
  machines: MachineInfo[];
  sessions: ToolSession[];
  availableToolsByMachine: Record<string, ToolKind[]>;
}): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];

  for (const machine of input.machines.filter((m) => m.online)) {
    const tools = input.availableToolsByMachine[machine.id] ?? [];
    for (const tool of input.preferredTools.length ? input.preferredTools : tools) {
      if (!tools.includes(tool)) continue;
      const idleSameCwd = input.sessions.find(
        (s) =>
          s.machineId === machine.id &&
          s.tool === tool &&
          s.state === "idle" &&
          (!!input.cwd ? s.cwd === input.cwd : true),
      );
      const idleAny = input.sessions.find(
        (s) =>
          s.machineId === machine.id &&
          s.tool === tool &&
          s.state === "idle",
      );
      const session = idleSameCwd ?? idleAny;
      let score = 0;
      if (machine.id === input.sourceMachineId) score += 40;
      if (idleSameCwd) score += 30;
      else if (idleAny) score += 15;
      if (session?.state === ("idle" as SessionState)) score += 10;
      if (input.cwd && session?.cwd === input.cwd) score += 10;
      candidates.push({ machine, session, tool, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
