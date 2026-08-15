import type {
  AdapterCapabilities,
  SendPromptResult,
  ToolKind,
  ToolSession,
} from "@toolmgr/core";

export type AdapterEventHandler = (event: {
  type: "state" | "attention" | "completed" | "error" | "log";
  sessionId?: string;
  state?: ToolSession["state"];
  attentionReason?: ToolSession["attentionReason"];
  summary?: string;
  error?: string;
  message?: string;
}) => void;

export interface ToolAdapter {
  kind: ToolKind;
  capabilities: AdapterCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  listSessions(): Promise<ToolSession[]>;
  sendPrompt(input: {
    prompt: string;
    cwd?: string;
    sessionId?: string;
    title?: string;
  }): Promise<SendPromptResult>;
  cancel?(sessionId: string): Promise<void>;
  approve?(sessionId: string, decision: "allow" | "deny"): Promise<void>;
  reply?(sessionId: string, text: string): Promise<void>;
  onEvent(handler: AdapterEventHandler): void;
}

export interface AdapterContext {
  machineId: string;
  cursorApiKey?: string;
  cozePat?: string;
  cozeBotId?: string;
  cozeBaseUrl?: string;
  dataDir: string;
}
