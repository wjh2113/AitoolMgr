import { spawn } from "node:child_process";
import {
  createSession,
  withSessionState,
  type SendPromptResult,
  type ToolSession,
} from "@toolmgr/core";
import { commandExists } from "./platform.js";
import type { AdapterContext, AdapterEventHandler, ToolAdapter } from "./types.js";

/** Claude Code — observe via hooks HTTP ingest; dispatch via `claude -p`. */
export class ClaudeCodeAdapter implements ToolAdapter {
  kind = "claude_code" as const;
  capabilities = {
    observe: true,
    dispatch: true,
    cancel: true,
    approve: false,
  };

  private sessions = new Map<string, ToolSession>();
  private handlers: AdapterEventHandler[] = [];
  private procs = new Map<string, ReturnType<typeof spawn>>();
  private available = false;

  constructor(private ctx: AdapterContext) {}

  onEvent(handler: AdapterEventHandler) {
    this.handlers.push(handler);
  }

  private emit: AdapterEventHandler = (e) => {
    for (const h of this.handlers) h(e);
  };

  async start() {
    this.available = await this.hasClaude();
    const s = createSession({
      machineId: this.ctx.machineId,
      tool: "claude_code",
      title: this.available ? "Claude Code ready" : "Claude Code (hooks only)",
      cwd: process.cwd(),
      state: this.available ? "idle" : "offline",
      summary: this.available
        ? "claude CLI detected"
        : "Install Claude Code CLI; hooks can still report IDE/TUI sessions",
    });
    this.sessions.set(s.id, s);
  }

  async stop() {
    for (const p of this.procs.values()) {
      try {
        p.kill();
      } catch {
        /* ignore */
      }
    }
    this.procs.clear();
  }

  async listSessions() {
    return [...this.sessions.values()];
  }

  private hasClaude(): Promise<boolean> {
    return Promise.resolve(commandExists("claude"));
  }

  ingestHook(payload: {
    hook_event_name?: string;
    session_id?: string;
    cwd?: string;
    message?: string;
    notification_type?: string;
  }) {
    const externalId = payload.session_id ?? "claude-default";
    let session = [...this.sessions.values()].find((s) => s.externalId === externalId);
    if (!session) {
      session = createSession({
        machineId: this.ctx.machineId,
        tool: "claude_code",
        title: "Claude Code session",
        cwd: payload.cwd,
        externalId,
        state: "busy",
      });
      this.sessions.set(session.id, session);
    }

    const name = (payload.hook_event_name ?? "").toLowerCase();
    if (name === "stop" || name === "sessionend") {
      const updated = withSessionState(session, "idle", {
        summary: payload.message ?? "Claude stopped",
      });
      this.sessions.set(session.id, updated);
      this.emit({
        type: "completed",
        sessionId: session.id,
        state: "idle",
        summary: updated.summary,
      });
      return updated;
    }
    if (
      name === "notification" ||
      name.includes("permission") ||
      payload.notification_type === "permission_prompt"
    ) {
      const updated = withSessionState(session, "needs_attention", {
        attentionReason: "approval",
        summary: payload.message ?? "Claude needs attention",
      });
      this.sessions.set(session.id, updated);
      this.emit({
        type: "attention",
        sessionId: session.id,
        state: "needs_attention",
        attentionReason: "approval",
        summary: updated.summary,
      });
      return updated;
    }
    if (name === "sessionstart" || name === "userpromptsubmit" || name.includes("tool")) {
      const updated = withSessionState(session, "busy", {
        summary: payload.message ?? (name || "Claude busy"),
      });
      this.sessions.set(session.id, updated);
      this.emit({
        type: "state",
        sessionId: session.id,
        state: "busy",
        summary: updated.summary,
      });
      return updated;
    }
    return session;
  }

  async sendPrompt(input: {
    prompt: string;
    cwd?: string;
    sessionId?: string;
    title?: string;
  }): Promise<SendPromptResult> {
    if (!this.available) {
      return {
        sessionId: "",
        accepted: false,
        message: "Claude Code CLI not available",
      };
    }

    const session = createSession({
      machineId: this.ctx.machineId,
      tool: "claude_code",
      cwd: input.cwd ?? process.cwd(),
      title: input.title ?? "Claude headless",
      state: "busy",
      summary: input.prompt.slice(0, 200),
    });
    this.sessions.set(session.id, session);
    this.emit({
      type: "state",
      sessionId: session.id,
      state: "busy",
      summary: session.summary,
    });

    const child = spawn(
      "claude",
      ["-p", input.prompt, "--output-format", "text"],
      {
        cwd: input.cwd ?? process.cwd(),
        shell: true,
        windowsHide: true,
        env: process.env,
      },
    );
    this.procs.set(session.id, child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr?.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("exit", (code) => {
      this.procs.delete(session.id);
      const cur = this.sessions.get(session.id);
      if (!cur) return;
      if (code === 0) {
        const done = withSessionState(cur, "idle", {
          summary: (stdout || "Claude finished").slice(-500),
        });
        this.sessions.set(session.id, done);
        this.emit({
          type: "completed",
          sessionId: session.id,
          state: "idle",
          summary: done.summary,
        });
      } else {
        const failed = withSessionState(cur, "error", {
          attentionReason: "failed",
          summary: (stderr || stdout || `exit ${code}`).slice(-500),
        });
        this.sessions.set(session.id, failed);
        this.emit({
          type: "error",
          sessionId: session.id,
          state: "error",
          error: failed.summary,
          summary: failed.summary,
        });
      }
    });

    return { sessionId: session.id, accepted: true };
  }

  async cancel(sessionId: string) {
    const p = this.procs.get(sessionId);
    if (p) {
      p.kill();
      this.procs.delete(sessionId);
    }
    const s = this.sessions.get(sessionId);
    if (s) {
      const updated = withSessionState(s, "idle", { summary: "Cancelled" });
      this.sessions.set(sessionId, updated);
      this.emit({ type: "state", sessionId, state: "idle", summary: "Cancelled" });
    }
  }

  async reply(sessionId: string, text: string) {
    await this.sendPrompt({ prompt: text, sessionId });
  }
}
