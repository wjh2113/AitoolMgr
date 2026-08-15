import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  MachineInfo,
  Task,
  ToolMgrEvent,
  ToolSession,
} from "@toolmgr/core";
import type {
  AgentInstance,
  AlertRecord,
  SeatSnapshot,
  TelemetryEvent,
  ToolInstance,
} from "@aitoolmgr/contracts";

type SqlValue = null | number | bigint | string | Uint8Array;

export class Store {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, "aitoolmgr.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.importJsonIfPresent(dataDir);
  }

  get path() {
    return this.dbPath;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        os TEXT NOT NULL,
        is_hub INTEGER NOT NULL DEFAULT 0,
        online INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL,
        payload TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        cwd TEXT,
        title TEXT,
        state TEXT NOT NULL,
        attention_reason TEXT,
        last_event_at TEXT NOT NULL,
        summary TEXT,
        external_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        preferred_tools TEXT NOT NULL,
        cwd TEXT,
        status TEXT NOT NULL,
        assigned_session_id TEXT,
        assigned_machine_id TEXT,
        handoff_notes TEXT,
        source_task_id TEXT,
        result_summary TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        session_id TEXT,
        task_id TEXT,
        payload TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS office_tools (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        version TEXT,
        capabilities TEXT NOT NULL,
        simulated INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS office_agents (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        tool_instance_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        parent_agent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS office_seats (
        seat_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        tool_instance_id TEXT NOT NULL,
        agent_id TEXT,
        state TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_source TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        evidence_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        cleared_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(cleared_at, created_at DESC);
    `);
  }

  private importJsonIfPresent(dataDir: string) {
    const jsonPath = path.join(dataDir, "toolmgr.json");
    if (!fs.existsSync(jsonPath)) return;
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM machines").get() as
      | { c: number | bigint }
      | undefined;
    const n = Number(count?.c ?? 0);
    if (n > 0) return;
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
        machines?: MachineInfo[];
        sessions?: ToolSession[];
        tasks?: Task[];
        events?: ToolMgrEvent[];
      };
      for (const m of raw.machines ?? []) this.upsertMachine(m);
      for (const s of raw.sessions ?? []) this.upsertSession(s);
      for (const t of raw.tasks ?? []) this.upsertTask(t);
      for (const e of [...(raw.events ?? [])].reverse()) this.insertEvent(e);
      fs.renameSync(jsonPath, `${jsonPath}.migrated`);
      console.log(`[store] migrated ${jsonPath} → ${this.dbPath}`);
    } catch (err) {
      console.warn("[store] JSON migration skipped:", err);
    }
  }

  private run(sql: string, params: SqlValue[] = []) {
    this.db.prepare(sql).run(...params);
  }

  upsertMachine(m: MachineInfo) {
    this.run(
      `INSERT INTO machines (id, name, host, os, is_hub, online, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         host=excluded.host,
         os=excluded.os,
         is_hub=excluded.is_hub,
         online=excluded.online,
         last_seen_at=excluded.last_seen_at`,
      [
        m.id,
        m.name,
        m.host,
        m.os,
        m.isHub ? 1 : 0,
        m.online ? 1 : 0,
        m.lastSeenAt,
      ],
    );
  }

  listMachines(): MachineInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, host, os, is_hub, online, last_seen_at
         FROM machines ORDER BY name`,
      )
      .all() as Array<{
      id: string;
      name: string;
      host: string;
      os: string;
      is_hub: number;
      online: number;
      last_seen_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      os: r.os,
      isHub: !!r.is_hub,
      online: !!r.online,
      lastSeenAt: r.last_seen_at,
    }));
  }

  getMachine(id: string): MachineInfo | undefined {
    return this.listMachines().find((m) => m.id === id);
  }

  upsertSession(s: ToolSession) {
    this.run(
      `INSERT INTO sessions (
        id, machine_id, tool, cwd, title, state, attention_reason,
        last_event_at, summary, external_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        machine_id=excluded.machine_id,
        tool=excluded.tool,
        cwd=excluded.cwd,
        title=excluded.title,
        state=excluded.state,
        attention_reason=excluded.attention_reason,
        last_event_at=excluded.last_event_at,
        summary=excluded.summary,
        external_id=excluded.external_id`,
      [
        s.id,
        s.machineId,
        s.tool,
        s.cwd ?? null,
        s.title ?? null,
        s.state,
        s.attentionReason ?? null,
        s.lastEventAt,
        s.summary ?? null,
        s.externalId ?? null,
        s.createdAt,
      ],
    );
  }

  listSessions(): ToolSession[] {
    const rows = this.db
      .prepare(
        `SELECT id, machine_id, tool, cwd, title, state, attention_reason,
                last_event_at, summary, external_id, created_at
         FROM sessions ORDER BY last_event_at DESC`,
      )
      .all() as Array<Record<string, SqlValue>>;
    return rows.map((r) => ({
      id: String(r.id),
      machineId: String(r.machine_id),
      tool: r.tool as ToolSession["tool"],
      cwd: (r.cwd as string) || undefined,
      title: (r.title as string) || undefined,
      state: r.state as ToolSession["state"],
      attentionReason: (r.attention_reason as ToolSession["attentionReason"]) || undefined,
      lastEventAt: String(r.last_event_at),
      summary: (r.summary as string) || undefined,
      externalId: (r.external_id as string) || undefined,
      createdAt: String(r.created_at),
    }));
  }

  getSession(id: string): ToolSession | undefined {
    return this.listSessions().find((s) => s.id === id);
  }

  upsertTask(t: Task) {
    this.run(
      `INSERT INTO tasks (
        id, prompt, preferred_tools, cwd, status, assigned_session_id,
        assigned_machine_id, handoff_notes, source_task_id, result_summary,
        error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        prompt=excluded.prompt,
        preferred_tools=excluded.preferred_tools,
        cwd=excluded.cwd,
        status=excluded.status,
        assigned_session_id=excluded.assigned_session_id,
        assigned_machine_id=excluded.assigned_machine_id,
        handoff_notes=excluded.handoff_notes,
        source_task_id=excluded.source_task_id,
        result_summary=excluded.result_summary,
        error=excluded.error,
        updated_at=excluded.updated_at`,
      [
        t.id,
        t.prompt,
        JSON.stringify(t.preferredTools),
        t.cwd ?? null,
        t.status,
        t.assignedSessionId ?? null,
        t.assignedMachineId ?? null,
        t.handoffNotes ?? null,
        t.sourceTaskId ?? null,
        t.resultSummary ?? null,
        t.error ?? null,
        t.createdAt,
        t.updatedAt,
      ],
    );
  }

  listTasks(): Task[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC`)
      .all() as Array<Record<string, SqlValue>>;
    return rows.map((r) => ({
      id: String(r.id),
      prompt: String(r.prompt),
      preferredTools: JSON.parse(String(r.preferred_tools)) as Task["preferredTools"],
      cwd: (r.cwd as string) || undefined,
      status: r.status as Task["status"],
      assignedSessionId: (r.assigned_session_id as string) || undefined,
      assignedMachineId: (r.assigned_machine_id as string) || undefined,
      handoffNotes: (r.handoff_notes as string) || undefined,
      sourceTaskId: (r.source_task_id as string) || undefined,
      resultSummary: (r.result_summary as string) || undefined,
      error: (r.error as string) || undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  getTask(id: string): Task | undefined {
    return this.listTasks().find((t) => t.id === id);
  }

  insertEvent(e: ToolMgrEvent) {
    this.run(
      `INSERT OR REPLACE INTO events (id, type, machine_id, session_id, task_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id,
        e.type,
        e.machineId,
        e.sessionId ?? null,
        e.taskId ?? null,
        e.payload ? JSON.stringify(e.payload) : null,
        e.createdAt,
      ],
    );
    this.trimTable("events", "created_at", 500);
  }

  private trimTable(table: "events" | "telemetry_events", orderCol: string, keep: number) {
    const idCol = table === "events" ? "id" : "event_id";
    this.run(
      `DELETE FROM ${table} WHERE ${idCol} NOT IN (
         SELECT ${idCol} FROM ${table} ORDER BY ${orderCol} DESC LIMIT ?
       )`,
      [keep],
    );
  }

  listEvents(limit = 200): ToolMgrEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, machine_id, session_id, task_id, payload, created_at
         FROM events ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, SqlValue>>;
    return rows.map((r) => ({
      id: String(r.id),
      type: r.type as ToolMgrEvent["type"],
      machineId: String(r.machine_id),
      sessionId: (r.session_id as string) || undefined,
      taskId: (r.task_id as string) || undefined,
      payload: r.payload
        ? (JSON.parse(String(r.payload)) as Record<string, unknown>)
        : undefined,
      createdAt: String(r.created_at),
    }));
  }

  // --- Office / AitoolMgr persistence ---

  upsertOfficeTool(t: ToolInstance) {
    this.run(
      `INSERT INTO office_tools (id, machine_id, tool_type, display_name, version, capabilities, simulated)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name=excluded.display_name,
         version=excluded.version,
         capabilities=excluded.capabilities,
         simulated=excluded.simulated`,
      [
        t.id,
        t.machineId,
        t.toolType,
        t.displayName,
        t.version ?? null,
        JSON.stringify(t.capabilities),
        t.simulated ? 1 : 0,
      ],
    );
  }

  upsertOfficeAgent(a: AgentInstance) {
    this.run(
      `INSERT INTO office_agents (id, machine_id, tool_instance_id, agent_key, display_name, parent_agent_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name=excluded.display_name,
         parent_agent_id=excluded.parent_agent_id`,
      [
        a.id,
        a.machineId,
        a.toolInstanceId,
        a.agentKey,
        a.displayName,
        a.parentAgentId ?? null,
      ],
    );
  }

  upsertSeat(seat: SeatSnapshot) {
    this.run(
      `INSERT INTO office_seats (seat_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(seat_id) DO UPDATE SET
         payload=excluded.payload,
         updated_at=excluded.updated_at`,
      [seat.seatId, JSON.stringify(seat), seat.updatedAt],
    );
  }

  listSeats(): SeatSnapshot[] {
    const rows = this.db
      .prepare(`SELECT payload FROM office_seats`)
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SeatSnapshot);
  }

  insertTelemetry(e: TelemetryEvent) {
    this.run(
      `INSERT OR REPLACE INTO telemetry_events (
        event_id, timestamp, machine_id, tool_type, tool_instance_id, agent_id,
        state, confidence, evidence_source, evidence_type, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.eventId,
        e.timestamp,
        e.machineId,
        e.toolType,
        e.toolInstanceId,
        e.agentId ?? null,
        e.state,
        e.confidence,
        e.evidenceSource,
        e.evidenceType,
        JSON.stringify(e),
      ],
    );
    this.trimTable("telemetry_events", "timestamp", 2000);
  }

  upsertAlert(a: AlertRecord) {
    this.run(
      `INSERT INTO alerts (
        id, severity, object_type, object_id, title, body, evidence_summary, created_at, cleared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        severity=excluded.severity,
        title=excluded.title,
        body=excluded.body,
        evidence_summary=excluded.evidence_summary,
        cleared_at=excluded.cleared_at`,
      [
        a.id,
        a.severity,
        a.objectType,
        a.objectId,
        a.title,
        a.body,
        a.evidenceSummary,
        a.createdAt,
        a.clearedAt ?? null,
      ],
    );
  }

  listOpenAlerts(limit = 50): AlertRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, severity, object_type, object_id, title, body, evidence_summary, created_at, cleared_at
         FROM alerts WHERE cleared_at IS NULL
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, SqlValue>>;
    return rows.map((r) => ({
      id: String(r.id),
      severity: r.severity as AlertRecord["severity"],
      objectType: r.object_type as AlertRecord["objectType"],
      objectId: String(r.object_id),
      title: String(r.title),
      body: String(r.body),
      evidenceSummary: String(r.evidence_summary),
      createdAt: String(r.created_at),
      clearedAt: (r.cleared_at as string) || undefined,
    }));
  }

  close() {
    this.db.close();
  }
}
