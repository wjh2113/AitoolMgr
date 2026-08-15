import {
  createSession,
  withSessionState,
  type SendPromptResult,
  type ToolSession,
} from "@toolmgr/core";
import type { AdapterContext, AdapterEventHandler, ToolAdapter } from "./types.js";

/** Coze cloud API adapter (PAT + bot_id). */
export class CozeAdapter implements ToolAdapter {
  kind = "coze" as const;
  capabilities = {
    observe: true,
    dispatch: true,
    cancel: false,
    approve: false,
  };

  private sessions = new Map<string, ToolSession>();
  private handlers: AdapterEventHandler[] = [];
  private pollers = new Map<string, NodeJS.Timeout>();

  constructor(private ctx: AdapterContext) {}

  onEvent(handler: AdapterEventHandler) {
    this.handlers.push(handler);
  }

  private emit: AdapterEventHandler = (e) => {
    for (const h of this.handlers) h(e);
  };

  private get enabled() {
    return Boolean(this.ctx.cozePat && this.ctx.cozeBotId);
  }

  private get baseUrl() {
    return (this.ctx.cozeBaseUrl || "https://api.coze.cn").replace(/\/$/, "");
  }

  async start() {
    const s = createSession({
      machineId: this.ctx.machineId,
      tool: "coze",
      title: this.enabled ? "Coze bot ready" : "Coze (configure PAT + bot)",
      state: this.enabled ? "idle" : "offline",
      summary: this.enabled
        ? `bot ${this.ctx.cozeBotId}`
        : "Set COZE_PAT and COZE_BOT_ID",
    });
    this.sessions.set(s.id, s);
  }

  async stop() {
    for (const t of this.pollers.values()) clearInterval(t);
    this.pollers.clear();
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
    if (!this.enabled) {
      return {
        sessionId: "",
        accepted: false,
        message: "Coze not configured (COZE_PAT / COZE_BOT_ID)",
      };
    }

    const session = createSession({
      machineId: this.ctx.machineId,
      tool: "coze",
      cwd: input.cwd,
      title: input.title ?? "Coze chat",
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

    try {
      const res = await fetch(`${this.baseUrl}/v3/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.ctx.cozePat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bot_id: this.ctx.cozeBotId,
          user_id: `toolmgr-${this.ctx.machineId}`,
          stream: false,
          auto_save_history: true,
          additional_messages: [
            {
              role: "user",
              content: input.prompt,
              content_type: "text",
            },
          ],
        }),
      });
      const json = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: {
          id?: string;
          conversation_id?: string;
          status?: string;
        };
      };
      if (!res.ok || (json.code !== undefined && json.code !== 0)) {
        throw new Error(json.msg || `Coze HTTP ${res.status}`);
      }

      const chatId = json.data?.id;
      const conversationId = json.data?.conversation_id;
      session.externalId = chatId;
      this.sessions.set(session.id, {
        ...session,
        externalId: chatId,
        summary: `chat ${chatId} / conv ${conversationId}`,
      });

      if (json.data?.status === "completed") {
        const done = withSessionState(session, "idle", {
          summary: "Coze chat completed",
        });
        this.sessions.set(session.id, done);
        this.emit({
          type: "completed",
          sessionId: session.id,
          state: "idle",
          summary: done.summary,
        });
      } else if (chatId && conversationId) {
        this.pollChat(session.id, conversationId, chatId);
      } else {
        const done = withSessionState(session, "idle", {
          summary: "Coze accepted chat",
        });
        this.sessions.set(session.id, done);
        this.emit({
          type: "completed",
          sessionId: session.id,
          state: "idle",
          summary: done.summary,
        });
      }

      return { sessionId: session.id, externalId: chatId, accepted: true };
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
      return { sessionId: session.id, accepted: false, message };
    }
  }

  private pollChat(sessionId: string, conversationId: string, chatId: string) {
    const existing = this.pollers.get(sessionId);
    if (existing) clearInterval(existing);

    let ticks = 0;
    const timer = setInterval(async () => {
      ticks += 1;
      if (ticks > 60) {
        clearInterval(timer);
        this.pollers.delete(sessionId);
        const cur = this.sessions.get(sessionId);
        if (cur && cur.state === "busy") {
          const updated = withSessionState(cur, "needs_attention", {
            attentionReason: "question",
            summary: "Coze poll timeout — check bot console",
          });
          this.sessions.set(sessionId, updated);
          this.emit({
            type: "attention",
            sessionId,
            state: "needs_attention",
            attentionReason: "question",
            summary: updated.summary,
          });
        }
        return;
      }
      try {
        const url = `${this.baseUrl}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.ctx.cozePat}` },
        });
        const json = (await res.json()) as {
          code?: number;
          data?: { status?: string };
        };
        const status = json.data?.status;
        const cur = this.sessions.get(sessionId);
        if (!cur) return;
        if (status === "completed") {
          clearInterval(timer);
          this.pollers.delete(sessionId);
          const done = withSessionState(cur, "idle", {
            summary: "Coze chat completed",
          });
          this.sessions.set(sessionId, done);
          this.emit({
            type: "completed",
            sessionId,
            state: "idle",
            summary: done.summary,
          });
        } else if (status === "failed" || status === "requires_action") {
          clearInterval(timer);
          this.pollers.delete(sessionId);
          const updated = withSessionState(cur, "needs_attention", {
            attentionReason: status === "failed" ? "failed" : "question",
            summary: `Coze status: ${status}`,
          });
          this.sessions.set(sessionId, updated);
          this.emit({
            type: "attention",
            sessionId,
            state: "needs_attention",
            attentionReason: updated.attentionReason,
            summary: updated.summary,
          });
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    this.pollers.set(sessionId, timer);
  }
}
