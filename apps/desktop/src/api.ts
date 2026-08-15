import type {
  DispatchRequest,
  HandoffRequest,
  MachineInfo,
  Task,
  ToolMgrEvent,
  ToolSession,
  ToolKind,
} from "@toolmgr/core";
import type { OfficeSnapshot } from "./DigitalOffice";

export interface Snapshot {
  machine: MachineInfo;
  machines: MachineInfo[];
  sessions: ToolSession[];
  tasks: Task[];
  events: ToolMgrEvent[];
  adapters: Array<{ kind: ToolKind; capabilities: Record<string, boolean> }>;
  config: {
    isHub: boolean;
    hubUrl?: string;
    feishuConfigured: boolean;
    host: string;
    port: number;
  };
}

const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function fetchSnapshot() {
  return request<Snapshot>("/api/snapshot");
}

export function fetchOffice() {
  return request<OfficeSnapshot>("/api/office");
}

export function dispatchTask(body: DispatchRequest) {
  return request<Task>("/api/dispatch", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export function handoffTask(body: HandoffRequest) {
  return request<Task>("/api/handoff", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export function cancelSession(id: string) {
  return request<{ ok: boolean }>(`/api/sessions/${id}/cancel`, {
    method: "POST",
    headers: jsonHeaders,
  });
}

export function approveSession(id: string, decision: "allow" | "deny") {
  return request<{ ok: boolean }>(`/api/sessions/${id}/approve`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ decision }),
  });
}

export function replySession(id: string, text: string) {
  return request<{ ok: boolean }>(`/api/sessions/${id}/reply`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text }),
  });
}

export function connectWs(onMessage: (data: unknown) => void) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(String(ev.data)));
    } catch {
      /* ignore */
    }
  };
  return ws;
}
