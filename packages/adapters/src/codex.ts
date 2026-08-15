import { spawn } from "node:child_process";
import {
  createSession,
  withSessionState,
  type SendPromptResult,
  type ToolSession,
} from "@toolmgr/core";
import { commandExists } from "./platform.js";
import type { AdapterContext, AdapterEventHandler, ToolAdapter } from "./types.js";

/**
 * Codex adapter.
 * Prefers `codex exec` CLI when available; falls back to tracked local sessions.
 * When openai_codex SDK is installed in the environment, agent can wrap it later.
 */
export class CodexAdapter implements ToolAdapter {
  kind = "codex" as const;
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
    this.available = await this.hasCodex();
    const s = createSession({
      machineId: this.ctx.machineId,
      tool: "codex",
      title: this.available ? "Codex (CLI ready)" : "Codex (CLI not found)",
      cwd: process.cwd(),
      state: this.available ? "idle" : "offline",
      summary: this.available
        ? "codex binary detected"
        : "Install Codex CLI to enable dispatch",
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

  private hasCodex(): Promise<boolean> {
    return Promise.resolve(commandExists("codex"));
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
        message: "Codex CLI not available on this machine",
      };
    }

    const session = createSession({
      machineId: this.ctx.machineId,
      tool: "codex",
      cwd: input.cwd ?? process.cwd(),
      title: input.title ?? "Codex run",
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

    const cwd = input.cwd ?? process.cwd();
    const child = spawn(
      "codex",
      ["exec", "--skip-git-repo-check", input.prompt],
      {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
      },
    );
    this.procs.set(session.id, child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf) => {
      stdout += buf.toString();
      const summary = stdout.slice(-400);
      const cur = this.sessions.get(session.id);
      if (cur) {
        this.sessions.set(session.id, { ...cur, summary, lastEventAt: new Date().toISOString() });
      }
    });
    child.stderr?.on("data", (buf) => {
      stderr += buf.toString();
    });
    child.on("exit", (code) => {
      this.procs.delete(session.id);
      const cur = this.sessions.get(session.id);
      if (!cur) return;
      if (code === 0) {
        const done = withSessionState(cur, "idle", {
          summary: (stdout || "Codex finished").slice(-500),
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
}
