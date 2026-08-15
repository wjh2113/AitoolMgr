import os from "node:os";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  CozeAdapter,
  createAdapters,
  CursorAdapter,
  type ToolAdapter,
} from "@toolmgr/adapters";
import {
  buildHandoffPrompt,
  createEvent,
  createTask,
  nowIso,
  pickTool,
  rankPlacement,
  type AgentConfig,
  type DispatchRequest,
  type HandoffRequest,
  type MachineInfo,
  type Task,
  type ToolKind,
  type ToolMgrEvent,
  type ToolSession,
} from "@toolmgr/core";
import { FeishuNotifier } from "@toolmgr/notify-feishu";
import { Store } from "./store.js";

type Listener = (event: ToolMgrEvent) => void;

export class Orchestrator {
  readonly machineId: string;
  readonly machine: MachineInfo;
  private adapters: ToolAdapter[] = [];
  private listeners = new Set<Listener>();
  private feishu: FeishuNotifier;
  private sessionTask = new Map<string, string>();

  constructor(
    private config: AgentConfig,
    private store: Store,
    machineId: string,
  ) {
    this.machineId = machineId;
    this.machine = {
      id: machineId,
      name: config.machineName,
      host: `${config.host}:${config.port}`,
      os: `${os.platform()}-${os.arch()}`,
      isHub: config.isHub,
      online: true,
      lastSeenAt: nowIso(),
    };
    this.feishu = new FeishuNotifier({
      webhookUrl: config.feishuWebhookUrl,
      secret: config.feishuWebhookSecret,
    });
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: ToolMgrEvent) {
    this.store.insertEvent(event);
    for (const l of this.listeners) l(event);
  }

  async start() {
    this.store.upsertMachine(this.machine);
    this.publish(
      createEvent({
        type: "machine.online",
        machineId: this.machineId,
        payload: { name: this.machine.name },
      }),
    );

    this.adapters = createAdapters({
      machineId: this.machineId,
      cursorApiKey: this.config.cursorApiKey,
      cozePat: this.config.cozePat,
      cozeBotId: this.config.cozeBotId,
      cozeBaseUrl: this.config.cozeBaseUrl,
      dataDir: this.config.dataDir,
    });

    for (const adapter of this.adapters) {
      adapter.onEvent((evt) => this.handleAdapterEvent(adapter, evt));
      await adapter.start();
      for (const session of await adapter.listSessions()) {
        this.store.upsertSession(session);
      }
    }
  }

  async stop() {
    for (const adapter of this.adapters) {
      await adapter.stop();
    }
    this.machine.online = false;
    this.machine.lastSeenAt = nowIso();
    this.store.upsertMachine(this.machine);
    this.publish(
      createEvent({
        type: "machine.offline",
        machineId: this.machineId,
        payload: { name: this.machine.name },
      }),
    );
    await this.feishu.notifyMachine(this.machine.name, false);
  }

  getSnapshot() {
    return {
      machine: this.machine,
      machines: this.store.listMachines(),
      sessions: this.store.listSessions(),
      tasks: this.store.listTasks(),
      events: this.store.listEvents(100),
      adapters: this.adapters.map((a) => ({
        kind: a.kind,
        capabilities: a.capabilities,
      })),
      config: {
        isHub: this.config.isHub,
        hubUrl: this.config.hubUrl,
        feishuConfigured: Boolean(this.config.feishuWebhookUrl),
        host: this.config.host,
        port: this.config.port,
      },
    };
  }

  private getAdapter(kind: ToolKind): ToolAdapter | undefined {
    return this.adapters.find((a) => a.kind === kind);
  }

  availableTools(): ToolKind[] {
    return this.adapters
      .filter((a) => a.capabilities.dispatch)
      .map((a) => a.kind);
  }

  private async handleAdapterEvent(
    adapter: ToolAdapter,
    evt: {
      type: string;
      sessionId?: string;
      state?: ToolSession["state"];
      attentionReason?: ToolSession["attentionReason"];
      summary?: string;
      error?: string;
    },
  ) {
    if (!evt.sessionId) return;
    const sessions = await adapter.listSessions();
    const session = sessions.find((s) => s.id === evt.sessionId);
    if (session) {
      this.store.upsertSession(session);
      this.publish(
        createEvent({
          type: evt.type === "attention" ? "needs_attention" : "session.updated",
          machineId: this.machineId,
          sessionId: session.id,
          payload: {
            state: session.state,
            tool: session.tool,
            summary: session.summary,
          },
        }),
      );
      if (evt.type === "attention" || session.state === "needs_attention") {
        await this.feishu.notifyAttention(session, this.machine.name);
      }
    }

    const taskId = this.sessionTask.get(evt.sessionId);
    if (!taskId) return;
    const task = this.store.getTask(taskId);
    if (!task) return;

    if (evt.type === "completed") {
      const updated: Task = {
        ...task,
        status: "done",
        resultSummary: evt.summary,
        updatedAt: nowIso(),
      };
      this.store.upsertTask(updated);
      this.publish(
        createEvent({
          type: "task.completed",
          machineId: this.machineId,
          taskId: task.id,
          sessionId: evt.sessionId,
          payload: { summary: evt.summary },
        }),
      );
      await this.feishu.notifyTask(updated, "completed");
    } else if (evt.type === "error") {
      const updated: Task = {
        ...task,
        status: "failed",
        error: evt.error ?? evt.summary,
        updatedAt: nowIso(),
      };
      this.store.upsertTask(updated);
      this.publish(
        createEvent({
          type: "task.failed",
          machineId: this.machineId,
          taskId: task.id,
          sessionId: evt.sessionId,
          payload: { error: updated.error },
        }),
      );
      await this.feishu.notifyTask(updated, "failed");
    } else if (evt.type === "attention") {
      const updated: Task = {
        ...task,
        status: "blocked",
        resultSummary: evt.summary,
        updatedAt: nowIso(),
      };
      this.store.upsertTask(updated);
      this.publish(
        createEvent({
          type: "task.updated",
          machineId: this.machineId,
          taskId: task.id,
          sessionId: evt.sessionId,
          payload: { status: "blocked" },
        }),
      );
    }
  }

  async dispatch(req: DispatchRequest): Promise<Task> {
    const preferred =
      req.preferredTools?.length
        ? req.preferredTools
        : req.tool
          ? [req.tool]
          : (["fake", "codex", "cursor", "claude_code", "coze"] as ToolKind[]);

    const localTools = this.availableTools();
    const tool = pickTool(preferred, localTools);
    if (!tool) {
      throw new Error("No dispatch-capable adapter available");
    }

    // Cross-machine: if target machine is remote and we are hub, forward
    if (req.machineId && req.machineId !== this.machineId) {
      const remote = await this.forwardDispatch(req);
      if (remote) return remote;
    }

    const task = createTask({
      prompt: req.prompt,
      preferredTools: preferred,
      cwd: req.cwd,
      handoffNotes: req.handoffNotes,
      sourceTaskId: req.sourceTaskId,
      assignedMachineId: this.machineId,
      status: "running",
    });
    this.store.upsertTask(task);
    this.publish(
      createEvent({
        type: "task.created",
        machineId: this.machineId,
        taskId: task.id,
        payload: { tool, prompt: req.prompt.slice(0, 200) },
      }),
    );

    const adapter = this.getAdapter(tool);
    if (!adapter) throw new Error(`Adapter missing: ${tool}`);

    const result = await adapter.sendPrompt({
      prompt: req.prompt,
      cwd: req.cwd,
      title: `Task ${task.id.slice(0, 8)}`,
    });

    if (!result.accepted) {
      const failed: Task = {
        ...task,
        status: "failed",
        error: result.message ?? "Dispatch rejected",
        updatedAt: nowIso(),
      };
      this.store.upsertTask(failed);
      this.publish(
        createEvent({
          type: "task.failed",
          machineId: this.machineId,
          taskId: task.id,
          payload: { error: failed.error },
        }),
      );
      await this.feishu.notifyTask(failed, "failed");
      return failed;
    }

    const updated: Task = {
      ...task,
      assignedSessionId: result.sessionId,
      updatedAt: nowIso(),
    };
    this.sessionTask.set(result.sessionId, task.id);
    this.store.upsertTask(updated);

    const sessions = await adapter.listSessions();
    for (const s of sessions) this.store.upsertSession(s);

    this.publish(
      createEvent({
        type: "task.updated",
        machineId: this.machineId,
        taskId: task.id,
        sessionId: result.sessionId,
        payload: { status: "running", tool },
      }),
    );
    return updated;
  }

  async handoff(req: HandoffRequest): Promise<Task> {
    const source = this.store.getTask(req.taskId);
    if (!source) throw new Error("Task not found");

    const session = source.assignedSessionId
      ? this.store.getSession(source.assignedSessionId)
      : undefined;

    if (session) {
      const adapter = this.getAdapter(session.tool);
      await adapter?.cancel?.(session.id);
    }

    const blocked: Task = {
      ...source,
      status: "blocked",
      updatedAt: nowIso(),
      handoffNotes: req.notes ?? source.handoffNotes,
    };
    this.store.upsertTask(blocked);

    const prompt = buildHandoffPrompt(
      source.prompt,
      req.notes,
      source.resultSummary ?? session?.summary,
    );

    const next = await this.dispatch({
      prompt,
      tool: req.targetTool,
      preferredTools: [req.targetTool],
      cwd: req.cwd ?? source.cwd,
      machineId: req.targetMachineId,
      handoffNotes: req.notes,
      sourceTaskId: source.id,
    });

    this.publish(
      createEvent({
        type: "handoff",
        machineId: this.machineId,
        taskId: next.id,
        payload: {
          from: source.id,
          to: next.id,
          targetTool: req.targetTool,
        },
      }),
    );
    await this.feishu.notifyTask(
      {
        ...next,
        handoffNotes: `From ${source.id} → ${req.targetTool}`,
      },
      "handoff",
    );
    return next;
  }

  suggestPlacement(preferredTools: ToolKind[], cwd?: string) {
    const machines = this.store.listMachines().filter((m) => m.online);
    const sessions = this.store.listSessions();
    const availableToolsByMachine: Record<string, ToolKind[]> = {};
    for (const m of machines) {
      availableToolsByMachine[m.id] =
        m.id === this.machineId
          ? this.availableTools()
          : (["fake", "codex", "cursor", "claude_code", "coze"] as ToolKind[]);
    }
    return rankPlacement({
      preferredTools,
      cwd,
      sourceMachineId: this.machineId,
      machines,
      sessions,
      availableToolsByMachine,
    });
  }

  ingestClaudeHook(payload: Record<string, unknown>) {
    const adapter = this.getAdapter("claude_code") as ClaudeCodeAdapter | undefined;
    const session = adapter?.ingestHook(payload as never);
    if (session) this.store.upsertSession(session);
    return session;
  }

  ingestCursorHook(payload: Record<string, unknown>) {
    const adapter = this.getAdapter("cursor") as CursorAdapter | undefined;
    const session = adapter?.ingestHook(payload as never);
    if (session) this.store.upsertSession(session);
    return session;
  }

  async approve(sessionId: string, decision: "allow" | "deny") {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const adapter = this.getAdapter(session.tool);
    if (!adapter?.approve) throw new Error("Adapter does not support approve");
    await adapter.approve(sessionId, decision);
    for (const s of await adapter.listSessions()) this.store.upsertSession(s);
  }

  async reply(sessionId: string, text: string) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const adapter = this.getAdapter(session.tool);
    if (!adapter?.reply && !adapter?.sendPrompt) {
      throw new Error("Adapter does not support reply");
    }
    if (adapter.reply) await adapter.reply(sessionId, text);
    else await adapter.sendPrompt({ prompt: text, sessionId, cwd: session.cwd });
  }

  async cancelSession(sessionId: string) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const adapter = this.getAdapter(session.tool);
    await adapter?.cancel?.(sessionId);
    for (const s of (await adapter?.listSessions()) ?? []) this.store.upsertSession(s);
  }

  /** Merge remote machine snapshot into hub store. */
  ingestRemoteSnapshot(input: {
    machine: MachineInfo;
    sessions: ToolSession[];
    tasks?: Task[];
  }) {
    const machine = { ...input.machine, online: true, lastSeenAt: nowIso() };
    this.store.upsertMachine(machine);
    for (const s of input.sessions) this.store.upsertSession(s);
    for (const t of input.tasks ?? []) this.store.upsertTask(t);
    this.publish(
      createEvent({
        type: "heartbeat",
        machineId: machine.id,
        payload: { name: machine.name, sessions: input.sessions.length },
      }),
    );
  }

  markMachineOffline(machineId: string) {
    const m = this.store.getMachine(machineId);
    if (!m || !m.online) return;
    const updated = { ...m, online: false, lastSeenAt: nowIso() };
    this.store.upsertMachine(updated);
    this.publish(
      createEvent({
        type: "machine.offline",
        machineId,
        payload: { name: m.name },
      }),
    );
    void this.feishu.notifyMachine(m.name, false);
  }

  private async forwardDispatch(req: DispatchRequest): Promise<Task | null> {
    if (!this.config.isHub) return null;
    // Hub keeps local record; remote agents pull via /hub/pull-tasks in a fuller design.
    // For v1: try HTTP forward to machine host if known.
    const machine = this.store.getMachine(req.machineId!);
    if (!machine || machine.id === this.machineId) return null;
    const base = machine.host.includes("://")
      ? machine.host
      : `http://${machine.host}`;
    try {
      const res = await fetch(`${base}/api/dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-toolmgr-token": this.config.pairingToken,
        },
        body: JSON.stringify({ ...req, machineId: undefined }),
      });
      if (!res.ok) return null;
      const task = (await res.json()) as Task;
      this.store.upsertTask(task);
      return task;
    } catch {
      return null;
    }
  }

  private _refs = { CodexAdapter, CozeAdapter };

  async testFeishu() {
    return this.feishu.notifyEvent(
      createEvent({
        type: "heartbeat",
        machineId: this.machineId,
        payload: { test: true },
      }),
      `ToolMgr test notification from ${this.machine.name}`,
    );
  }
}
