import { spawn } from "node:child_process";
import {
  createSession,
  withSessionState,
  type SendPromptResult,
  type ToolSession,
} from "@toolmgr/core";
import { focusApp } from "./platform.js";
import type { AdapterContext, AdapterEventHandler, ToolAdapter } from "./types.js";

type CursorAgent = {
  send: (prompt: string) => Promise<{
    stream: () => AsyncIterable<{
      type: string;
      message?: { content: Array<{ type: string; text?: string }> };
    }>;
  }>;
  close?: () => Promise<void> | void;
};

/**
 * Cursor adapter — prefers @cursor/sdk when CURSOR_API_KEY is set;
 * otherwise tracks IDE hook heartbeats and offers focus/launch hints.
 */
export class CursorAdapter implements ToolAdapter {
  kind = "cursor" as const;
  capabilities = {
    observe: true,
    dispatch: true,
    cancel: true,
    approve: false,
  };

  private sessions = new Map<string, ToolSession>();
  private handlers: AdapterEventHandler[] = [];
  private sdk: { Agent: { create: (opts: Record<string, unknown>) => Promise<CursorAgent> } } | null =
    null;
  private agents = new Map<string, CursorAgent>();

  constructor(private ctx: AdapterContext) {}

  onEvent(handler: AdapterEventHandler) {
    this.handlers.push(handler);
  }

  private emit: AdapterEventHandler = (e) => {
    for (const h of this.handlers) h(e);
  };

  async start() {
    if (this.ctx.cursorApiKey) {
      try {
        const mod = (await import("@cursor/sdk")) as {
          Agent: { create: (opts: Record<string, unknown>) => Promise<CursorAgent> };
        };
        this.sdk = mod;
      } catch {
        this.sdk = null;
      }
    }
    const s = createSession({
      machineId: this.ctx.machineId,
      tool: "cursor",
      title: this.sdk ? "Cursor SDK ready" : "Cursor (hooks / observe)",
      cwd: process.cwd(),
      state: "idle",
      summary: this.sdk
        ? "Dispatch via @cursor/sdk"
        : "Waiting for IDE hooks or CURSOR_API_KEY + @cursor/sdk",
    });
    this.sessions.set(s.id, s);
  }

  async stop() {
    for (const a of this.agents.values()) {
      try {
        await a.close?.();
      } catch {
        /* ignore */
      }
    }
    this.agents.clear();
  }

  async listSessions() {
    return [...this.sessions.values()];
  }

  /** Called by agent HTTP hook endpoint from Cursor hooks. */
  ingestHook(payload: {
    event?: string;
    cwd?: string;
    session_id?: string;
    conversation_id?: string;
    status?: string;
    message?: string;
  }) {
    const externalId = payload.session_id ?? payload.conversation_id ?? "ide";
    let session = [...this.sessions.values()].find((s) => s.externalId === externalId);
    if (!session) {
      session = createSession({
        machineId: this.ctx.machineId,
        tool: "cursor",
        title: "Cursor IDE",
        cwd: payload.cwd,
        externalId,
        state: "busy",
      });
      this.sessions.set(session.id, session);
    }

    const eventName = (payload.event ?? "").toLowerCase();
    if (eventName.includes("stop") || payload.status === "idle") {
      const updated = withSessionState(session, "idle", {
        summary: payload.message ?? "Agent stopped",
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
      eventName.includes("before") ||
      eventName.includes("shell") ||
      payload.status === "needs_attention"
    ) {
      const updated = withSessionState(session, "needs_attention", {
        attentionReason: "approval",
        summary: payload.message ?? "Possible approval gate",
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
    const updated = withSessionState(session, "busy", {
      summary: payload.message ?? (eventName || "Cursor busy"),
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

  async sendPrompt(input: {
    prompt: string;
    cwd?: string;
    sessionId?: string;
    title?: string;
  }): Promise<SendPromptResult> {
    if (!this.sdk || !this.ctx.cursorApiKey) {
      // Best-effort: try launching cursor agent CLI if present
      const launched = await this.tryCursorCli(input);
      if (launched) return launched;
      return {
        sessionId: "",
        accepted: false,
        message:
          "Cursor SDK unavailable. Set CURSOR_API_KEY and install @cursor/sdk, or use IDE hooks for observe-only.",
      };
    }

    const session = createSession({
      machineId: this.ctx.machineId,
      tool: "cursor",
      cwd: input.cwd ?? process.cwd(),
      title: input.title ?? "Cursor SDK agent",
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

    void this.runSdkAgent(session, input.prompt, input.cwd ?? process.cwd());
    return { sessionId: session.id, accepted: true };
  }

  private async runSdkAgent(session: ToolSession, prompt: string, cwd: string) {
    try {
      const Agent = this.sdk!.Agent;
      const agent = await Agent.create({
        apiKey: this.ctx.cursorApiKey!,
        model: { id: "composer-2.5" },
        local: { cwd },
      });
      this.agents.set(session.id, agent);
      const run = await agent.send(prompt);
      let text = "";
      for await (const event of run.stream()) {
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) text += block.text;
          }
        }
      }
      const done = withSessionState(session, "idle", {
        summary: (text || "Cursor agent finished").slice(-500),
      });
      this.sessions.set(session.id, done);
      this.emit({
        type: "completed",
        sessionId: session.id,
        state: "idle",
        summary: done.summary,
      });
      await agent.close?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = withSessionState(session, "error", {
        attentionReason: "failed",
        summary: message,
      });
      this.sessions.set(session.id, failed);
      this.emit({
        type: "error",
        sessionId: session.id,
        state: "error",
        error: message,
        summary: message,
      });
    }
  }

  private tryCursorCli(input: {
    prompt: string;
    cwd?: string;
    title?: string;
  }): Promise<SendPromptResult | null> {
    return new Promise((resolve) => {
      const session = createSession({
        machineId: this.ctx.machineId,
        tool: "cursor",
        cwd: input.cwd ?? process.cwd(),
        title: input.title ?? "Cursor CLI",
        state: "busy",
        summary: input.prompt.slice(0, 200),
      });
      const child = spawn(
        "agent",
        ["-p", input.prompt],
        {
          cwd: input.cwd ?? process.cwd(),
          shell: true,
          windowsHide: true,
        },
      );
      let settled = false;
      child.on("error", () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });
      child.on("spawn", () => {
        if (!settled) {
          settled = true;
          this.sessions.set(session.id, session);
          this.emit({
            type: "state",
            sessionId: session.id,
            state: "busy",
            summary: session.summary,
          });
          resolve({ sessionId: session.id, accepted: true, message: "Started via agent CLI" });
        }
      });
      let out = "";
      child.stdout?.on("data", (b) => {
        out += b.toString();
      });
      child.on("exit", (code) => {
        const cur = this.sessions.get(session.id);
        if (!cur) return;
        if (code === 0) {
          const done = withSessionState(cur, "idle", {
            summary: out.slice(-500) || "agent CLI finished",
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
            summary: `agent CLI exit ${code}`,
          });
          this.sessions.set(session.id, failed);
          this.emit({
            type: "error",
            sessionId: session.id,
            state: "error",
            error: failed.summary,
          });
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          resolve(null);
        }
      }, 4000);
    });
  }

  async cancel(sessionId: string) {
    const a = this.agents.get(sessionId);
    if (a) {
      await a.close?.();
      this.agents.delete(sessionId);
    }
    const s = this.sessions.get(sessionId);
    if (s) {
      const updated = withSessionState(s, "idle", { summary: "Cancelled" });
      this.sessions.set(sessionId, updated);
      this.emit({ type: "state", sessionId, state: "idle", summary: "Cancelled" });
    }
  }

  async focusWindow() {
    focusApp("Cursor");
  }
}
