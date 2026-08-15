import {
  createSession,
  nowIso,
  withSessionState,
  type SendPromptResult,
  type ToolSession,
} from "@toolmgr/core";
import type { AdapterContext, AdapterEventHandler, ToolAdapter } from "./types.js";

/** Deterministic adapter for UI/dev and when real tools are unavailable. */
export class FakeAdapter implements ToolAdapter {
  kind = "fake" as const;
  capabilities = {
    observe: true,
    dispatch: true,
    cancel: true,
    approve: true,
  };

  private sessions = new Map<string, ToolSession>();
  private handlers: AdapterEventHandler[] = [];
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private ctx: AdapterContext) {}

  onEvent(handler: AdapterEventHandler) {
    this.handlers.push(handler);
  }

  private emit: AdapterEventHandler = (event) => {
    for (const h of this.handlers) h(event);
  };

  async start() {
    if (this.sessions.size === 0) {
      const s = createSession({
        machineId: this.ctx.machineId,
        tool: "fake",
        title: "Fake demo session",
        cwd: process.cwd(),
        state: "idle",
      });
      this.sessions.set(s.id, s);
    }
  }

  async stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  async listSessions() {
    return [...this.sessions.values()];
  }

  async sendPrompt(input: {
    prompt: string;
    cwd?: string;
    sessionId?: string;
    title?: string;
  }): Promise<SendPromptResult> {
    let session = input.sessionId
      ? this.sessions.get(input.sessionId)
      : undefined;
    if (!session) {
      session = createSession({
        machineId: this.ctx.machineId,
        tool: "fake",
        cwd: input.cwd ?? process.cwd(),
        title: input.title ?? "Fake task",
        state: "busy",
        summary: input.prompt.slice(0, 200),
      });
      this.sessions.set(session.id, session);
    } else {
      session = withSessionState(session, "busy", {
        summary: input.prompt.slice(0, 200),
      });
      this.sessions.set(session.id, session);
    }

    this.emit({
      type: "state",
      sessionId: session.id,
      state: "busy",
      summary: session.summary,
    });

    const sessionId = session.id;
    const needsAttention = /approve|permission|confirm/i.test(input.prompt);

    const timer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current) return;
      if (needsAttention) {
        const updated = withSessionState(current, "needs_attention", {
          attentionReason: "approval",
          summary: `Waiting for approval: ${input.prompt.slice(0, 120)}`,
        });
        this.sessions.set(sessionId, updated);
        this.emit({
          type: "attention",
          sessionId,
          state: "needs_attention",
          attentionReason: "approval",
          summary: updated.summary,
        });
        return;
      }
      const done = withSessionState(current, "idle", {
        summary: `Completed fake run at ${nowIso()}: ${input.prompt.slice(0, 100)}`,
      });
      this.sessions.set(sessionId, done);
      this.emit({
        type: "completed",
        sessionId,
        state: "idle",
        summary: done.summary,
      });
    }, 2500);
    this.timers.set(sessionId, timer);

    return { sessionId, accepted: true, message: "Fake adapter accepted prompt" };
  }

  async cancel(sessionId: string) {
    const t = this.timers.get(sessionId);
    if (t) clearTimeout(t);
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const updated = withSessionState(s, "idle", { summary: "Cancelled" });
    this.sessions.set(sessionId, updated);
    this.emit({ type: "state", sessionId, state: "idle", summary: "Cancelled" });
  }

  async approve(sessionId: string, decision: "allow" | "deny") {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (decision === "deny") {
      const updated = withSessionState(s, "error", {
        attentionReason: "failed",
        summary: "Denied by user",
      });
      this.sessions.set(sessionId, updated);
      this.emit({
        type: "error",
        sessionId,
        state: "error",
        error: "Denied",
      });
      return;
    }
    const updated = withSessionState(s, "idle", {
      summary: "Approved and finished",
    });
    this.sessions.set(sessionId, updated);
    this.emit({
      type: "completed",
      sessionId,
      state: "idle",
      summary: updated.summary,
    });
  }

  async reply(sessionId: string, text: string) {
    await this.sendPrompt({ prompt: text, sessionId });
  }
}
