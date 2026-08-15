import type {
  AttentionReason,
  EventType,
  SessionState,
  Task,
  TaskStatus,
  ToolKind,
  ToolMgrEvent,
  ToolSession,
} from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix?: string): string {
  const id = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function createSession(input: {
  machineId: string;
  tool: ToolKind;
  cwd?: string;
  title?: string;
  state?: SessionState;
  externalId?: string;
  summary?: string;
}): ToolSession {
  const ts = nowIso();
  return {
    id: createId("sess"),
    machineId: input.machineId,
    tool: input.tool,
    cwd: input.cwd,
    title: input.title ?? `${input.tool} session`,
    state: input.state ?? "idle",
    lastEventAt: ts,
    summary: input.summary,
    externalId: input.externalId,
    createdAt: ts,
  };
}

export function createTask(input: {
  prompt: string;
  preferredTools: ToolKind[];
  cwd?: string;
  handoffNotes?: string;
  sourceTaskId?: string;
  assignedMachineId?: string;
  status?: TaskStatus;
}): Task {
  const ts = nowIso();
  return {
    id: createId("task"),
    prompt: input.prompt,
    preferredTools: input.preferredTools,
    cwd: input.cwd,
    status: input.status ?? "queued",
    handoffNotes: input.handoffNotes,
    sourceTaskId: input.sourceTaskId,
    assignedMachineId: input.assignedMachineId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createEvent(input: {
  type: EventType;
  machineId: string;
  sessionId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}): ToolMgrEvent {
  return {
    id: createId("evt"),
    type: input.type,
    machineId: input.machineId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    payload: input.payload,
    createdAt: nowIso(),
  };
}

export function withSessionState(
  session: ToolSession,
  state: SessionState,
  extras?: {
    attentionReason?: AttentionReason;
    summary?: string;
  },
): ToolSession {
  return {
    ...session,
    state,
    attentionReason: extras?.attentionReason,
    summary: extras?.summary ?? session.summary,
    lastEventAt: nowIso(),
  };
}

export function pickTool(
  preferred: ToolKind[],
  available: ToolKind[],
): ToolKind | undefined {
  for (const tool of preferred) {
    if (available.includes(tool)) return tool;
  }
  return available[0];
}

export function buildHandoffPrompt(
  originalPrompt: string,
  notes?: string,
  priorSummary?: string,
): string {
  const parts = [
    "You are continuing work handed off from another coding tool.",
    "",
    "## Original task",
    originalPrompt,
  ];
  if (priorSummary) {
    parts.push("", "## Prior progress", priorSummary);
  }
  if (notes) {
    parts.push("", "## Handoff notes", notes);
  }
  parts.push("", "Continue from here. Be concrete and finish the remaining work.");
  return parts.join("\n");
}
