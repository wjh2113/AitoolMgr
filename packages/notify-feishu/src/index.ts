import { createHmac } from "node:crypto";
import type { ToolMgrEvent, ToolSession, Task } from "@toolmgr/core";
import { TOOL_LABELS } from "@toolmgr/core";

export interface FeishuConfig {
  webhookUrl?: string;
  secret?: string;
}

export interface FeishuSendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  status?: number;
  body?: string;
}

function sign(secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

async function postWebhook(
  config: FeishuConfig,
  body: Record<string, unknown>,
): Promise<FeishuSendResult> {
  if (!config.webhookUrl) {
    return { ok: false, skipped: true, reason: "FEISHU_WEBHOOK_URL not set" };
  }

  const payload: Record<string, unknown> = { ...body };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = sign(config.secret, timestamp);
  }

  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

export function buildAttentionCard(session: ToolSession, machineName: string) {
  const tool = TOOL_LABELS[session.tool] ?? session.tool;
  const reason = session.attentionReason ?? "question";
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: `ToolMgr · ${tool} needs you` },
        template: reason === "failed" ? "red" : "orange",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: [
              `**Machine:** ${machineName}`,
              `**State:** ${session.state}`,
              `**Reason:** ${reason}`,
              session.cwd ? `**Cwd:** ${session.cwd}` : null,
              session.summary ? `**Summary:** ${session.summary}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "Open ToolMgr" },
              type: "primary",
              url: "http://127.0.0.1:5173/",
            },
          ],
        },
      ],
    },
  };
}

export function buildTaskCard(task: Task, title: string, template: string) {
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: title },
        template,
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: [
              `**Status:** ${task.status}`,
              `**Tools:** ${task.preferredTools.join(", ")}`,
              task.cwd ? `**Cwd:** ${task.cwd}` : null,
              `**Prompt:** ${task.prompt.slice(0, 500)}`,
              task.resultSummary ? `**Result:** ${task.resultSummary}` : null,
              task.error ? `**Error:** ${task.error}` : null,
              task.handoffNotes ? `**Handoff:** ${task.handoffNotes}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    },
  };
}

export function buildTextMessage(text: string) {
  return {
    msg_type: "text",
    content: { text },
  };
}

/** Interactive approve/reply style card for Phase 4 (webhook cannot receive clicks; App Bot later). */
export function buildActionableAttentionCard(input: {
  session: ToolSession;
  machineName: string;
  approveHint?: string;
  replyHint?: string;
}) {
  const base = buildAttentionCard(input.session, input.machineName);
  const card = base.card as {
    elements: Array<Record<string, unknown>>;
  };
  card.elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: [
        "**Suggested actions** (reply in ToolMgr or App Bot callback):",
        input.approveHint ?? "- Approve pending tool permission",
        input.replyHint ?? "- Send a follow-up prompt from the Dispatch drawer",
      ].join("\n"),
    },
  });
  return base;
}

export class FeishuNotifier {
  private lastSent = new Map<string, number>();
  private cooldownMs: number;

  constructor(
    private config: FeishuConfig,
    cooldownMs = 60_000,
  ) {
    this.cooldownMs = cooldownMs;
  }

  updateConfig(config: FeishuConfig) {
    this.config = config;
  }

  private allow(key: string): boolean {
    const now = Date.now();
    const prev = this.lastSent.get(key) ?? 0;
    if (now - prev < this.cooldownMs) return false;
    this.lastSent.set(key, now);
    return true;
  }

  async notifyAttention(session: ToolSession, machineName: string) {
    const key = `att:${session.id}:${session.attentionReason ?? "x"}`;
    if (!this.allow(key)) {
      return { ok: false, skipped: true, reason: "cooldown" } satisfies FeishuSendResult;
    }
    return postWebhook(
      this.config,
      buildActionableAttentionCard({ session, machineName }),
    );
  }

  async notifyTask(task: Task, kind: "completed" | "failed" | "handoff") {
    const key = `task:${task.id}:${kind}`;
    if (!this.allow(key)) {
      return { ok: false, skipped: true, reason: "cooldown" } satisfies FeishuSendResult;
    }
    const title =
      kind === "completed"
        ? "ToolMgr · Task completed"
        : kind === "failed"
          ? "ToolMgr · Task failed"
          : "ToolMgr · Task handed off";
    const template = kind === "failed" ? "red" : kind === "completed" ? "green" : "blue";
    return postWebhook(this.config, buildTaskCard(task, title, template));
  }

  async notifyMachine(machineName: string, online: boolean) {
    const key = `machine:${machineName}:${online}`;
    if (!this.allow(key)) {
      return { ok: false, skipped: true, reason: "cooldown" } satisfies FeishuSendResult;
    }
    return postWebhook(
      this.config,
      buildTextMessage(
        online
          ? `ToolMgr: machine "${machineName}" is online`
          : `ToolMgr: machine "${machineName}" went offline`,
      ),
    );
  }

  async notifyEvent(event: ToolMgrEvent, text: string) {
    const key = `evt:${event.type}:${event.sessionId ?? event.taskId ?? event.id}`;
    if (!this.allow(key)) {
      return { ok: false, skipped: true, reason: "cooldown" } satisfies FeishuSendResult;
    }
    return postWebhook(this.config, buildTextMessage(text));
  }
}
